/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, built-in write tools are disabled.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - Explicit task-state updates during execution
 * - Persistent progress tracking widget
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { StringEnum, type AssistantMessage, type TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	publishPlanBuildMode,
	subscribePlanBuildModeToggleRequests,
} from "./modeEvents.ts";
import { publishPlanProgress } from "./progressState.ts";
import {
	extractTodoItems,
	getTodoCounts,
	isSafeCommand,
	MAX_TODO_EVIDENCE_CHARS,
	normalizeTodoItems,
	todoStatusSymbol,
	TODO_UPDATE_STATES,
	transitionTodoItems,
	type TodoItem,
} from "./utils.ts";
import { PlanTodoWidget } from "./todoWidget.ts";

// Tools
const PLAN_PROGRESS_TOOL = "plan_progress";
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write", PLAN_PROGRESS_TOOL]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeState {
	enabled?: boolean;
	todos?: unknown;
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function renderTodoLine(ctx: ExtensionContext, todoItem: TodoItem): string {
	const symbol = todoStatusSymbol(todoItem.status);
	switch (todoItem.status) {
		case "running":
			return `${ctx.ui.theme.fg("accent", symbol)} ${todoItem.text}`;
		case "completed":
			return `${ctx.ui.theme.fg("success", symbol)} ${ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(todoItem.text))}`;
		case "failed":
			return `${ctx.ui.theme.fg("error", symbol)} ${todoItem.text}`;
		default:
			return `${ctx.ui.theme.fg("muted", symbol)} ${todoItem.text}`;
	}
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		publishPlanBuildMode(pi.events, planModeEnabled ? "plan" : "build");
		publishPlanProgress(todoItems, executionMode);
		const counts = getTodoCounts(todoItems);

		if (executionMode && counts.total > 0) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${counts.completed}/${counts.total}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else if (counts.total > 0) {
			const role = counts.completed === counts.total ? "success" : "muted";
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg(role, `📋 ${counts.completed}/${counts.total}`));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		if (counts.total === 0) {
			ctx.ui.setWidget("plan-todos", undefined);
		} else if (ctx.mode === "tui") {
			ctx.ui.setWidget(
				"plan-todos",
				(_tui, theme) => new PlanTodoWidget(todoItems, theme),
			);
		} else {
			ctx.ui.setWidget(
				"plan-todos",
				todoItems.map((todoItem) => renderTodoLine(ctx, todoItem)),
			);
		}
	}

	function uniqueToolNames(toolNames: string[]): string[] {
		return [...new Set(toolNames)];
	}

	function getPlanModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
			...PLAN_MODE_TOOLS,
		]);
	}

	function getNormalModeTools(activeToolNames: string[]): string[] {
		return uniqueToolNames([
			...NORMAL_MODE_TOOLS,
			...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
		]);
	}

	function enablePlanModeTools(): void {
		const activeToolNames = toolsBeforePlanMode ?? pi.getActiveTools();
		toolsBeforePlanMode = activeToolNames;
		pi.setActiveTools(getPlanModeTools(activeToolNames));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
		});
	}

	pi.registerTool({
		name: PLAN_PROGRESS_TOOL,
		label: "Plan Progress",
		description:
			"Update one tracked plan step during execution. Start pending or failed work before completing it. Completion requires concise evidence.",
		promptSnippet: "Record explicit running, completed, or failed states for tracked plan steps",
		promptGuidelines: [
			"Use plan_progress while executing a tracked plan: mark a step running before work starts, then completed with concise evidence after verification, or failed if it cannot be completed.",
		],
		parameters: Type.Object({
			step: Type.Integer({ minimum: 1, description: "Number of the tracked plan step" }),
			status: StringEnum(TODO_UPDATE_STATES, {
				description: "running = work started; completed = verified done; failed = attempt did not complete",
			}),
			evidence: Type.Optional(
				Type.String({
					maxLength: MAX_TODO_EVIDENCE_CHARS,
					description: "Required for completed: a concise description of the verification or concrete outcome",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!executionMode || todoItems.length === 0) throw new Error("No tracked plan is currently executing.");
			todoItems = transitionTodoItems(todoItems, params.step, params.status, params.evidence);
			const updatedItem = todoItems.find((todoItem) => todoItem.step === params.step)!;
			updateStatus(ctx);
			persistState();
			return {
				content: [{ type: "text", text: `Step ${params.step} is now ${params.status}: ${updatedItem.text}` }],
				details: updatedItem,
			};
		},
	});

	function enterBuildMode(ctx: ExtensionContext, message = "Build mode enabled. Full access restored."): void {
		planModeEnabled = false;
		executionMode = false;
		restoreNormalModeTools();
		ctx.ui.notify(message);
		updateStatus(ctx);
		persistState();
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			enterBuildMode(ctx, "Plan mode disabled. Full access restored.");
			return;
		}

		planModeEnabled = true;
		executionMode = false;
		todoItems = [];
		enablePlanModeTools();
		ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		updateStatus(ctx);
		persistState();
	}

	subscribePlanBuildModeToggleRequests(pi.events, () => {
		if (activeContext) togglePlanMode(activeContext);
	});

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("build", {
		description: "Switch to build mode (full tool access)",
		handler: async (_args, ctx) => enterBuildMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems
				.map((todoItem) => {
					const evidence = todoItem.evidence ? ` — ${todoItem.evidence}` : "";
					return `${todoItem.step}. ${todoStatusSymbol(todoItem.status)} ${todoItem.text}${evidence}`;
				})
				.join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions before planning when the task is ambiguous.
Use only read-only inspection and research commands while planning.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((todoItem) => todoItem.status !== "completed");
			const todoList = remaining
				.map((todoItem) => `${todoItem.step}. ${todoStatusSymbol(todoItem.status)} ${todoItem.text}`)
				.join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order. Use plan_progress to mark a step running before work starts. Mark it completed with concise evidence only after verification, or failed if the attempt cannot be completed.`,
					display: false,
				},
			};
		}
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((todoItem) => todoItem.status === "completed")) {
				const completedList = todoItems
					.map((todoItem) => `✓ ${todoItem.text}${todoItem.evidence ? ` — ${todoItem.evidence}` : ""}`)
					.join("\n");
				executionMode = false;
				updateStatus(ctx);
				persistState();
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length === 0) return;
		updateStatus(ctx);
		persistState();

		// Show plan steps and prompt for next action
		const todoListText = todoItems
			.map((todoItem) => `${todoItem.step}. ${todoStatusSymbol(todoItem.status)} ${todoItem.text}`)
			.join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan (track progress)",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			const firstTodoItem = todoItems[0];
			if (!firstTodoItem) return;

			planModeEnabled = false;
			executionMode = true;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			const remainingList = todoItems
				.map((todoItem) => `${todoItem.step}. ${todoStatusSymbol(todoItem.status)} ${todoItem.text}`)
				.join("\n");
			const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
Use plan_progress to mark the step running before work starts, then completed with concise evidence after verification, or failed if the attempt cannot be completed.`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		activeContext = ctx;
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = normalizeTodoItems(planModeEntry.data.todos);
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		if (executionMode && todoItems.every((todoItem) => todoItem.status === "completed")) {
			executionMode = false;
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		activeContext = undefined;
		publishPlanProgress([], false);
	});
}

/**
 * Plan Progress Extension
 *
 * Tracks numbered plan steps extracted from "Plan:" sections.
 *
 * Features:
 * - Extracts numbered plan steps from "Plan:" sections
 * - Explicit task-state updates during execution via plan_progress
 * - Persistent progress tracking widget and sidebar Tasks section
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { StringEnum, type AssistantMessage, type TextContent } from "@earendil-works/pi-ai";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { publishPlanProgress } from "./progressState.ts";
import {
	canTrackTodoProgress,
	extractTodoItems,
	getTodoCounts,
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

interface PlanModeState {
	todos?: unknown;
	executing?: boolean;
	completionAnnounced?: boolean;
}

interface PlanCompleteEntry {
	content: string;
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
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let completionAnnounced = false;

	pi.registerEntryRenderer<PlanCompleteEntry>("plan-complete", (entry) =>
		new Markdown(entry.data.content, 0, 0, getMarkdownTheme()),
	);

	function updateStatus(ctx: ExtensionContext): void {
		publishPlanProgress(todoItems, executionMode);
		const counts = getTodoCounts(todoItems);

		if (executionMode && counts.total > 0) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${counts.completed}/${counts.total}`));
		} else if (counts.total > 0) {
			const role = counts.completed === counts.total ? "success" : "muted";
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg(role, `📋 ${counts.completed}/${counts.total}`));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		const completedPlan = counts.total > 0 && counts.completed === counts.total && !executionMode;
		if (counts.total === 0 || completedPlan) {
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

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			todos: todoItems,
			executing: executionMode,
			completionAnnounced,
		});
	}

	function announceCompletedPlan(ctx: ExtensionContext): void {
		executionMode = false;
		completionAnnounced = false;
		updateStatus(ctx);
		persistState();
		const completedList = todoItems
			.map((todoItem) => `✓ ${todoItem.text}${todoItem.evidence ? ` — ${todoItem.evidence}` : ""}`)
			.join("\n");
		pi.appendEntry("plan-complete", {
			content: `**Plan Complete!** ✓\n\n${completedList}`,
		} satisfies PlanCompleteEntry);
		completionAnnounced = true;
		persistState();
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
			if (!canTrackTodoProgress(todoItems)) {
				throw new Error("No tracked plan is currently executing.");
			}
			const nextTodoItems = transitionTodoItems(todoItems, params.step, params.status, params.evidence);
			if (!executionMode) executionMode = true;
			todoItems = nextTodoItems;
			const updatedItem = todoItems.find((todoItem) => todoItem.step === params.step)!;
			if (todoItems.every((todoItem) => todoItem.status === "completed")) {
				announceCompletedPlan(ctx);
			} else {
				updateStatus(ctx);
				persistState();
			}
			return {
				content: [{ type: "text", text: `Step ${params.step} is now ${params.status}: ${updatedItem.text}` }],
				details: updatedItem,
			};
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No tracked plan steps.", "info");
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

	// Filter out stale plan mode context from older sessions
	pi.on("context", async (event) => {
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

	// Inject execution context before agent starts
	pi.on("before_agent_start", async () => {
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
				announceCompletedPlan(ctx);
			}
			return;
		}

		if (!ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
				completionAnnounced = false;
			}
		}

		if (todoItems.length === 0) return;
		if (todoItems.every((todoItem) => todoItem.status === "completed")) return;
		updateStatus(ctx);
		persistState();
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		activeContext = ctx;

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		let planModeEntryIndex = -1;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type: string; customType?: string };
			if (entry.type === "custom" && entry.customType === "plan-mode") {
				planModeEntryIndex = index;
				break;
			}
		}
		const planModeEntry = planModeEntryIndex >= 0
			? entries[planModeEntryIndex] as { data?: PlanModeState }
			: undefined;

		if (planModeEntry?.data) {
			todoItems = normalizeTodoItems(planModeEntry.data.todos);
			executionMode = planModeEntry.data.executing ?? executionMode;
			completionAnnounced = planModeEntry.data.completionAnnounced ?? completionAnnounced;
		}

		const completedPlan = todoItems.length > 0 && todoItems.every((todoItem) => todoItem.status === "completed");
		const legacyCompletionRendered = planModeEntryIndex >= 0 && entries
			.slice(planModeEntryIndex + 1)
			.some((entry: { type: string; customType?: string }) =>
				(entry.type === "custom" || entry.type === "custom_message") && entry.customType === "plan-complete",
			);
		completionAnnounced ||= legacyCompletionRendered;

		if (completedPlan && !completionAnnounced) {
			announceCompletedPlan(ctx);
		} else {
			if (completedPlan) executionMode = false;
			updateStatus(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		activeContext = undefined;
		publishPlanProgress([], false);
	});
}

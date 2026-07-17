import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
	browserIssueFromResult,
	browserToolFromCall,
	mutationFromTool,
	verificationCommandFromTool,
} from "./detection.ts";
import {
	MAX_REPAIR_ATTEMPTS,
	VERIFICATION_KINDS,
	VERIFICATION_STATUSES,
	VerificationTracker,
	type VerificationReport,
	type VerificationSnapshot,
} from "./state.ts";
import { captureWorkspaceSnapshot, type WorkspaceSnapshot } from "./workspace.ts";

const STATE_ENTRY_TYPE = "verification-loop-state";
const STATUS_ID = "verification-loop";

const VERIFICATION_PROMPT = `[AUTOMATIC FEATURE VERIFICATION]
For every feature or runtime behavior you create or change, verification is part of implementation, not an optional final note.

Required workflow:
1. Make the change.
2. Run the relevant automated tests, lint, type checks, build, or a focused command-level check after the last mutation.
3. Exercise the actual feature as a normal user. For UI work, use the browser MCP tools to navigate, inspect the accessibility snapshot, interact with controls or resize the viewport, check console messages and network requests, and take a final screenshot. Use snapshots—not screenshots—as action targets.
4. If any functional or visual issue appears, fix it and repeat every required check after the fix.
5. Before claiming completion, call verification_report. Do not provide a completion response unless that tool accepts status passed.

A later edit makes earlier evidence stale. If verification cannot run, call verification_report with status blocked and give the exact blocker instead of claiming success.`;

export default function verificationLoopExtension(pi: ExtensionAPI): void {
	let tracker = new VerificationTracker();
	let activeContext: ExtensionContext | undefined;
	let lastWorkspace: WorkspaceSnapshot | undefined;
	let mutationObservedSinceSnapshot = false;
	let mutationGeneration = 0;
	const toolCallGenerations = new Map<string, number>();

	function persistState(): void {
		pi.appendEntry<VerificationSnapshot>(STATE_ENTRY_TYPE, tracker.snapshot());
	}

	function updateStatus(ctx: ExtensionContext): void {
		const snapshot = tracker.snapshot();
		if (snapshot.phase === "clean" && snapshot.enabled) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_ID, tracker.statusText());
	}

	async function resetWorkspaceBaseline(ctx: ExtensionContext): Promise<void> {
		lastWorkspace = await captureWorkspaceSnapshot(pi, ctx.cwd);
		mutationObservedSinceSnapshot = false;
	}

	function restoreTrackerFromBranch(ctx: ExtensionContext): void {
		const savedEntry = ctx.sessionManager.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: VerificationSnapshot } | undefined;
		tracker = new VerificationTracker(savedEntry?.data);
		mutationGeneration = 0;
		toolCallGenerations.clear();
	}

	async function reconcileWorkspace(ctx: ExtensionContext): Promise<boolean> {
		const currentWorkspace = await captureWorkspaceSnapshot(pi, ctx.cwd);
		if (!currentWorkspace) return false;
		if (!lastWorkspace) {
			lastWorkspace = currentWorkspace;
			mutationObservedSinceSnapshot = false;
			return false;
		}
		if (currentWorkspace.fingerprint === lastWorkspace.fingerprint) {
			mutationObservedSinceSnapshot = false;
			return false;
		}

		const observedMutation = mutationObservedSinceSnapshot;
		const changed = observedMutation
			? tracker.mergeChangedPathKinds(currentWorkspace.changedPaths)
			: tracker.mergeChangedPaths(currentWorkspace.changedPaths);
		if (changed && !observedMutation) mutationGeneration += 1;
		lastWorkspace = currentWorkspace;
		mutationObservedSinceSnapshot = false;
		return changed;
	}

	pi.registerTool({
		name: "verification_report",
		label: "Verification Report",
		description:
			"Record the final observed verification result for a changed feature. Passing is accepted only after successful command-level checks and, for UI work, a complete browser user journey after the latest edit.",
		promptSnippet: "Complete changed features with evidence-backed automated and user-level verification",
		promptGuidelines: [
			"Call verification_report before claiming a changed feature is complete.",
			"If a check finds an issue, fix it and repeat all checks after the last edit before reporting passed.",
		],
		parameters: Type.Object({
			kind: StringEnum(VERIFICATION_KINDS, {
				description: "functional for non-UI behavior, ui for visual interaction, both when both apply",
			}),
			status: StringEnum(VERIFICATION_STATUSES, {
				description: "passed only when all checks pass; failed when repair is still needed; blocked when verification cannot run",
			}),
			summary: Type.String({ minLength: 1, maxLength: 800, description: "Concise observed result" }),
			checks: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
				minItems: 1,
				maxItems: 12,
				description: "Concrete commands and user journeys actually completed",
			}),
			issues: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 12 })),
		}, { additionalProperties: false }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = tracker.submitReport(params as VerificationReport);
			if (!result.accepted) throw new Error(result.message);
			persistState();
			updateStatus(ctx);
			return {
				content: [{ type: "text", text: result.message }],
				details: tracker.snapshot(),
			};
		},
	});

	pi.registerCommand("verification", {
		description: "Show or control the automatic feature-verification loop",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "on") {
				tracker.setEnabled(true);
				tracker.reset();
				await resetWorkspaceBaseline(ctx);
				ctx.ui.notify("Automatic feature verification enabled.", "info");
			} else if (action === "off") {
				tracker.setEnabled(false);
				toolCallGenerations.clear();
				ctx.ui.notify("Automatic feature verification disabled for this session.", "warning");
			} else if (action === "reset") {
				tracker.retryVerification();
				mutationGeneration += 1;
				toolCallGenerations.clear();
				await resetWorkspaceBaseline(ctx);
				ctx.ui.notify("Feature verification evidence cleared; the pending change still requires a fresh pass.", "info");
			} else if (action === "status") {
				const missing = tracker.missingEvidence();
				ctx.ui.notify(
					`${tracker.statusText()}${missing.length > 0 ? `\nMissing: ${missing.join("; ")}` : ""}`,
					"info",
				);
				return;
			} else {
				ctx.ui.notify("Usage: /verification [status|on|off|reset]", "warning");
				return;
			}
			persistState();
			updateStatus(ctx);
		},
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || event.streamingBehavior !== undefined) return;
		tracker.beginUserTask();
		toolCallGenerations.clear();
		await resetWorkspaceBaseline(ctx);
		persistState();
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async () => {
		if (!tracker.isEnabled()) return;
		const missing = tracker.missingEvidence();
		const pendingContext = missing.length > 0
			? `\n\nCurrent verification is pending. Missing evidence: ${missing.join("; ")}.`
			: "";
		return {
			message: {
				customType: "verification-loop-context",
				content: `${VERIFICATION_PROMPT}${pendingContext}`,
				display: false,
			},
		};
	});

	pi.on("tool_call", async (event) => {
		if (!tracker.isEnabled()) return;
		toolCallGenerations.set(event.toolCallId, mutationGeneration);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!tracker.isEnabled()) return;
		const input = asRecord(event.input);
		const startedAtGeneration = toolCallGenerations.get(event.toolCallId) ?? mutationGeneration;
		toolCallGenerations.delete(event.toolCallId);
		let changed = false;
		const verificationCommand = verificationCommandFromTool(event.toolName, input);
		const browserTool = browserToolFromCall(event.toolName, input);

		if (!event.isError) {
			const mutation = mutationFromTool(event.toolName, input);
			if (mutation) {
				tracker.recordMutation({ ui: mutation.ui });
				mutationGeneration += 1;
				mutationObservedSinceSnapshot = true;
				changed = true;
			}
			const evidenceIsFresh = startedAtGeneration === mutationGeneration;
			if (verificationCommand && evidenceIsFresh) {
				changed = tracker.recordSuccessfulCheck(verificationCommand) || changed;
			}
			if (browserTool && evidenceIsFresh) {
				changed = tracker.recordBrowserTool(browserTool) || changed;
				const observedIssue = browserIssueFromResult(browserTool, toolResultText(event.content));
				if (observedIssue) changed = tracker.recordObservedIssue(observedIssue) || changed;
			}
		} else if (startedAtGeneration === mutationGeneration) {
			if (verificationCommand) changed = tracker.recordFailedCheck(verificationCommand) || changed;
			if (browserTool) {
				changed = tracker.recordObservedIssue(`Browser check failed while running ${browserTool}.`) || changed;
			}
		}

		if (!changed) return;
		persistState();
		updateStatus(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!tracker.isEnabled()) return;
		const workspaceChanged = await reconcileWorkspace(ctx);
		if (workspaceChanged) {
			persistState();
			updateStatus(ctx);
		}
		if (!ctx.isIdle()) return;

		const followUpPrompt = tracker.takeFollowUpPrompt();
		if (followUpPrompt) {
			persistState();
			updateStatus(ctx);
			pi.sendUserMessage(followUpPrompt, { deliverAs: "followUp" });
			return;
		}

		if (tracker.shouldNotifyExhausted()) {
			tracker.markExhaustionNotified();
			persistState();
			updateStatus(ctx);
			pi.sendMessage({
				customType: "verification-loop-exhausted",
				content: `Automatic verification stopped after ${MAX_REPAIR_ATTEMPTS} repair attempts without an accepted pass. The feature remains unverified; run /verification reset to retry or report the blocker explicitly.`,
				display: true,
			});
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		activeContext = ctx;
		restoreTrackerFromBranch(ctx);
		await resetWorkspaceBaseline(ctx);
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreTrackerFromBranch(ctx);
		await resetWorkspaceBaseline(ctx);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (activeContext) activeContext.ui.setStatus(STATUS_ID, undefined);
		activeContext = undefined;
		lastWorkspace = undefined;
		mutationObservedSinceSnapshot = false;
		mutationGeneration = 0;
		toolCallGenerations.clear();
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function toolResultText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: "text"; text: string } => {
			return asRecord(item).type === "text" && typeof asRecord(item).text === "string";
		})
		.map((item) => item.text)
		.join("\n");
}

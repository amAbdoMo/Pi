import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
	constrainScreenshotToViewport,
	redirectScreenshotToTemporaryFile,
	removeVerificationArtifacts,
} from "./artifacts.ts";
import { appendBlockerCard, BLOCKER_ENTRY_TYPE, registerBlockerCardRenderer } from "./blocker-card.ts";
import {
	browserBlockerFromResult,
	browserIssueFromResult,
	browserToolFromCall,
	mutationFromTool,
	verificationCommandFromTool,
	verificationHarnessFromTool,
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
const BLOCKER_CHOICES = [
	"I’ll log in now — keep this browser open",
	"Continue with non-browser checks and report the limitation",
	"Stop and summarize what remains",
	"Let me type another instruction",
] as const;

const VERIFICATION_PROMPT = `[AUTOMATIC FEATURE VERIFICATION]
For every feature or runtime behavior you create or change, verification is part of implementation, not an optional final note.

Required workflow:
1. Make the change.
2. Run the relevant automated tests, lint, type checks, build, or a focused command-level check after the last mutation.
3. Exercise the actual feature as a normal user. For UI work, use the browser MCP tools to navigate, inspect the accessibility snapshot, interact with controls or resize the viewport, check console messages and network requests, and take a final screenshot. Use snapshots—not screenshots—as action targets. Screenshots and Playwright output are disposable verification artifacts: keep them only in the OS temporary directory, never in the project/workspace or drive root, and do not retain them unless the user explicitly asks.
4. If a product defect appears, make one bounded repair and repeat the required checks after the fix.
5. If login, credentials, target access, the browser session, or a required environment blocks verification, do not retry alternate browser actions. Take at most one viewport screenshot only when it adds useful evidence, then stop and wait for the user's choice.
6. Verify the real feature. Do not create substitute pages, sections, fixtures, or visual harnesses merely to manufacture verification evidence.
7. Before claiming completion, call verification_report. Do not provide a completion response unless that tool accepts status passed.

A later edit makes earlier evidence stale. A blocker must be shown to the user instead of being presented as success or retried in a loop.`;

export default function verificationLoopExtension(pi: ExtensionAPI): void {
	if (process.env.PI_WORKFLOW_CHILD === "1") {
		registerWorkflowChildArtifactPolicy(pi);
		return;
	}

	let tracker = new VerificationTracker();
	let activeContext: ExtensionContext | undefined;
	let lastWorkspace: WorkspaceSnapshot | undefined;
	let mutationObservedSinceSnapshot = false;
	let mutationGeneration = 0;
	const toolCallGenerations = new Map<string, number>();
	const verificationArtifacts = new Set<string>();
	const verificationArtifactByCall = new Map<string, string>();
	let blockerCardShown = false;
	let blockerPromptOpen = false;
	let blockerScreenshotReserved = false;
	let lastPromptedBlockerSequence: number | undefined;

	function cleanupVerificationArtifacts(): void {
		removeVerificationArtifacts(verificationArtifacts);
		verificationArtifacts.clear();
		verificationArtifactByCall.clear();
	}

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
		const blocker = tracker.currentBlocker();
		blockerCardShown = blocker ? hasMatchingBlockerCard(ctx, blocker.kind, blocker.summary, blocker.sequence) : false;
		mutationGeneration = 0;
		toolCallGenerations.clear();
	}

	async function showBlockerChoice(ctx: ExtensionContext): Promise<void> {
		const blocker = tracker.currentBlocker();
		if (!blocker || blockerPromptOpen || lastPromptedBlockerSequence === blocker.sequence) return;
		if (!blockerCardShown) {
			await appendBlockerCard(pi, blocker);
			blockerCardShown = true;
		}
		lastPromptedBlockerSequence = blocker.sequence;
		persistState();
		updateStatus(ctx);
		if (!ctx.hasUI) return;

		blockerPromptOpen = true;
		try {
			const choice = await ctx.ui.select("Verification paused — what next?", [...BLOCKER_CHOICES]);
			if (choice === BLOCKER_CHOICES[0]) await waitForLogin(ctx);
			else if (choice === BLOCKER_CHOICES[1]) continueWithoutBrowser(ctx);
			else if (choice === BLOCKER_CHOICES[2]) stopAndSummarize(ctx);
			else if (choice === BLOCKER_CHOICES[3]) await requestInstruction(ctx);
		} finally {
			blockerPromptOpen = false;
		}
	}

	async function waitForLogin(ctx: ExtensionContext): Promise<void> {
		const ready = await ctx.ui.confirm(
			"Browser session kept open",
			"Log in using the existing browser window, then choose Yes to continue verification.",
		);
		if (!ready) {
			ctx.ui.notify("Verification remains paused. Run /verification resume when login is complete.", "info");
			return;
		}
		resumeWithMessage(ctx, "Login is complete in the existing browser session. Resume the real user journey from navigation; do not create a substitute page.");
	}

	function continueWithoutBrowser(ctx: ExtensionContext): void {
		tracker.stopAtBlocker();
		persistState();
		updateStatus(ctx);
		pi.sendUserMessage("Continue with the strongest relevant non-browser checks. Do not retry browser access. Report the browser limitation explicitly and do not claim full UI verification.");
	}

	function stopAndSummarize(ctx: ExtensionContext): void {
		tracker.stopAtBlocker();
		persistState();
		updateStatus(ctx);
		pi.sendMessage({
			customType: "verification-blocker-summary",
			content: `Stopped at the verification blocker. Remaining work: restore access, resume the real user journey, and complete the missing evidence (${tracker.missingEvidence().join("; ") || "verification report"}).`,
			display: true,
		});
	}

	async function requestInstruction(ctx: ExtensionContext): Promise<void> {
		const instruction = await ctx.ui.input("Your instruction", "Type what Pi should do next");
		if (!instruction?.trim()) return;
		resumeWithMessage(ctx, instruction.trim());
	}

	function resumeWithMessage(ctx: ExtensionContext, message: string): void {
		if (!tracker.resumeAfterBlocker()) return;
		blockerCardShown = false;
		blockerScreenshotReserved = false;
		lastPromptedBlockerSequence = undefined;
		persistState();
		updateStatus(ctx);
		pi.sendUserMessage(message);
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

	registerBlockerCardRenderer(pi);

	pi.registerTool({
		name: "verification_report",
		label: "Verification Report",
		description:
			"Record the final observed verification result for a changed feature. Passing is accepted only after successful command-level checks and, for UI work, a complete browser user journey after the latest edit.",
		promptSnippet: "Complete changed features with evidence-backed automated and user-level verification",
		promptGuidelines: [
			"Call verification_report before claiming a changed feature is complete.",
			"If a check finds an issue, fix it and repeat all checks after the last edit before reporting passed.",
			"Keep browser screenshots and Playwright output only in OS temporary storage and do not retain them unless the user explicitly asks.",
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
			cleanupVerificationArtifacts();
			if (!tracker.currentBlocker()) blockerCardShown = false;
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
				blockerCardShown = false;
				blockerScreenshotReserved = false;
				await resetWorkspaceBaseline(ctx);
				ctx.ui.notify("Automatic feature verification enabled.", "info");
			} else if (action === "off") {
				tracker.setEnabled(false);
				toolCallGenerations.clear();
				ctx.ui.notify("Automatic feature verification disabled for this session.", "warning");
			} else if (action === "reset") {
				tracker.retryVerification();
				blockerCardShown = false;
				blockerScreenshotReserved = false;
				lastPromptedBlockerSequence = undefined;
				mutationGeneration += 1;
				toolCallGenerations.clear();
				await resetWorkspaceBaseline(ctx);
				ctx.ui.notify("Feature verification evidence cleared; the pending change still requires a fresh pass.", "info");
			} else if (action === "resume") {
				if (!tracker.resumeAfterBlocker()) {
					ctx.ui.notify("Verification is not waiting at a blocker.", "warning");
					return;
				}
				blockerCardShown = false;
				blockerScreenshotReserved = false;
				lastPromptedBlockerSequence = undefined;
				ctx.ui.notify("Verification resumed in the existing session.", "info");
				pi.sendUserMessage("Resume verification in the existing browser session from navigation. Do not create a substitute page.");
			} else if (action === "status") {
				const missing = tracker.missingEvidence();
				ctx.ui.notify(
					`${tracker.statusText()}${missing.length > 0 ? `\nMissing: ${missing.join("; ")}` : ""}`,
					"info",
				);
				return;
			} else {
				ctx.ui.notify("Usage: /verification [status|on|off|reset|resume]", "warning");
				return;
			}
			persistState();
			updateStatus(ctx);
		},
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || event.streamingBehavior !== undefined) return;
		cleanupVerificationArtifacts();
		tracker.beginUserTask();
		if (!tracker.currentBlocker()) blockerCardShown = false;
		toolCallGenerations.clear();
		await resetWorkspaceBaseline(ctx);
		persistState();
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async () => {
		if (!tracker.isEnabled()) return;
		const blocker = tracker.currentBlocker();
		if (blocker) {
			return {
				message: {
					customType: "verification-blocker-context",
					content: `Verification is paused: ${blocker.summary} Do not use browser tools again unless the user explicitly resumes. You may only follow the user's selected fallback.`,
					display: false,
				},
			};
		}
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

	pi.on("tool_call", async (event, ctx) => {
		const input = asRecord(event.input);
		const proposedHarness = verificationHarnessFromTool(event.toolName, input);
		if (proposedHarness && tracker.requiresVerification()) {
			const approved = ctx.hasUI && await ctx.ui.confirm(
				"Verification harness proposed",
				`The agent proposed ${proposedHarness} instead of using only the real feature. Allow this one tool call?`,
			);
			if (!approved) {
				return {
					block: true,
					reason: "A verification-only page or fixture requires explicit user approval. Verify the real target or explain why a harness is necessary.",
				};
			}
		}
		const browserTool = browserToolFromCall(event.toolName, input);
		const blocker = tracker.currentBlocker();
		if (blocker) {
			const screenshotAllowed = tracker.isAwaitingUser()
				&& browserTool === "browser_take_screenshot"
				&& !blockerCardShown
				&& !blockerScreenshotReserved
				&& blocker.kind !== "browser-unavailable"
				&& blocker.kind !== "environment-missing";
			if (!screenshotAllowed && (browserTool || (tracker.isAwaitingUser() && event.toolName !== "verification_report"))) {
				if (!blockerScreenshotReserved) await ctx.abort();
				return {
					block: true,
					reason: `Verification is paused: ${blocker.summary} Wait for the user's choice instead of running more tools.`,
				};
			}
			if (screenshotAllowed) {
				blockerScreenshotReserved = true;
				constrainScreenshotToViewport(event.toolName, input);
			}
		}
		const artifactPath = redirectScreenshotToTemporaryFile(event.toolName, input, event.toolCallId);
		if (artifactPath) {
			verificationArtifacts.add(artifactPath);
			verificationArtifactByCall.set(event.toolCallId, artifactPath);
		}
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
				blockerCardShown = false;
				blockerScreenshotReserved = false;
				mutationGeneration += 1;
				mutationObservedSinceSnapshot = true;
				changed = true;
			}
			const evidenceIsFresh = startedAtGeneration === mutationGeneration;
			if (verificationCommand && evidenceIsFresh) {
				changed = tracker.recordSuccessfulCheck(verificationCommand) || changed;
			}
			if (browserTool && evidenceIsFresh) {
				const output = toolResultText(event.content);
				const blocker = browserBlockerFromResult(browserTool, output);
				if (blocker) {
					changed = tracker.recordBlocker(blocker) || changed;
				} else {
					changed = tracker.recordBrowserTool(browserTool) || changed;
					const observedIssue = browserIssueFromResult(browserTool, output);
					if (observedIssue) changed = tracker.recordObservedIssue(observedIssue) || changed;
				}
			}
		} else if (startedAtGeneration === mutationGeneration) {
			if (verificationCommand) changed = tracker.recordFailedCheck(verificationCommand) || changed;
			if (browserTool) {
				const blocker = browserBlockerFromResult(browserTool, toolResultText(event.content));
				changed = blocker
					? tracker.recordBlocker(blocker) || changed
					: tracker.recordObservedIssue(`Browser check failed while running ${browserTool}.`) || changed;
			}
		}

		const artifactPath = verificationArtifactByCall.get(event.toolCallId);
		const blocker = tracker.currentBlocker();
		if (artifactPath && blocker && browserTool === "browser_take_screenshot" && !blockerCardShown) {
			await appendBlockerCard(pi, blocker, artifactPath);
			removeVerificationArtifacts([artifactPath]);
			verificationArtifacts.delete(artifactPath);
			verificationArtifactByCall.delete(event.toolCallId);
			blockerCardShown = true;
			blockerScreenshotReserved = false;
			changed = true;
		}

		if (!changed) return;
		persistState();
		updateStatus(ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!tracker.isEnabled()) return;
		const workspaceChanged = await reconcileWorkspace(ctx);
		if (workspaceChanged) {
			if (!tracker.currentBlocker()) blockerCardShown = false;
			persistState();
			updateStatus(ctx);
		}
		if (!ctx.isIdle()) return;

		if (tracker.currentBlocker()) {
			blockerScreenshotReserved = false;
			await showBlockerChoice(ctx);
			return;
		}

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
		blockerPromptOpen = false;
		blockerScreenshotReserved = false;
		lastPromptedBlockerSequence = undefined;
		restoreTrackerFromBranch(ctx);
		await resetWorkspaceBaseline(ctx);
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		blockerPromptOpen = false;
		blockerScreenshotReserved = false;
		lastPromptedBlockerSequence = undefined;
		restoreTrackerFromBranch(ctx);
		await resetWorkspaceBaseline(ctx);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (activeContext) activeContext.ui.setStatus(STATUS_ID, undefined);
		cleanupVerificationArtifacts();
		activeContext = undefined;
		lastWorkspace = undefined;
		mutationObservedSinceSnapshot = false;
		mutationGeneration = 0;
		toolCallGenerations.clear();
		verificationArtifactByCall.clear();
		blockerCardShown = false;
		blockerPromptOpen = false;
		blockerScreenshotReserved = false;
		lastPromptedBlockerSequence = undefined;
	});
}

function registerWorkflowChildArtifactPolicy(pi: ExtensionAPI): void {
	const artifacts = new Set<string>();
	pi.on("tool_call", (event) => {
		const artifactPath = redirectScreenshotToTemporaryFile(event.toolName, asRecord(event.input), event.toolCallId);
		if (artifactPath) artifacts.add(artifactPath);
	});
	pi.on("session_shutdown", () => removeVerificationArtifacts(artifacts));
}

function hasMatchingBlockerCard(ctx: ExtensionContext, kind: string, summary: string, sequence?: number): boolean {
	return ctx.sessionManager.getBranch().some((entry) => {
		if (entry.type !== "custom" || entry.customType !== BLOCKER_ENTRY_TYPE) return false;
		const blocker = asRecord(asRecord(entry.data).blocker);
		return blocker.kind === kind && blocker.summary === summary && blocker.sequence === sequence;
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

export const MAX_REPAIR_ATTEMPTS = 3;

export const VERIFICATION_KINDS = ["functional", "ui", "both"] as const;
export const VERIFICATION_STATUSES = ["passed", "failed", "blocked"] as const;

export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type VerificationPhase = "clean" | "pending" | VerificationStatus;

export interface VerificationReport {
	kind: VerificationKind;
	status: VerificationStatus;
	summary: string;
	checks: string[];
	issues?: string[];
}

export interface BrowserEvidence {
	navigated: boolean;
	inspected: boolean;
	interacted: boolean;
	consoleChecked: boolean;
	networkChecked: boolean;
	visualChecked: boolean;
}

export interface VerificationSnapshot {
	enabled: boolean;
	phase: VerificationPhase;
	attempts: number;
	functionalChange: boolean;
	uiChange: boolean;
	successfulChecks: string[];
	browser: BrowserEvidence;
	lastSummary?: string;
	issues: string[];
	exhaustionNotified: boolean;
}

export interface ReportResult {
	accepted: boolean;
	message: string;
}

const EMPTY_BROWSER_EVIDENCE: BrowserEvidence = {
	navigated: false,
	inspected: false,
	interacted: false,
	consoleChecked: false,
	networkChecked: false,
	visualChecked: false,
};

const BROWSER_EVIDENCE_BY_TOOL: Record<string, keyof BrowserEvidence | undefined> = {
	browser_navigate: "navigated",
	browser_navigate_back: "navigated",
	browser_snapshot: "inspected",
	browser_click: "interacted",
	browser_drag: "interacted",
	browser_drop: "interacted",
	browser_file_upload: "interacted",
	browser_fill_form: "interacted",
	browser_hover: "interacted",
	browser_mouse_click_xy: "interacted",
	browser_mouse_drag_xy: "interacted",
	browser_press_key: "interacted",
	browser_resize: "interacted",
	browser_select_option: "interacted",
	browser_type: "interacted",
	browser_console_messages: "consoleChecked",
	browser_network_requests: "networkChecked",
	browser_take_screenshot: "visualChecked",
};

export class VerificationTracker {
	private state: VerificationSnapshot;

	constructor(savedState?: unknown) {
		this.state = normalizeSnapshot(savedState);
	}

	snapshot(): VerificationSnapshot {
		return {
			...this.state,
			successfulChecks: [...this.state.successfulChecks],
			browser: { ...this.state.browser },
			issues: [...this.state.issues],
		};
	}

	isEnabled(): boolean {
		return this.state.enabled;
	}

	setEnabled(enabled: boolean): void {
		this.state.enabled = enabled;
		if (!enabled) this.resetProgress();
	}

	beginUserTask(): void {
		if (this.state.phase === "clean" || this.state.phase === "passed") this.resetProgress();
	}

	reset(): void {
		this.resetProgress();
	}

	retryVerification(): void {
		if (!this.state.functionalChange) {
			this.resetProgress();
			return;
		}
		this.state.phase = "pending";
		this.state.attempts = 0;
		this.state.successfulChecks = [];
		this.state.browser = { ...EMPTY_BROWSER_EVIDENCE };
		this.state.lastSummary = undefined;
		this.state.issues = [];
		this.state.exhaustionNotified = false;
	}

	recordMutation(options: { ui?: boolean } = {}): void {
		if (!this.state.enabled) return;
		if (["clean", "passed", "blocked"].includes(this.state.phase)) this.state.attempts = 0;
		this.state.phase = "pending";
		this.state.functionalChange = true;
		this.state.uiChange ||= options.ui === true;
		this.state.successfulChecks = [];
		this.state.browser = { ...EMPTY_BROWSER_EVIDENCE };
		this.state.lastSummary = undefined;
		this.state.issues = [];
		this.state.exhaustionNotified = false;
	}

	mergeChangedPaths(paths: string[]): boolean {
		const verifiablePaths = paths.filter(isVerifiablePath);
		if (verifiablePaths.length === 0) return false;
		this.recordMutation({ ui: verifiablePaths.some(isUiPath) });
		return true;
	}

	mergeChangedPathKinds(paths: string[]): boolean {
		const verifiablePaths = paths.filter(isVerifiablePath);
		if (verifiablePaths.length === 0) return false;
		this.state.functionalChange = true;
		this.state.uiChange ||= verifiablePaths.some(isUiPath);
		return true;
	}

	recordSuccessfulCheck(command: string): boolean {
		if (!this.requiresVerification() || !isVerificationCommand(command)) return false;
		const normalizedCommand = collapseWhitespace(command);
		if (!this.state.successfulChecks.includes(normalizedCommand)) {
			this.state.successfulChecks.push(normalizedCommand);
		}
		if (this.state.phase === "failed") this.state.phase = "pending";
		return true;
	}

	recordFailedCheck(command: string): boolean {
		if (!this.requiresVerification() || !isVerificationCommand(command)) return false;
		this.state.phase = "failed";
		this.state.lastSummary = `Verification command failed: ${collapseWhitespace(command)}`;
		return true;
	}

	recordBrowserTool(toolName: string): boolean {
		if (!this.requiresVerification()) return false;
		const evidenceKey = BROWSER_EVIDENCE_BY_TOOL[toolName];
		if (!evidenceKey) return false;
		if (evidenceKey === "navigated") {
			this.state.browser = { ...EMPTY_BROWSER_EVIDENCE, navigated: true };
			return true;
		}
		if (evidenceKey === "inspected") {
			if (!this.state.browser.navigated) return false;
			this.state.browser.inspected = true;
			return true;
		}
		if (evidenceKey === "interacted") {
			if (!this.state.browser.navigated || !this.state.browser.inspected) return false;
			this.state.browser.interacted = true;
			this.state.browser.consoleChecked = false;
			this.state.browser.networkChecked = false;
			this.state.browser.visualChecked = false;
			return true;
		}
		if (evidenceKey === "consoleChecked" || evidenceKey === "networkChecked") {
			if (!this.state.browser.interacted) return false;
			this.state.browser[evidenceKey] = true;
			this.state.browser.visualChecked = false;
			return true;
		}
		if (!this.state.browser.interacted || !this.state.browser.consoleChecked || !this.state.browser.networkChecked) {
			return false;
		}
		this.state.browser.visualChecked = true;
		return true;
	}

	recordObservedIssue(issue: string): boolean {
		if (!this.requiresVerification()) return false;
		const normalizedIssue = collapseWhitespace(issue).slice(0, 500);
		if (!normalizedIssue) return false;
		this.state.phase = "failed";
		this.state.lastSummary = normalizedIssue;
		if (!this.state.issues.includes(normalizedIssue)) this.state.issues.push(normalizedIssue);
		return true;
	}

	submitReport(report: VerificationReport): ReportResult {
		if (!this.state.enabled) return { accepted: true, message: "Automatic verification is disabled." };
		if (!this.requiresVerification()) {
			return { accepted: false, message: "No changed feature is waiting for verification." };
		}

		this.declareKind(report.kind);
		const summary = collapseWhitespace(report.summary);
		const checks = report.checks.map(collapseWhitespace).filter(Boolean);
		const issues = (report.issues ?? []).map(collapseWhitespace).filter(Boolean);
		if (!summary) return { accepted: false, message: "Verification summary must not be empty." };
		if (checks.length === 0) return { accepted: false, message: "List at least one concrete verification check." };

		if (report.status === "failed") {
			this.state.phase = "failed";
			this.state.lastSummary = summary;
			this.state.issues = [...new Set([...this.state.issues, ...issues])];
			return { accepted: true, message: "Verification failed. Fix the issue and repeat every required check." };
		}
		if (report.status === "blocked") {
			this.state.phase = "blocked";
			this.state.lastSummary = summary;
			this.state.issues = [...new Set([...this.state.issues, ...issues])];
			return { accepted: true, message: "Verification blocker recorded. Report it clearly to the user." };
		}

		if (issues.length > 0 || this.state.issues.length > 0) {
			return { accepted: false, message: "Cannot mark verification passed while unresolved issues are listed." };
		}

		const missingEvidence = this.missingEvidence();
		if (missingEvidence.length > 0) {
			return {
				accepted: false,
				message: `Cannot mark verification passed. Missing: ${missingEvidence.join("; ")}.`,
			};
		}

		this.state.phase = "passed";
		this.state.lastSummary = summary;
		this.state.issues = issues;
		return { accepted: true, message: "Verification passed with observed test and user-journey evidence." };
	}

	requiresVerification(): boolean {
		return this.state.enabled && this.state.functionalChange && this.state.phase !== "passed" && this.state.phase !== "blocked";
	}

	missingEvidence(): string[] {
		if (!this.state.functionalChange) return [];
		const missing: string[] = [];
		if (this.state.successfulChecks.length === 0) missing.push("a successful automated or command-level check");
		if (this.state.uiChange) {
			if (!this.state.browser.navigated) missing.push("browser navigation");
			if (!this.state.browser.inspected) missing.push("an accessibility snapshot");
			if (!this.state.browser.interacted) missing.push("a real user interaction or viewport resize");
			if (!this.state.browser.consoleChecked) missing.push("browser console inspection");
			if (!this.state.browser.networkChecked) missing.push("network request inspection");
			if (!this.state.browser.visualChecked) missing.push("a final screenshot");
		}
		return missing;
	}

	canRequestFollowUp(): boolean {
		return this.requiresVerification() && this.state.attempts < MAX_REPAIR_ATTEMPTS;
	}

	takeFollowUpPrompt(): string | undefined {
		if (!this.canRequestFollowUp()) return undefined;
		this.state.attempts += 1;
		const missing = this.missingEvidence();
		const previousFailure = this.state.lastSummary ? `\nPrevious result: ${this.state.lastSummary}` : "";
		const issueText = this.state.issues.length > 0 ? `\nKnown issues: ${this.state.issues.join("; ")}` : "";
		const finalAttempt = this.state.attempts === MAX_REPAIR_ATTEMPTS
			? "\nThis is the final automatic repair attempt. If verification cannot pass, call verification_report with status blocked and explain the exact blocker."
			: "";
		return `[AUTOMATIC VERIFICATION REQUIRED — attempt ${this.state.attempts}/${MAX_REPAIR_ATTEMPTS}]
The changed feature is not verified yet. Act as a normal user: run the relevant automated checks, exercise the real feature, inspect failures, fix every issue, and repeat all checks after the last change.
Missing evidence: ${missing.length > 0 ? missing.join("; ") : "an accepted verification_report"}.${previousFailure}${issueText}${finalAttempt}
Do not give a completion response until verification_report accepts status passed.`;
	}

	shouldNotifyExhausted(): boolean {
		return this.requiresVerification()
			&& this.state.attempts >= MAX_REPAIR_ATTEMPTS
			&& !this.state.exhaustionNotified;
	}

	markExhaustionNotified(): void {
		this.state.exhaustionNotified = true;
	}

	statusText(): string {
		if (!this.state.enabled) return "verification off";
		switch (this.state.phase) {
			case "pending": return `verification pending ${this.state.attempts}/${MAX_REPAIR_ATTEMPTS}`;
			case "failed": return `verification failed ${this.state.attempts}/${MAX_REPAIR_ATTEMPTS}`;
			case "passed": return "verification passed";
			case "blocked": return "verification blocked";
			default: return "verification ready";
		}
	}

	private declareKind(kind: VerificationKind): void {
		this.state.functionalChange = true;
		if (kind === "ui" || kind === "both") this.state.uiChange = true;
	}

	private resetProgress(): void {
		this.state.phase = "clean";
		this.state.attempts = 0;
		this.state.functionalChange = false;
		this.state.uiChange = false;
		this.state.successfulChecks = [];
		this.state.browser = { ...EMPTY_BROWSER_EVIDENCE };
		this.state.lastSummary = undefined;
		this.state.issues = [];
		this.state.exhaustionNotified = false;
	}
}

export function isVerificationCommand(command: string): boolean {
	const normalized = collapseWhitespace(command).toLowerCase();
	return [
		/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|check|build|typecheck|verify|e2e)(?=\s|$)/,
		/\bnode\s+--test\b/,
		/\b(?:pytest|phpunit|pest|vitest|jest|playwright\s+test|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test)\b/,
		/\b(?:tsc|biome|eslint)\b/,
		/\b(?:curl|invoke-webrequest|invoke-restmethod)\b/,
	].some((pattern) => pattern.test(normalized));
}

export function isVerifiablePath(filePath: string): boolean {
	const normalized = normalizePath(filePath);
	if (!normalized || normalized.startsWith(".git/") || normalized.includes("/node_modules/")) return false;
	if (/(^|\/)(?:coverage|dist|build|target|vendor|\.next|\.cache)(\/|$)/.test(normalized)) return false;
	if (/(^|\/)(?:docs?|documentation)(\/|$)/.test(normalized)) return false;
	if (/(^|\/)(?:readme|changelog|license|contributing|code_of_conduct)(?:\.[^/]*)?$/.test(normalized)) return false;
	return !/\.(?:md|mdx|rst|txt)$/.test(normalized);
}

export function isUiPath(filePath: string): boolean {
	const normalized = normalizePath(filePath);
	return /\.(?:css|scss|sass|less|html?|jsx|tsx|vue|svelte|astro)$/.test(normalized)
		|| /\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/.test(normalized)
		|| /(^|\/)(?:ui|frontend|client|components?|pages?|views?|widgets?|templates?|themes?|styles?|public|assets)(\/|$)/.test(normalized);
}

function normalizeSnapshot(candidate: unknown): VerificationSnapshot {
	const record = isRecord(candidate) ? candidate : {};
	const browser = isRecord(record.browser) ? record.browser : {};
	const phase = ["clean", "pending", "passed", "failed", "blocked"].includes(String(record.phase))
		? record.phase as VerificationPhase
		: "clean";
	return {
		enabled: record.enabled !== false,
		phase,
		attempts: boundedInteger(record.attempts, 0, MAX_REPAIR_ATTEMPTS),
		functionalChange: record.functionalChange === true,
		uiChange: record.uiChange === true,
		successfulChecks: stringArray(record.successfulChecks),
		browser: {
			navigated: browser.navigated === true,
			inspected: browser.inspected === true,
			interacted: browser.interacted === true,
			consoleChecked: browser.consoleChecked === true,
			networkChecked: browser.networkChecked === true,
			visualChecked: browser.visualChecked === true,
		},
		lastSummary: typeof record.lastSummary === "string" ? record.lastSummary : undefined,
		issues: stringArray(record.issues),
		exhaustionNotified: record.exhaustionNotified === true,
	};
}

function normalizePath(filePath: string): string {
	return filePath.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function collapseWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isInteger(value)) return minimum;
	return Math.min(maximum, Math.max(minimum, value));
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string").map(collapseWhitespace).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

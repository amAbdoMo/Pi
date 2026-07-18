const WORKFLOW_ACTIVITY_KEY = "__amabdomo_pi_workflow_activity_v1";

export interface WorkflowDelegateActivity {
	readonly running: number;
	readonly total: number;
	readonly waiting: number;
	readonly nested: number;
}

export interface WorkflowMcpActivity {
	readonly id: string;
	readonly action?: string;
	readonly server?: string;
	readonly tool?: string;
	readonly status: "running" | "succeeded" | "failed";
	readonly startedAt: number;
	readonly endedAt?: number;
}

export interface WorkflowActivitySnapshot {
	readonly runId: string;
	readonly workflowId: string;
	readonly phaseId?: string;
	readonly delegates: WorkflowDelegateActivity;
	readonly mcpCalls: readonly WorkflowMcpActivity[];
	readonly updatedAt: number;
}

interface DelegateStatus {
	running: number;
	total: number;
	waiting: number;
	nested: number;
}

interface SharedWorkflowActivity {
	runId?: string;
	workflowId?: string;
	phaseId?: string;
	delegateCalls: Set<string>;
	delegateSeen: Set<string>;
	delegateStatus: DelegateStatus;
	mcpCalls: Map<string, WorkflowMcpActivity>;
	updatedAt: number;
	listeners: Set<() => void>;
}

function emptyDelegateStatus(): DelegateStatus {
	return { running: 0, total: 0, waiting: 0, nested: 0 };
}

function sharedActivity(): SharedWorkflowActivity {
	const root = globalThis as typeof globalThis & { [WORKFLOW_ACTIVITY_KEY]?: SharedWorkflowActivity };
	root[WORKFLOW_ACTIVITY_KEY] ??= {
		delegateCalls: new Set(),
		delegateSeen: new Set(),
		delegateStatus: emptyDelegateStatus(),
		mcpCalls: new Map(),
		updatedAt: 0,
		listeners: new Set(),
	};
	return root[WORKFLOW_ACTIVITY_KEY];
}

function notify(activity: SharedWorkflowActivity): void {
	activity.updatedAt = Date.now();
	for (const listener of activity.listeners) listener();
}

function resetPhaseActivity(activity: SharedWorkflowActivity): void {
	activity.delegateCalls.clear();
	activity.delegateSeen.clear();
	activity.delegateStatus = emptyDelegateStatus();
	activity.mcpCalls.clear();
}

function textField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function countFromStatus(text: string, pattern: RegExp): number {
	const count = Number(text.match(pattern)?.[1] ?? 0);
	return Number.isFinite(count) && count > 0 ? count : 0;
}

function parseDelegateStatus(text: unknown): DelegateStatus {
	if (typeof text !== "string") return emptyDelegateStatus();
	const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
	return {
		running: countFromStatus(clean, /agents\s+(\d+)\/\d+\s+running/i),
		total: countFromStatus(clean, /agents\s+\d+\/(\d+)\s+running/i),
		waiting: countFromStatus(clean, /(\d+)\s+waiting/i),
		nested: countFromStatus(clean, /(\d+)\s+nested/i),
	};
}

function activityForRun(runId: string): SharedWorkflowActivity | undefined {
	const activity = sharedActivity();
	return activity.runId === runId ? activity : undefined;
}

function toolCallKey(event: Record<string, unknown>, prefix: string): string {
	return textField(event.toolCallId) ?? `${prefix}:${textField(event.toolName) ?? "unknown"}`;
}

function mcpActivity(event: Record<string, unknown>, existing?: WorkflowMcpActivity): WorkflowMcpActivity {
	const args = event.args && typeof event.args === "object" && !Array.isArray(event.args) ? event.args as Record<string, unknown> : {};
	const ended = event.type === "tool_execution_end";
	return {
		id: toolCallKey(event, "mcp"),
		action: textField(args.action) ?? existing?.action,
		server: textField(args.server) ?? existing?.server,
		tool: textField(args.tool) ?? existing?.tool,
		status: ended ? (event.isError ? "failed" : "succeeded") : "running",
		startedAt: existing?.startedAt ?? Date.now(),
		endedAt: ended ? Date.now() : undefined,
	};
}

export function beginWorkflowActivity(runId: string, workflowId: string): void {
	const activity = sharedActivity();
	activity.runId = runId;
	activity.workflowId = workflowId;
	activity.phaseId = undefined;
	resetPhaseActivity(activity);
	notify(activity);
}

export function setWorkflowActivityPhase(runId: string, phaseId: string): void {
	const activity = activityForRun(runId);
	if (!activity) return;
	activity.phaseId = phaseId;
	resetPhaseActivity(activity);
	notify(activity);
}

export function projectWorkflowActivityEvent(runId: string, event: unknown): void {
	const activity = activityForRun(runId);
	if (!activity || !event || typeof event !== "object" || Array.isArray(event)) return;
	const record = event as Record<string, unknown>;
	const type = textField(record.type);
	const toolName = textField(record.toolName);
	if (type === "extension_ui_request" && record.method === "setStatus" && record.statusKey === "subagents") {
		const status = parseDelegateStatus(record.statusText);
		activity.delegateStatus = activity.delegateSeen.size > 0 && activity.delegateCalls.size === 0
			? { ...status, running: 0, waiting: 0, nested: 0 }
			: status;
		notify(activity);
		return;
	}
	if (!type?.startsWith("tool_execution_") || !toolName) return;
	const key = toolCallKey(record, toolName);
	if (toolName === "delegate") {
		if (type === "tool_execution_start") {
			activity.delegateCalls.add(key);
			activity.delegateSeen.add(key);
		} else if (type === "tool_execution_end") {
			const removed = activity.delegateCalls.delete(key);
			if (removed) {
				activity.delegateStatus = {
					...activity.delegateStatus,
					running: Math.max(0, activity.delegateStatus.running - 1),
				};
			}
			if (activity.delegateCalls.size === 0) {
				activity.delegateStatus = { ...activity.delegateStatus, running: 0, waiting: 0, nested: 0 };
			}
		}
		notify(activity);
		return;
	}
	if (toolName !== "mcp") return;
	if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
		activity.mcpCalls.set(key, mcpActivity(record, activity.mcpCalls.get(key)));
	}
	notify(activity);
}

export function clearWorkflowActivity(runId?: string): void {
	const activity = sharedActivity();
	if (runId && activity.runId !== runId) return;
	activity.runId = undefined;
	activity.workflowId = undefined;
	activity.phaseId = undefined;
	resetPhaseActivity(activity);
	notify(activity);
}

export function getWorkflowActivitySnapshot(): WorkflowActivitySnapshot | undefined {
	const activity = sharedActivity();
	if (!activity.runId || !activity.workflowId) return undefined;
	const delegates = Object.freeze({
		running: Math.max(activity.delegateCalls.size, activity.delegateStatus.running),
		total: Math.max(activity.delegateSeen.size, activity.delegateStatus.total),
		waiting: activity.delegateStatus.waiting,
		nested: activity.delegateStatus.nested,
	});
	const mcpCalls = Object.freeze(Array.from(activity.mcpCalls.values(), (call) => Object.freeze({ ...call })));
	return Object.freeze({
		runId: activity.runId,
		workflowId: activity.workflowId,
		phaseId: activity.phaseId,
		delegates,
		mcpCalls,
		updatedAt: activity.updatedAt,
	});
}

export function hasActiveWorkflowActivity(): boolean {
	return getWorkflowActivitySnapshot() !== undefined;
}

export function subscribeWorkflowActivity(listener: () => void): () => void {
	const activity = sharedActivity();
	activity.listeners.add(listener);
	return () => activity.listeners.delete(listener);
}

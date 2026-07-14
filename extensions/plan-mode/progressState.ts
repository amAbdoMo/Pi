import type { TodoItem } from "./utils.ts";

const PLAN_PROGRESS_STATE_KEY = "__amabdomo_pi_plan_progress_v1";

export interface PlanProgressSnapshot {
	executing: boolean;
	items: TodoItem[];
}

interface SharedPlanProgressState extends PlanProgressSnapshot {
	listeners: Set<() => void>;
}

function sharedState(): SharedPlanProgressState {
	const root = globalThis as typeof globalThis & {
		[PLAN_PROGRESS_STATE_KEY]?: SharedPlanProgressState;
	};
	root[PLAN_PROGRESS_STATE_KEY] ??= {
		executing: false,
		items: [],
		listeners: new Set(),
	};
	return root[PLAN_PROGRESS_STATE_KEY];
}

export function publishPlanProgress(items: readonly TodoItem[], executing: boolean): void {
	const state = sharedState();
	state.executing = executing;
	state.items = items.map((item) => ({ ...item }));
	for (const listener of state.listeners) listener();
}

export function getPlanProgress(): PlanProgressSnapshot {
	const state = sharedState();
	return {
		executing: state.executing,
		items: state.items.map((item) => ({ ...item })),
	};
}

export function subscribePlanProgress(listener: () => void): () => void {
	const state = sharedState();
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}

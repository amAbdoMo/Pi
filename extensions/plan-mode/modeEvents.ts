export type PlanBuildMode = "plan" | "build";

type SharedEventBus = {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
};

const MODE_CHANGED_CHANNEL = "amabdomo:plan-build-mode:changed";
const TOGGLE_REQUESTED_CHANNEL = "amabdomo:plan-build-mode:toggle-requested";

export function publishPlanBuildMode(events: SharedEventBus, mode: PlanBuildMode): void {
	events.emit(MODE_CHANGED_CHANNEL, mode);
}

export function subscribePlanBuildModeChanges(
	events: SharedEventBus,
	listener: (mode: PlanBuildMode) => void,
): () => void {
	return events.on(MODE_CHANGED_CHANNEL, (mode) => {
		if (mode === "plan" || mode === "build") listener(mode);
	});
}

export function requestPlanBuildModeToggle(events: SharedEventBus): void {
	events.emit(TOGGLE_REQUESTED_CHANNEL, undefined);
}

export function subscribePlanBuildModeToggleRequests(
	events: SharedEventBus,
	listener: () => void,
): () => void {
	return events.on(TOGGLE_REQUESTED_CHANNEL, listener);
}

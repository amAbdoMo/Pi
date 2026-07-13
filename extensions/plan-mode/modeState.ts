export type PlanBuildMode = "plan" | "build";

type ModeListener = (mode: PlanBuildMode) => void;
type ToggleHandler = () => boolean;

let currentMode: PlanBuildMode = "build";
let toggleHandler: ToggleHandler | undefined;
const listeners = new Set<ModeListener>();

export function getPlanBuildMode(): PlanBuildMode {
	return currentMode;
}

export function setPlanBuildMode(mode: PlanBuildMode): void {
	if (mode === currentMode) return;
	currentMode = mode;
	for (const listener of listeners) listener(mode);
}

export function subscribePlanBuildMode(listener: ModeListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setPlanBuildModeToggleHandler(handler: ToggleHandler | undefined): void {
	toggleHandler = handler;
}

export function requestPlanBuildModeToggle(): boolean {
	return toggleHandler?.() ?? false;
}

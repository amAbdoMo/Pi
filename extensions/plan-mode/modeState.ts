import type { PlanBuildMode } from "./modeEvents.ts";

type ModeListener = (mode: PlanBuildMode) => void;

let currentMode: PlanBuildMode = "build";
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

import { notifyEditors } from "./editorRegistry.ts";
import {
  AgentTimeTracker,
  workedLabel,
  workingLabel,
} from "./agentTimeTracker.ts";

export const agentTimeStatus = { label: "", working: false };

const tracker = new AgentTimeTracker();
let interval: ReturnType<typeof setInterval> | undefined;

function updateLiveStatus(nowMs: number): void {
  agentTimeStatus.label = workingLabel(tracker.elapsedMs(nowMs));
  agentTimeStatus.working = true;
}

function stopInterval(): void {
  if (interval === undefined) return;
  clearInterval(interval);
  interval = undefined;
}

export function startAgentTime(nowMs: number = Date.now()): void {
  if (!tracker.start(nowMs)) return;
  updateLiveStatus(nowMs);
  notifyEditors();
  stopInterval();
  interval = setInterval(() => {
    updateLiveStatus(Date.now());
    notifyEditors();
  }, 1_000);
  interval.unref?.();
}

export function settleAgentTime(nowMs: number = Date.now()): void {
  const elapsedMs = tracker.settle(nowMs);
  if (elapsedMs === null) return;

  stopInterval();
  agentTimeStatus.label = workedLabel(elapsedMs);
  agentTimeStatus.working = false;
  notifyEditors();
}

export function resetAgentTime(): void {
  stopInterval();
  tracker.reset();
  agentTimeStatus.label = "";
  agentTimeStatus.working = false;
  notifyEditors();
}

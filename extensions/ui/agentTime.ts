import { notifyEditors } from "./editorRegistry.ts";
import {
  AgentTimeTracker,
  workedLabel,
  workingLabel,
} from "./agentTimeTracker.ts";

export const AGENT_WORKED_ENTRY_TYPE = "agent-worked";

export interface AgentWorkedEntry {
  elapsedMs: number;
}

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

export function settleAgentTime(nowMs: number = Date.now()): number | null {
  const elapsedMs = tracker.settle(nowMs);
  if (elapsedMs === null) return null;

  stopInterval();
  agentTimeStatus.label = workedLabel(elapsedMs);
  agentTimeStatus.working = false;
  notifyEditors();
  return elapsedMs;
}

export function resetAgentTime(): void {
  stopInterval();
  tracker.reset();
  agentTimeStatus.label = "";
  agentTimeStatus.working = false;
  notifyEditors();
}

function elapsedBetween(startedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startedAtMs);
}

export class AgentTimeTracker {
  private startedAtMs: number | null = null;

  start(nowMs: number): boolean {
    if (this.startedAtMs !== null) return false;
    this.startedAtMs = nowMs;
    return true;
  }

  settle(nowMs: number): number | null {
    if (this.startedAtMs === null) return null;
    const elapsedMs = elapsedBetween(this.startedAtMs, nowMs);
    this.startedAtMs = null;
    return elapsedMs;
  }

  reset(): void {
    this.startedAtMs = null;
  }

  elapsedMs(nowMs: number): number {
    return this.startedAtMs === null
      ? 0
      : elapsedBetween(this.startedAtMs, nowMs);
  }
}

export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (value: number) => String(value).padStart(2, "0");

  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  return `${seconds}s`;
}

export const AGENT_TIME_ICON = "";

export function workingLabel(elapsedMs: number): string {
  return `${AGENT_TIME_ICON} working ${formatElapsedDuration(elapsedMs)}`;
}

export function workedLabel(elapsedMs: number): string {
  return `${AGENT_TIME_ICON} worked ${formatElapsedDuration(elapsedMs)}`;
}

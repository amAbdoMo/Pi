import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SubagentStatus } from "../types.ts";

export {
  framedPanel,
  framedPanelContentWidth,
} from "../../ui/framedPanel.ts";

export const LAST_TOOL_CALL_COUNT = 3;

export class OneLineList implements Component {
  constructor(private readonly lines: string[]) {}
  render(width: number): string[] {
    return this.lines.map((line) => truncateToWidth(line, width, "…", true));
  }
  invalidate(): void {}
}

export function statusRank(status: SubagentStatus): number {
  return status === "waiting_for_answer"
    ? 0
    : status === "running" || status === "starting"
      ? 1
      : 2;
}

export function fitAnsi(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "…", true);
}

export function statusText(status: SubagentStatus, theme: Theme): string {
  switch (status) {
    case "queued":
      return theme.fg("muted", "○ queued");
    case "starting":
      return theme.fg("accent", "◉ starting");
    case "running":
      return theme.fg("accent", "◉ running");
    case "waiting_for_answer":
      return theme.fg("warning", "◉ waiting");
    case "completed":
      return theme.fg("success", "✓ completed");
    case "failed":
      return theme.fg("error", "✕ failed");
    case "aborted":
      return theme.fg("warning", "– aborted");
  }
}

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SubagentStatus } from "../types.ts";

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

export function framedPanel(
  theme: Theme,
  title: string,
  body: string[],
  width: number,
  minBodyRows: number,
): string[] {
  const panelWidth = Math.max(4, width);
  const innerWidth = panelWidth - 2;
  const padX = innerWidth >= 4 ? 1 : 0;
  const contentWidth = Math.max(0, innerWidth - padX * 2);
  const border = (text: string) => theme.fg("border", text);
  const maxTitleWidth = Math.max(0, innerWidth - 2);
  const fittedTitle = fitAnsi(theme.bold(title), maxTitleWidth);
  const titleText = maxTitleWidth > 0 ? ` ${theme.fg("accent", fittedTitle)} ` : "";
  const right = Math.max(0, innerWidth - visibleWidth(titleText));
  const lines = [border("┌") + titleText + border(`${"─".repeat(right)}┐`)];
  const rows = body.slice();
  while (rows.length < minBodyRows) rows.push("");
  for (const row of rows) {
    const fitted = fitAnsi(row, contentWidth);
    const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted)));
    lines.push(
      border("│") +
        " ".repeat(padX) +
        fitted +
        fill +
        " ".repeat(padX) +
        border("│"),
    );
  }
  lines.push(border(`└${"─".repeat(innerWidth)}┘`));
  return lines.map((line) => truncateToWidth(line, width, "", true));
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

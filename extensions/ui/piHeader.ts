import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UiTheme } from "./types.ts";
import { composerFrame } from "./workbenchLayout.ts";

function tone(theme: UiTheme, role: string, text: string): string {
  return theme.fg(role, text);
}

function fit(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function topBorder(theme: UiTheme, width: number): string {
  if (width === 0) return "";
  if (width < 4) return fit(tone(theme, "accent", "PI"), width);

  const title = tone(theme, "accent", theme.bold?.(" PI WORKBENCH ") ?? " PI WORKBENCH ");
  const fittedTitle = truncateToWidth(title, width - 3, "");
  const fillWidth = Math.max(0, width - 3 - visibleWidth(fittedTitle));
  return (
    tone(theme, "borderMuted", "┌─") +
    fittedTitle +
    tone(theme, "borderMuted", `${"─".repeat(fillWidth)}┐`)
  );
}

function bodyLine(theme: UiTheme, content: string, width: number): string {
  if (width < 4) return fit(content, width);
  return (
    tone(theme, "borderMuted", "│ ") +
    fit(content, width - 4) +
    tone(theme, "borderMuted", " │")
  );
}

function bottomBorder(theme: UiTheme, width: number): string {
  if (width === 0) return "";
  if (width === 1) return tone(theme, "borderMuted", "─");
  return tone(theme, "borderMuted", `└${"─".repeat(width - 2)}┘`);
}

export function workbenchHeader(theme: UiTheme, suppliedWidth: number): string[] {
  const width = composerFrame(suppliedWidth).width;
  const descriptor = width >= 46 ? "extension workbench · keyboard native" : "terminal workbench";
  return [
    topBorder(theme, width),
    bodyLine(theme, tone(theme, "muted", descriptor), width),
    bottomBorder(theme, width),
  ];
}

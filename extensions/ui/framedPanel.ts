import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sidebarPanelContentWidth } from "./workbenchSidebarLayout.ts";

export interface FramedPanelOptions {
  title: string;
  body: readonly string[];
  width: number;
  minBodyRows?: number;
}

export const framedPanelContentWidth = sidebarPanelContentWidth;

export function framedPanel(
  theme: Theme,
  options: FramedPanelOptions,
): string[] {
  const width = Math.max(0, Math.floor(options.width));
  const body = paddedBody(options.body, options.minBodyRows ?? 0);
  if (width < 4) return narrowPanel(theme, options.title, body, width);

  const lines = [
    panelTitleLine(theme, options.title, width),
    ...body.map((line) => panelBodyLine(theme, line, width)),
    theme.fg("border", `└${"─".repeat(width - 2)}┘`),
  ];
  return lines.map((line) =>
    paintPanelBackground(theme, truncateToWidth(line, width, "", true))
  );
}

function paddedBody(body: readonly string[], minimumRows: number): string[] {
  const rows = [...body];
  while (rows.length < minimumRows) rows.push("");
  return rows;
}

function narrowPanel(
  theme: Theme,
  title: string,
  body: readonly string[],
  width: number,
): string[] {
  return [theme.fg("accent", theme.bold(title)), ...body, ""].map((line) =>
    paintPanelBackground(theme, truncateToWidth(line, width, "", true))
  );
}

function panelTitleLine(theme: Theme, title: string, width: number): string {
  const titleWidth = width - 3;
  const fittedTitle = truncateToWidth(` ${title} `, titleWidth, "");
  const fill = "─".repeat(Math.max(0, titleWidth - visibleWidth(fittedTitle)));
  return theme.fg("border", "┌─") +
    theme.fg("accent", theme.bold(fittedTitle)) +
    theme.fg("border", `${fill}┐`);
}

function panelBodyLine(theme: Theme, line: string, width: number): string {
  const innerWidth = width - 2;
  const padding = " ".repeat(innerWidth >= 4 ? 2 : 0);
  const contentWidth = framedPanelContentWidth(width);
  const content = truncateToWidth(line, contentWidth, "…", true);
  const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
  const border = theme.fg("border", "│");
  return `${border}${padding}${content}${fill}${padding}${border}`;
}

function paintPanelBackground(theme: Theme, line: string): string {
  const backgroundAnsi = theme.getBgAnsi?.("customMessageBg");
  if (backgroundAnsi) {
    const painted = line.replace(
      /\x1b\[(?:0|49)m/g,
      (reset) => `${reset}${backgroundAnsi}`,
    );
    return `${backgroundAnsi}${painted}\x1b[49m`;
  }
  return theme.bg("customMessageBg", line);
}

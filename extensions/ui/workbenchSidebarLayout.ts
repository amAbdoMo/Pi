import type { McpServerState } from "../mcp/types.ts";

const RAIL_MIN_COLUMNS = 118;
const RAIL_GUTTER_COLUMNS = 1;

export type SidebarPresentation = "rail" | "overlay";
export type SidebarMcpStatusTone = "success" | "accent" | "error" | "dim";

export interface SidebarOverlayLayout {
  anchor: "top-right" | "center";
  width: number | `${number}%`;
  maxHeight: `${number}%`;
  margin: number;
  nonCapturing: boolean;
}

export interface SidebarTitleRule {
  left: string;
  title: string;
  right: string;
}

export function sidebarPresentation(terminalColumns: number): SidebarPresentation {
  return terminalColumns >= RAIL_MIN_COLUMNS ? "rail" : "overlay";
}

export function sidebarColumnWidth(terminalColumns: number): number {
  return Math.max(34, Math.min(46, Math.floor(terminalColumns * 0.24)));
}

export function sidebarGutterWidth(terminalColumns: number): number {
  return sidebarPresentation(terminalColumns) === "rail"
    ? RAIL_GUTTER_COLUMNS
    : 0;
}

export function sidebarPanelContentWidth(panelWidth: number): number {
  const innerWidth = Math.max(2, panelWidth - 2);
  const horizontalPadding = innerWidth >= 4 ? 2 : 0;
  return Math.max(1, innerWidth - horizontalPadding * 2);
}

export function sidebarSectionContentWidth(sectionWidth: number): number {
  const safeWidth = Math.max(0, Math.floor(sectionWidth));
  return safeWidth >= 4 ? safeWidth - 4 : safeWidth;
}

export function sidebarTitleRule(
  sectionWidth: number,
  title: string,
): SidebarTitleRule {
  const safeWidth = Math.max(0, Math.floor(sectionWidth));
  if (safeWidth < 4) {
    return { left: "", title: title.slice(0, safeWidth), right: "" };
  }

  const fittedTitle = ` ${title} `.slice(0, safeWidth - 3);
  const fillWidth = Math.max(0, safeWidth - 3 - fittedTitle.length);
  return {
    left: "┌─",
    title: fittedTitle,
    right: `${"─".repeat(fillWidth)}┐`,
  };
}

export function compactTokenCount(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) {
    return `${Number((safeValue / 1_000_000).toFixed(1))}m`;
  }
  if (safeValue >= 1_000) return `${Math.round(safeValue / 1_000)}k`;
  return String(safeValue);
}

export function sidebarMcpStatusSymbol(status: McpServerState): string {
  switch (status) {
    case "connected":
    case "disabled":
      return "●";
    case "connecting":
      return "◉";
    case "error":
      return "×";
    case "disconnected":
      return "○";
  }
}

export function sidebarMcpStatusTone(status: McpServerState): SidebarMcpStatusTone {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "accent";
    case "error":
    case "disabled":
      return "error";
    case "disconnected":
      return "dim";
  }
}

export function sidebarMcpStateLabel(status: McpServerState): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disabled":
      return "Disabled";
    case "error":
      return "Error";
    case "disconnected":
      return "Disconnected";
  }
}

export function sidebarOverlayOptions(terminalColumns: number): SidebarOverlayLayout {
  if (sidebarPresentation(terminalColumns) === "rail") {
    return {
      anchor: "top-right",
      width: sidebarColumnWidth(terminalColumns),
      maxHeight: "100%",
      margin: 0,
      nonCapturing: true,
    };
  }
  return {
    anchor: "center",
    width: "90%",
    maxHeight: "86%",
    margin: 1,
    nonCapturing: false,
  };
}

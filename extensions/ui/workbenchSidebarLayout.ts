import type { McpServerState } from "../mcp/types.ts";

const RAIL_MIN_COLUMNS = 118;
const RAIL_GUTTER_COLUMNS = 1;

export type SidebarPresentation = "rail" | "overlay";

export interface SidebarOverlayLayout {
  anchor: "top-right" | "center";
  width: number | `${number}%`;
  maxHeight: `${number}%`;
  margin: number;
  nonCapturing: boolean;
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

export function sidebarSectionTopBorder(sectionWidth: number): string {
  const safeWidth = Math.max(0, Math.floor(sectionWidth));
  if (safeWidth === 0) return "";
  if (safeWidth === 1) return "─";
  return `┌${"─".repeat(safeWidth - 2)}┐`;
}

export function compactTokenCount(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) {
    return `${Number((safeValue / 1_000_000).toFixed(1))}m`;
  }
  if (safeValue >= 1_000) return `${Math.round(safeValue / 1_000)}k`;
  return String(safeValue);
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

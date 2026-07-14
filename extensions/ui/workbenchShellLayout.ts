import {
  sidebarColumnWidth,
  sidebarPresentation,
} from "./workbenchSidebarLayout.ts";

export interface WorkbenchDimensions {
  height: number;
  mainWidth: number;
  sidebarWidth: number;
  showSidebar: boolean;
}

export type MouseInputKind = "wheel-up" | "wheel-down" | "other";

export function mouseInputKind(input: string): MouseInputKind | undefined {
  const match = /\x1b\[<(\d+);\d+;\d+[mM]/.exec(input);
  if (!match) return undefined;
  const buttonCode = Number(match[1]);
  if ((buttonCode & 64) === 0) return "other";
  if ((buttonCode & 3) === 0) return "wheel-up";
  if ((buttonCode & 3) === 1) return "wheel-down";
  return "other";
}

export function workbenchDimensions(
  terminalWidth: number,
  terminalHeight: number,
  sidebarRequested: boolean,
): WorkbenchDimensions {
  const width = Math.max(1, Math.floor(terminalWidth));
  const height = Math.max(1, Math.floor(terminalHeight));
  const showSidebar = sidebarRequested && sidebarPresentation(width) === "rail";
  const sidebarWidth = showSidebar ? sidebarColumnWidth(width) : 0;
  return {
    height,
    mainWidth: Math.max(1, width - sidebarWidth),
    sidebarWidth,
    showSidebar,
  };
}

export function fixedViewport(
  scrollLines: readonly string[],
  dockLines: readonly string[],
  height: number,
  scrollOffset = 0,
): string[] {
  const viewportHeight = Math.max(1, Math.floor(height));
  const visibleDock = dockLines.slice(-viewportHeight);
  const scrollHeight = Math.max(0, viewportHeight - visibleDock.length);
  const maxOffset = Math.max(0, scrollLines.length - scrollHeight);
  const offset = Math.max(0, Math.min(Math.floor(scrollOffset), maxOffset));
  const end = Math.max(0, scrollLines.length - offset);
  const start = Math.max(0, end - scrollHeight);
  const visibleScroll = scrollLines.slice(start, end);
  const spacerCount = Math.max(0, scrollHeight - visibleScroll.length);
  return [
    ...visibleScroll,
    ...Array.from({ length: spacerCount }, () => ""),
    ...visibleDock,
  ];
}

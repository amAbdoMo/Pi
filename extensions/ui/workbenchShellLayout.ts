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

// SGR mouse tracking lets Windows Terminal and Warp deliver wheel events to Pi.
// Users can still use the terminals' standard Shift+drag escape hatch for native selection.
export const WORKBENCH_ENTER_SEQUENCE = "\x1b[?1049h\x1b[?1007l\x1b[?1006h\x1b[?1000h\x1b[2J\x1b[H";
export const WORKBENCH_LEAVE_SEQUENCE = "\x1b[?1000l\x1b[?1006l\x1b[?1007h\x1b[?1049l";

export interface ViewportMetrics {
  viewportHeight: number;
  dockHeight: number;
  scrollHeight: number;
  maxOffset: number;
  offset: number;
  start: number;
  end: number;
}

export interface WorkbenchChildGroups<T> {
  scrollChildren: T[];
  dockChildren: T[];
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

export function splitWorkbenchChildren<T>(children: readonly T[]): WorkbenchChildGroups<T> {
  // InteractiveMode mounts fixed bottom chrome as:
  // status, above-editor widgets, editor, below-editor widgets, footer.
  // The above-editor widget container belongs to chat history so plan todos scroll away,
  // while status/editor/below-editor/footer remain docked at the bottom.
  if (children.length >= 9) {
    const dockStart = children.length - 5;
    const statusChild = children[dockStart];
    const aboveEditorWidgetChild = children[dockStart + 1];
    const dockTail = children.slice(dockStart + 2);
    return {
      scrollChildren: [...children.slice(0, dockStart), aboveEditorWidgetChild!],
      dockChildren: [statusChild!, ...dockTail],
    };
  }

  // Smaller test/custom TUI instances predate the full workbench child shape and
  // keep the historical "last four children are docked" behavior.
  if (children.length < 4) return { scrollChildren: [...children], dockChildren: [] };
  const dockStart = children.length - 4;
  return {
    scrollChildren: [...children.slice(0, dockStart)],
    dockChildren: [...children.slice(dockStart)],
  };
}

export function fixedViewport(
  scrollLines: readonly string[],
  dockLines: readonly string[],
  height: number,
  scrollOffset = 0,
): string[] {
  const metrics = viewportMetrics(scrollLines, dockLines, height, scrollOffset);
  const visibleScroll = scrollLines.slice(metrics.start, metrics.end);
  const spacerCount = Math.max(0, metrics.scrollHeight - visibleScroll.length);
  return [
    ...visibleScroll,
    ...Array.from({ length: spacerCount }, () => ""),
    ...dockLines.slice(-metrics.dockHeight),
  ];
}

export function viewportMetrics(
  scrollLines: readonly string[],
  dockLines: readonly string[],
  height: number,
  scrollOffset = 0,
): ViewportMetrics {
  const viewportHeight = Math.max(1, Math.floor(height));
  const dockHeight = dockLines.slice(-viewportHeight).length;
  const scrollHeight = Math.max(0, viewportHeight - dockHeight);
  const maxOffset = Math.max(0, scrollLines.length - scrollHeight);
  const offset = clampScrollOffset(scrollOffset, maxOffset);
  const end = Math.max(0, scrollLines.length - offset);
  const start = Math.max(0, end - scrollHeight);
  return { viewportHeight, dockHeight, scrollHeight, maxOffset, offset, start, end };
}

export function clampScrollOffset(scrollOffset: number, maxOffset: number): number {
  return Math.max(0, Math.min(Math.floor(scrollOffset), Math.max(0, Math.floor(maxOffset))));
}

export function preserveScrollAnchor(
  scrollOffset: number,
  previousLineCount: number | undefined,
  currentLineCount: number,
  maxOffset: number,
): number {
  if (scrollOffset <= 0) return 0;
  const appendedLines = previousLineCount === undefined
    ? 0
    : Math.max(0, currentLineCount - previousLineCount);
  return clampScrollOffset(scrollOffset + appendedLines, maxOffset);
}

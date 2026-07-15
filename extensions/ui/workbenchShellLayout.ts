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

const SGR_MOUSE_SEQUENCE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const MOUSE_MODIFIER_MASK = 4 | 8 | 16;

// SGR mouse mode lets Windows Terminal and Warp deliver wheel events to Pi while
// preserving terminal-native text selection through the standard Shift+drag escape hatch.
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

export interface ParsedWorkbenchMouseInput {
  data: string;
  wheelNotches: number;
  mouseSequences: number;
}

interface ScrollbarThumb {
  start: number;
  size: number;
}

export function workbenchMainContentWidth(mainWidth: number): number {
  const safeWidth = Math.max(0, Math.floor(mainWidth));
  return safeWidth >= 2 ? safeWidth - 1 : safeWidth;
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

export function renderChatScrollbar(
  scrollLines: readonly string[],
  dockLines: readonly string[],
  height: number,
  scrollOffset = 0,
): string[] {
  const metrics = viewportMetrics(scrollLines, dockLines, height, scrollOffset);
  const rows = Array.from({ length: metrics.viewportHeight }, () => " ");
  if (metrics.scrollHeight <= 0 || metrics.maxOffset <= 0) return rows;

  const thumb = scrollbarThumb(metrics, scrollLines.length);
  for (let row = 0; row < metrics.scrollHeight; row++) {
    rows[row] = row >= thumb.start && row < thumb.start + thumb.size ? "█" : "│";
  }
  return rows;
}

function scrollbarThumb(metrics: ViewportMetrics, totalRows: number): ScrollbarThumb {
  const size = Math.max(
    1,
    Math.min(metrics.scrollHeight, Math.floor((metrics.scrollHeight * metrics.scrollHeight) / totalRows)),
  );
  const travel = metrics.scrollHeight - size;
  const start = travel <= 0
    ? 0
    : Math.round(((metrics.maxOffset - metrics.offset) / metrics.maxOffset) * travel);
  return { start, size };
}

export function parseWorkbenchMouseInput(input: string): ParsedWorkbenchMouseInput {
  let wheelNotches = 0;
  let mouseSequences = 0;
  const data = input.replace(SGR_MOUSE_SEQUENCE, (_sequence, buttonCode, _x, _y, final) => {
    mouseSequences += 1;
    const baseButton = Number(buttonCode) & ~MOUSE_MODIFIER_MASK;
    if (final === "M" && baseButton === 64) wheelNotches += 1;
    if (final === "M" && baseButton === 65) wheelNotches -= 1;
    return "";
  });
  return { data, wheelNotches, mouseSequences };
}

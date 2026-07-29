import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import { isWorkbenchModalActive } from "./modalState.ts";
import {
  clampScrollOffset,
  fixedViewport,
  preserveScrollAnchor,
  splitWorkbenchChildren,
  viewportMetrics,
  workbenchDimensions,
  WORKBENCH_ENTER_SEQUENCE,
  WORKBENCH_LEAVE_SEQUENCE,
} from "./workbenchShellLayout.ts";
import {
  parseTerminalMouseInput,
  type ParsedTerminalMouseInput,
  type TerminalMouseEvent,
} from "./terminalCompatibility.ts";
import {
  clampSelectionPoint,
  highlightTerminalSelection,
  selectedTerminalText,
  type TextSelectionPoint,
} from "./textSelection.ts";

const WORKBENCH_SHELL_KEY = Symbol.for("amabdomo.pi.workbench-shell.v1");
const MOUSE_WHEEL_SCROLL_ROWS = 3;

export interface WorkbenchShellHandle {
  setSidebar(component: Component): void;
  setSidebarVisible(visible: boolean): void;
  dispose(): void;
}

type ShellTui = TUI & Record<symbol, WorkbenchShellHandle | undefined>;
type RenderFunction = (width: number) => string[];

interface MainViewportParts {
  scrollLines: string[];
  dockLines: string[];
}

interface ColumnRequest {
  mainLines: readonly string[];
  sidebarLines: readonly string[];
  mainWidth: number;
  sidebarWidth: number;
  height: number;
}

interface WorkbenchTextSelection {
  anchor: TextSelectionPoint;
  focus: TextSelectionPoint;
  lines: string[];
  dragging: boolean;
  moved: boolean;
  showReleasedFrame: boolean;
}

export interface WorkbenchShellOptions {
  copyText?: (text: string) => Promise<void>;
  onCopyError: (error: Error) => void;
}

export function installWorkbenchShell(
  tui: TUI,
  sidebar: Component,
  options: WorkbenchShellOptions,
): WorkbenchShellHandle {
  const shellTui = tui as ShellTui;
  const existing = shellTui[WORKBENCH_SHELL_KEY];
  if (existing) {
    existing.setSidebar(sidebar);
    return existing;
  }
  const installation = new WorkbenchShellInstallation(
    tui,
    sidebar,
    options.copyText ?? copyToClipboard,
    options.onCopyError,
  );
  shellTui[WORKBENCH_SHELL_KEY] = installation;
  return installation;
}

class WorkbenchShellInstallation implements WorkbenchShellHandle {
  private readonly originalRender: RenderFunction;
  private readonly originalStart: () => void;
  private readonly originalStop: () => void;
  private readonly removeScrollListener: () => void;
  private sidebar: Component;
  private sidebarVisible = true;
  private scrollOffset = 0;
  private previousScrollLineCount: number | undefined;
  private alternateScreenActive = false;
  private latestMainLines: string[] = [];
  private latestMainWidth = 0;
  private textSelection?: WorkbenchTextSelection;

  constructor(
    private readonly tui: TUI,
    sidebar: Component,
    private readonly copyText: (text: string) => Promise<void>,
    private readonly onCopyError: (error: Error) => void,
  ) {
    this.sidebar = sidebar;
    this.originalRender = tui.render.bind(tui);
    this.originalStart = tui.start.bind(tui);
    this.originalStop = tui.stop.bind(tui);
    this.removeScrollListener = tui.addInputListener((input) => this.handleScrollInput(input));
    this.install();
  }

  setSidebar(component: Component): void {
    this.sidebar = component;
    this.tui.requestRender(true);
  }

  setSidebarVisible(visible: boolean): void {
    if (this.sidebarVisible === visible) return;
    this.sidebarVisible = visible;
    this.tui.requestRender(true);
  }

  dispose(): void {
    this.textSelection = undefined;
    this.removeScrollListener();
    this.tui.render = this.originalRender;
    this.tui.start = this.originalStart;
    this.tui.stop = this.originalStop;
    delete (this.tui as ShellTui)[WORKBENCH_SHELL_KEY];
    this.leaveAlternateScreen();
    this.tui.requestRender(true);
  }

  private install(): void {
    this.tui.render = (width) => this.render(width);
    this.tui.start = () => {
      this.enterAlternateScreen();
      this.originalStart();
    };
    this.tui.stop = () => {
      this.originalStop();
      this.leaveAlternateScreen();
    };
    this.enterAlternateScreen();
    this.tui.setClearOnShrink(true);
    this.tui.requestRender(true);
  }

  private render(terminalWidth: number): string[] {
    const dimensions = workbenchDimensions(
      terminalWidth,
      this.tui.terminal.rows,
      this.sidebarVisible,
    );
    const { scrollLines, dockLines } = mainViewportParts(
      this.tui,
      this.originalRender,
      dimensions.mainWidth,
    );
    const metrics = viewportMetrics(
      scrollLines,
      dockLines,
      dimensions.height,
      this.scrollOffset,
    );
    this.scrollOffset = preserveScrollAnchor(
      this.scrollOffset,
      this.previousScrollLineCount,
      scrollLines.length,
      metrics.maxOffset,
    );
    this.previousScrollLineCount = scrollLines.length;
    const liveMainLines = fixedViewport(
      scrollLines,
      dockLines,
      dimensions.height,
      this.scrollOffset,
    ).map((line) => clipLine(line, dimensions.mainWidth));
    this.latestMainLines = liveMainLines;
    this.latestMainWidth = dimensions.mainWidth;

    this.reconcileTextSelection(liveMainLines);
    const selectionLines = this.textSelection?.lines ?? liveMainLines;
    const mainLines = this.textSelection
      ? highlightTerminalSelection(selectionLines, this.textSelection)
      : selectionLines;
    if (!dimensions.showSidebar) return mainLines;
    return combineColumns({
      mainLines,
      sidebarLines: this.sidebar.render(dimensions.sidebarWidth),
      mainWidth: dimensions.mainWidth,
      sidebarWidth: dimensions.sidebarWidth,
      height: dimensions.height,
    });
  }

  private handleScrollInput(input: string): { consume?: true; data?: string } | undefined {
    const mouseInput = parseTerminalMouseInput(input);
    if (isWorkbenchModalActive()) return mouseListenerResult(mouseInput);
    if (mouseInput.wheelNotches !== 0) return this.applyMouseScroll(mouseInput);
    if (mouseInput.mouseSequences > 0) {
      this.applyMouseSelection(mouseInput.events);
      return mouseListenerResult(mouseInput);
    }

    const selectionResult = this.applySelectionKey(input);
    if (selectionResult) return selectionResult;
    const pageResult = this.applyPageScroll(input);
    if (pageResult) return pageResult;
    if (this.scrollOffset > 0) this.scrollOffset = 0;
    return undefined;
  }

  private applyMouseScroll(mouseInput: ParsedTerminalMouseInput): { consume?: true; data?: string } | undefined {
    this.clearTextSelection();
    this.scrollOffset = this.clampScrollOffset(
      this.scrollOffset + mouseInput.wheelNotches * MOUSE_WHEEL_SCROLL_ROWS,
    );
    this.tui.requestRender();
    return mouseListenerResult(mouseInput);
  }

  private applySelectionKey(input: string): { consume: true } | undefined {
    if (!this.textSelection) return undefined;
    if (matchesKey(input, "ctrl+c")) {
      this.copyCurrentSelection();
      this.clearTextSelection();
      this.tui.requestRender();
      return { consume: true };
    }
    this.clearTextSelection();
    this.tui.requestRender();
    return undefined;
  }

  private applyMouseSelection(events: readonly TerminalMouseEvent[]): void {
    for (const event of events) {
      if (event.kind === "press" && event.button === 0) this.beginTextSelection(event);
      else if (event.kind === "drag" && event.button === 0) this.extendTextSelection(event);
      else if (event.kind === "release") this.releaseTextSelection(event);
    }
  }

  private beginTextSelection(event: TerminalMouseEvent): void {
    const point = this.selectionPoint(event, this.latestMainLines);
    if (!point) {
      this.clearTextSelection();
      return;
    }
    this.textSelection = {
      anchor: point,
      focus: point,
      lines: [...this.latestMainLines],
      dragging: true,
      moved: false,
      showReleasedFrame: false,
    };
    this.tui.requestRender();
  }

  private extendTextSelection(event: TerminalMouseEvent): void {
    if (!this.textSelection?.dragging) return;
    const point = this.selectionPoint(event, this.textSelection.lines);
    if (!point) return;
    this.textSelection.focus = point;
    this.textSelection.moved = true;
    this.tui.requestRender();
  }

  private releaseTextSelection(event: TerminalMouseEvent): void {
    if (!this.textSelection?.dragging) return;
    const point = this.selectionPoint(event, this.textSelection.lines);
    if (point) {
      this.textSelection.focus = point;
      this.textSelection.moved ||= !samePoint(point, this.textSelection.anchor);
    }
    if (!this.textSelection.moved) {
      this.clearTextSelection();
      this.tui.requestRender();
      return;
    }
    this.textSelection.dragging = false;
    this.textSelection.showReleasedFrame = true;
    this.copyCurrentSelection();
    this.tui.requestRender();
  }

  private selectionPoint(
    event: TerminalMouseEvent,
    lines: readonly string[],
  ): TextSelectionPoint | undefined {
    if (event.x < 1 || event.x > this.latestMainWidth || event.y < 1) return undefined;
    return clampSelectionPoint(lines, event.y - 1, event.x - 1);
  }

  private reconcileTextSelection(liveMainLines: string[]): void {
    const selection = this.textSelection;
    if (!selection || selection.dragging) return;
    if (selection.showReleasedFrame) {
      selection.showReleasedFrame = false;
      return;
    }
    if (!sameLines(liveMainLines, selection.lines)) this.textSelection = undefined;
  }

  private copyCurrentSelection(): void {
    if (!this.textSelection) return;
    const text = selectedTerminalText(this.textSelection.lines, this.textSelection);
    if (!text.trim()) return;
    void this.copyText(text).catch((error: unknown) => {
      this.onCopyError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private clearTextSelection(): void {
    this.textSelection = undefined;
  }

  private applyPageScroll(input: string): { consume: true } | undefined {
    const pageSize = Math.max(3, Math.floor(this.tui.terminal.rows * 0.7));
    if (matchesKey(input, "pageup")) {
      this.scrollOffset = this.clampScrollOffset(this.scrollOffset + pageSize);
      this.tui.requestRender();
      return { consume: true };
    }
    if (!matchesKey(input, "pagedown")) return undefined;
    this.scrollOffset = this.clampScrollOffset(this.scrollOffset - pageSize);
    this.tui.requestRender();
    return { consume: true };
  }

  private clampScrollOffset(scrollOffset: number): number {
    const dimensions = workbenchDimensions(
      this.tui.terminal.columns,
      this.tui.terminal.rows,
      this.sidebarVisible,
    );
    const { scrollLines, dockLines } = mainViewportParts(
      this.tui,
      this.originalRender,
      dimensions.mainWidth,
    );
    const metrics = viewportMetrics(scrollLines, dockLines, dimensions.height, scrollOffset);
    return clampScrollOffset(scrollOffset, metrics.maxOffset);
  }

  private enterAlternateScreen(): void {
    if (this.alternateScreenActive) return;
    this.tui.terminal.write(WORKBENCH_ENTER_SEQUENCE);
    this.alternateScreenActive = true;
  }

  private leaveAlternateScreen(): void {
    if (!this.alternateScreenActive) return;
    this.tui.terminal.write(WORKBENCH_LEAVE_SEQUENCE);
    this.alternateScreenActive = false;
  }
}

function mouseListenerResult(
  mouseInput: ParsedTerminalMouseInput,
): { consume?: true; data?: string } | undefined {
  if (mouseInput.mouseSequences === 0) return undefined;
  return mouseInput.data.length === 0 ? { consume: true } : { data: mouseInput.data };
}

function mainViewportParts(tui: TUI, fallbackRender: RenderFunction, width: number): MainViewportParts {
  const { scrollChildren, dockChildren } = splitWorkbenchChildren(tui.children);
  if (dockChildren.length === 0) {
    return { scrollLines: fallbackRender(width), dockLines: [] };
  }
  return {
    scrollLines: renderComponents(scrollChildren, width),
    dockLines: renderComponents(dockChildren, width),
  };
}

function renderComponents(components: readonly Component[], width: number): string[] {
  const lines: string[] = [];
  for (const component of components) lines.push(...component.render(width));
  return lines;
}

function combineColumns(request: ColumnRequest): string[] {
  const { mainLines, sidebarLines, mainWidth, sidebarWidth, height } = request;
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    lines.push(
      fitLine(mainLines[row] ?? "", mainWidth) +
      fitLine(sidebarLines[row] ?? "", sidebarWidth),
    );
  }
  return lines;
}

function clipLine(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "");
}

function fitLine(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "", true);
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function samePoint(left: TextSelectionPoint, right: TextSelectionPoint): boolean {
  return left.row === right.row && left.column === right.column && left.endColumn === right.endColumn;
}

import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import { isWorkbenchModalActive } from "./modalState.ts";
import {
  clampScrollOffset,
  fixedViewport,
  parseWorkbenchMouseInput,
  renderChatScrollbar,
  viewportMetrics,
  workbenchDimensions,
  workbenchMainContentWidth,
  WORKBENCH_ENTER_SEQUENCE,
  WORKBENCH_LEAVE_SEQUENCE,
  type ParsedWorkbenchMouseInput,
} from "./workbenchShellLayout.ts";

const WORKBENCH_SHELL_KEY = Symbol.for("amabdomo.pi.workbench-shell.v1");
const DOCK_CHILD_COUNT = 4;
const MOUSE_WHEEL_SCROLL_ROWS = 3;

export interface WorkbenchShellHandle {
  setSidebar(component: Component): void;
  setSidebarVisible(visible: boolean): void;
  dispose(): void;
}

type ShellTui = TUI & Record<symbol, WorkbenchShellHandle | undefined>;
type RenderFunction = (width: number) => string[];

interface MainViewportRequest {
  tui: TUI;
  fallbackRender: RenderFunction;
  width: number;
  height: number;
  scrollOffset: number;
}

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

export function installWorkbenchShell(
  tui: TUI,
  sidebar: Component,
): WorkbenchShellHandle {
  const shellTui = tui as ShellTui;
  const existing = shellTui[WORKBENCH_SHELL_KEY];
  if (existing) {
    existing.setSidebar(sidebar);
    return existing;
  }
  const installation = new WorkbenchShellInstallation(tui, sidebar);
  shellTui[WORKBENCH_SHELL_KEY] = installation;
  return installation;
}

class WorkbenchShellInstallation implements WorkbenchShellHandle {
  private readonly originalRender: RenderFunction;
  private readonly originalStart: () => void;
  private readonly originalStop: () => void;
  private readonly removeScrollListener: () => void;
  private readonly tui: TUI;
  private sidebar: Component;
  private sidebarVisible = true;
  private scrollOffset = 0;
  private alternateScreenActive = false;

  constructor(
    tui: TUI,
    sidebar: Component,
  ) {
    this.tui = tui;
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
    const mainLines = renderMainViewport({
      tui: this.tui,
      fallbackRender: this.originalRender,
      width: dimensions.mainWidth,
      height: dimensions.height,
      scrollOffset: this.scrollOffset,
    });
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
    if (isWorkbenchModalActive()) {
      return mouseListenerResult(parseWorkbenchMouseInput(input));
    }
    const mouseResult = this.applyMouseScroll(input);
    if (mouseResult) return mouseResult;
    const pageResult = this.applyPageScroll(input);
    if (pageResult) return pageResult;
    if (this.scrollOffset > 0) this.scrollOffset = 0;
    return undefined;
  }

  private applyMouseScroll(input: string): { consume?: true; data?: string } | undefined {
    const mouseInput = parseWorkbenchMouseInput(input);
    if (mouseInput.wheelNotches !== 0) {
      this.scrollOffset = this.clampScrollOffset(
        this.scrollOffset + mouseInput.wheelNotches * MOUSE_WHEEL_SCROLL_ROWS,
      );
      this.tui.requestRender();
    }
    return mouseListenerResult(mouseInput);
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
    const contentWidth = workbenchMainContentWidth(dimensions.mainWidth);
    const { scrollLines, dockLines } = mainViewportParts(this.tui, this.originalRender, contentWidth);
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
  mouseInput: ParsedWorkbenchMouseInput,
): { consume?: true; data?: string } | undefined {
  if (mouseInput.mouseSequences === 0) return undefined;
  return mouseInput.data.length === 0 ? { consume: true } : { data: mouseInput.data };
}

function renderMainViewport(request: MainViewportRequest): string[] {
  const { tui, fallbackRender, width, height, scrollOffset } = request;
  const contentWidth = workbenchMainContentWidth(width);
  const { scrollLines, dockLines } = mainViewportParts(tui, fallbackRender, contentWidth);
  const contentLines = fixedViewport(scrollLines, dockLines, height, scrollOffset)
    .map((line) => fitLine(line, contentWidth));
  if (contentWidth === width) return contentLines;

  const scrollbar = renderChatScrollbar(scrollLines, dockLines, height, scrollOffset);
  return contentLines.map((line, index) => line + (scrollbar[index] ?? " "));
}

function mainViewportParts(tui: TUI, fallbackRender: RenderFunction, width: number): MainViewportParts {
  if (tui.children.length < DOCK_CHILD_COUNT) {
    return { scrollLines: fallbackRender(width), dockLines: [] };
  }
  const dockStart = tui.children.length - DOCK_CHILD_COUNT;
  return {
    scrollLines: renderComponents(tui.children.slice(0, dockStart), width),
    dockLines: renderComponents(tui.children.slice(dockStart), width),
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

function fitLine(line: string, width: number): string {
  const fitted = truncateToWidth(line, Math.max(0, width), "", true);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

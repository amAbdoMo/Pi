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
} from "./terminalCompatibility.ts";

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
  private sidebar: Component;
  private sidebarVisible = true;
  private scrollOffset = 0;
  private previousScrollLineCount: number | undefined;
  private alternateScreenActive = false;

  constructor(
    private readonly tui: TUI,
    sidebar: Component,
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
    const mainLines = fixedViewport(
      scrollLines,
      dockLines,
      dimensions.height,
      this.scrollOffset,
    ).map((line) => fitLine(line, dimensions.mainWidth));
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

    const mouseResult = this.applyMouseScroll(mouseInput);
    if (mouseResult) return mouseResult;

    const pageResult = this.applyPageScroll(input);
    if (pageResult) return pageResult;

    if (this.scrollOffset > 0) this.scrollOffset = 0;
    return undefined;
  }

  private applyMouseScroll(mouseInput: ParsedTerminalMouseInput): { consume?: true; data?: string } | undefined {
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

function fitLine(line: string, width: number): string {
  const fitted = truncateToWidth(line, Math.max(0, width), "", true);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

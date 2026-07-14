import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import { isWorkbenchModalActive } from "./modalState.ts";
import {
  fixedViewport,
  mouseInputKind,
  workbenchDimensions,
  type MouseInputKind,
} from "./workbenchShellLayout.ts";

const WORKBENCH_SHELL_KEY = Symbol.for("amabdomo.pi.workbench-shell.v1");
const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
const ENABLE_MOUSE_TRACKING = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE_TRACKING = "\x1b[?1006l\x1b[?1000l";
const WHEEL_SCROLL_LINES = 3;
const DOCK_CHILD_COUNT = 4;

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

  private handleScrollInput(input: string): { consume: true } | undefined {
    const mouseInput = mouseInputKind(input);
    if (mouseInput) {
      if (!isWorkbenchModalActive()) this.scrollWithMouse(mouseInput);
      return { consume: true };
    }
    if (isWorkbenchModalActive()) return undefined;
    const pageSize = Math.max(3, Math.floor(this.tui.terminal.rows * 0.7));
    if (matchesKey(input, "pageup")) {
      this.scrollOffset += pageSize;
      this.tui.requestRender();
      return { consume: true };
    }
    if (matchesKey(input, "pagedown")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - pageSize);
      this.tui.requestRender();
      return { consume: true };
    }
    if (this.scrollOffset > 0) this.scrollOffset = 0;
    return undefined;
  }

  private scrollWithMouse(input: MouseInputKind): void {
    if (input === "wheel-up") this.scrollOffset += WHEEL_SCROLL_LINES;
    if (input === "wheel-down") {
      this.scrollOffset = Math.max(0, this.scrollOffset - WHEEL_SCROLL_LINES);
    }
    if (input !== "other") this.tui.requestRender();
  }

  private enterAlternateScreen(): void {
    if (this.alternateScreenActive) return;
    this.tui.terminal.write(ENTER_ALTERNATE_SCREEN + ENABLE_MOUSE_TRACKING);
    this.alternateScreenActive = true;
  }

  private leaveAlternateScreen(): void {
    if (!this.alternateScreenActive) return;
    this.tui.terminal.write(DISABLE_MOUSE_TRACKING + LEAVE_ALTERNATE_SCREEN);
    this.alternateScreenActive = false;
  }
}

function renderMainViewport(request: MainViewportRequest): string[] {
  const { tui, fallbackRender, width, height, scrollOffset } = request;
  if (tui.children.length < DOCK_CHILD_COUNT) {
    return fixedViewport(fallbackRender(width), [], height, scrollOffset)
      .map((line) => fitLine(line, width));
  }
  const dockStart = tui.children.length - DOCK_CHILD_COUNT;
  const scrollLines = renderComponents(tui.children.slice(0, dockStart), width);
  const dockLines = renderComponents(tui.children.slice(dockStart), width);
  return fixedViewport(scrollLines, dockLines, height, scrollOffset)
    .map((line) => fitLine(line, width));
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

import { createRequire } from "node:module";

import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  matchesKey,
  setCapabilities,
  truncateToWidth,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";

// Pi aliases public TUI imports to its host module, but that alias mangles private
// subpaths. Resolve these helpers from Pi's entry point to share its image registry.
const {
  cropKittyImageLine,
  getKittyImageMetadata,
} = createRequire(process.argv[1])(
  "@earendil-works/pi-tui/dist/terminal-image.js",
) as {
  cropKittyImageLine(line: string, hiddenRows: number, visibleRows: number): string;
  getKittyImageMetadata(line: string): { rows: number } | undefined;
};

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
  WORKBENCH_MOUSE_TRACKING_SEQUENCE,
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
  stripFrameDecorations,
  type TextSelectionPoint,
  type TextSelectionRange,
} from "./textSelection.ts";

const WORKBENCH_SHELL_KEY = Symbol.for("amabdomo.pi.workbench-shell.v1");
const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM_IMAGE_PREFIX = "\x1b]1337;File=";
const MOUSE_WHEEL_SCROLL_ROWS = 3;
const SELECTION_AUTO_SCROLL_INTERVAL_MS = 40;
const KITTY_IMAGE_VIEWPORT = {
  getMetadata: getKittyImageMetadata,
  cropLine: cropKittyImageLine,
};

export interface WorkbenchShellHandle {
  rebind(component: Component, options: WorkbenchShellOptions): void;
  setSidebarVisible(visible: boolean): void;
  dispose(): void;
}

type ShellTui = TUI & Record<symbol, WorkbenchShellHandle | undefined>;
type RenderFunction = (width: number) => string[];

interface MainViewportParts {
  scrollLines: string[];
  dockLines: string[];
  composerDockRows?: { start: number; end: number };
}

export interface ColumnRequest {
  mainLines: readonly string[];
  sidebarLines: readonly string[];
  mainWidth: number;
  sidebarWidth: number;
  height: number;
}

interface TranscriptViewport {
  logicalStart: number;
  visibleRows: number;
  screenRows: number;
}

interface WorkbenchTextSelection {
  anchor: TextSelectionPoint;
  focus: TextSelectionPoint;
  lines: string[];
  source: "transcript" | "viewport";
  viewportStart: number;
  dragging: boolean;
  moved: boolean;
  showReleasedFrame: boolean;
}

interface NativeFullscreenTui extends TUI {
  copySelectionToClipboard?: () => void;
  getSelectionBounds?: () => unknown;
  selectionAnchor?: unknown;
  selectionFocus?: unknown;
  /** Injected clipboard writer used internally by copySelectionToClipboard. */
  copySelection?: (text: string) => Promise<boolean>;
}

export interface ComposerCursorRequest {
  renderRow: number;
  screenColumn: number;
  width: number;
}

export interface WorkbenchShellOptions {
  copyText?: (text: string) => Promise<void>;
  onCopyError: (error: Error) => void;
  onCopySuccess?: () => void;
  placeComposerCursor: (request: ComposerCursorRequest) => boolean;
}

export function installWorkbenchShell(
  tui: TUI,
  sidebar: Component,
  options: WorkbenchShellOptions,
): WorkbenchShellHandle {
  ensureWarpKittyImages(tui);
  const shellTui = tui as ShellTui;
  const existing = shellTui[WORKBENCH_SHELL_KEY];
  if (existing) {
    existing.rebind(sidebar, options);
    return existing;
  }
  const installation = tui.mode === "fullscreen"
    ? new NativeFullscreenWorkbenchInstallation(
        tui,
        sidebar,
        options.onCopyError,
        options.onCopySuccess,
      )
    : new WorkbenchShellInstallation(
        tui,
        sidebar,
        options.copyText ?? copyToClipboard,
        options.onCopyError,
        options.placeComposerCursor,
        options.onCopySuccess,
      );
  shellTui[WORKBENCH_SHELL_KEY] = installation;
  return installation;
}

function ensureWarpKittyImages(tui: TUI): void {
  if (process.env.TERM_PROGRAM !== "WarpTerminal") return;
  const capabilities = getCapabilities();
  if (capabilities.images === "kitty") return;
  setCapabilities({ ...capabilities, images: "kitty" });
  tui.invalidate();
}

class NativeFullscreenWorkbenchInstallation implements WorkbenchShellHandle {
  private readonly tui: NativeFullscreenTui;
  private readonly nativeCopySelection?: () => void;
  private readonly nativeCopyWriter?: (text: string) => Promise<boolean>;
  private readonly nativeSelectionBounds?: () => unknown;
  private readonly suppressNativeCopy = () => {};
  private readonly removeInputListener: () => void;
  private readonly onCopySuccess?: () => void;
  private sidebar: Component;
  private sidebarVisible = false;
  private overlay?: OverlayHandle;

  constructor(
    tui: TUI,
    sidebar: Component,
    onCopyError: (error: Error) => void,
    onCopySuccess?: () => void,
  ) {
    this.tui = tui as NativeFullscreenTui;
    this.nativeCopySelection = typeof this.tui.copySelectionToClipboard === "function"
      ? this.tui.copySelectionToClipboard
      : undefined;
    this.nativeSelectionBounds = typeof this.tui.getSelectionBounds === "function"
      ? this.tui.getSelectionBounds
      : undefined;
    // Wrap the TUI's clipboard writer so fullscreen selection copies drop message frame
    // borders exactly like the docked-shell copy path.
    this.nativeCopyWriter = typeof this.tui.copySelection === "function"
      ? this.tui.copySelection
      : undefined;
    if (this.nativeCopyWriter) {
      this.tui.copySelection = async (text: string) =>
        this.nativeCopyWriter!.call(this.tui, stripFrameDecorations(text));
    }
    if (this.nativeCopySelection && this.nativeSelectionBounds) {
      this.tui.copySelectionToClipboard = this.suppressNativeCopy;
    } else {
      onCopyError(new Error("Fullscreen selection controls are unavailable in this Pi version."));
    }
    this.sidebar = sidebar;
    this.removeInputListener = tui.addInputListener((input) => this.applySelectionKey(input));
  }

  rebind(sidebar: Component, _options: WorkbenchShellOptions): void {
    const wasVisible = this.sidebarVisible;
    this.hideOverlay();
    this.sidebar = sidebar;
    if (wasVisible) this.showOverlay();
  }

  setSidebarVisible(visible: boolean): void {
    this.sidebarVisible = visible;
    if (visible) this.showOverlay();
    else this.hideOverlay();
  }

  dispose(): void {
    this.hideOverlay();
    this.removeInputListener();
    if (this.nativeCopySelection) this.tui.copySelectionToClipboard = this.nativeCopySelection;
    if (this.nativeCopyWriter) this.tui.copySelection = this.nativeCopyWriter;
    (this.tui as ShellTui)[WORKBENCH_SHELL_KEY] = undefined;
    this.tui.requestRender(true);
  }

  private applySelectionKey(input: string): { consume: true } | undefined {
    const copySelection = this.nativeCopySelection;
    if (!matchesKey(input, "ctrl+c") || !copySelection || !this.hasSelection()) return undefined;
    Reflect.apply(copySelection, this.tui, []);
    this.onCopySuccess?.();
    this.tui.selectionAnchor = undefined;
    this.tui.selectionFocus = undefined;
    this.tui.requestRender();
    return { consume: true };
  }

  private hasSelection(): boolean {
    return Boolean(
      this.nativeSelectionBounds && Reflect.apply(this.nativeSelectionBounds, this.tui, []),
    );
  }

  private showOverlay(): void {
    if (this.overlay) return;
    this.overlay = this.tui.showOverlay(this.sidebar, {
      anchor: "top-right",
      width: 40,
      maxHeight: "100%",
      margin: 0,
      nonCapturing: true,
    });
  }

  private hideOverlay(): void {
    this.overlay?.hide();
    this.overlay = undefined;
  }
}

class WorkbenchShellInstallation implements WorkbenchShellHandle {
  private readonly originalRender: RenderFunction;
  private readonly originalStart: () => void;
  private readonly originalStop: () => void;
  private readonly removeScrollListener: () => void;
  private sidebar: Component;
  private copyText: (text: string) => Promise<void>;
  private onCopyError: (error: Error) => void;
  private onCopySuccess?: () => void;
  private placeComposerCursor: (request: ComposerCursorRequest) => boolean;
  private sidebarVisible = true;
  private scrollOffset = 0;
  private latestMaxScrollOffset = 0;
  private previousScrollLineCount: number | undefined;
  private alternateScreenActive = false;
  private latestMainLines: string[] = [];
  private latestScrollLines: string[] = [];
  private latestMainWidth = 0;
  private transcriptViewport?: TranscriptViewport;
  private textSelection?: WorkbenchTextSelection;
  private selectionDragPointer?: { x: number; y: number };
  private selectionAutoScrollDirection = 0;
  private selectionAutoScrollTimer?: ReturnType<typeof setInterval>;
  private composerScreenRows?: { start: number; end: number; renderRowOffset: number };
  private composerClickCandidate?: { x: number; y: number };

  constructor(
    private readonly tui: TUI,
    sidebar: Component,
    copyText: (text: string) => Promise<void>,
    onCopyError: (error: Error) => void,
    placeComposerCursor: (request: ComposerCursorRequest) => boolean,
    onCopySuccess?: () => void,
  ) {
    this.sidebar = sidebar;
    this.copyText = copyText;
    this.onCopyError = onCopyError;
    this.onCopySuccess = onCopySuccess;
    this.placeComposerCursor = placeComposerCursor;
    this.originalRender = tui.render.bind(tui);
    this.originalStart = tui.start.bind(tui);
    this.originalStop = tui.stop.bind(tui);
    this.removeScrollListener = tui.addInputListener((input) => this.handleScrollInput(input));
    this.install();
  }

  rebind(component: Component, options: WorkbenchShellOptions): void {
    this.sidebar = component;
    this.copyText = options.copyText ?? copyToClipboard;
    this.onCopyError = options.onCopyError;
    this.onCopySuccess = options.onCopySuccess;
    this.placeComposerCursor = options.placeComposerCursor;
    this.clearTextSelection();
    this.composerClickCandidate = undefined;
    this.tui.terminal.write(WORKBENCH_MOUSE_TRACKING_SEQUENCE);
    this.tui.requestRender(true);
  }

  setSidebarVisible(visible: boolean): void {
    if (this.sidebarVisible === visible) return;
    this.clearTextSelection();
    this.sidebarVisible = visible;
    this.tui.requestRender(true);
  }

  dispose(): void {
    this.clearTextSelection();
    this.composerClickCandidate = undefined;
    this.removeScrollListener();
    this.tui.render = this.originalRender;
    this.tui.start = this.originalStart;
    this.tui.stop = this.originalStop;
    (this.tui as ShellTui)[WORKBENCH_SHELL_KEY] = undefined;
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
      this.clearTextSelection();
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
    if (this.latestMainWidth > 0 && this.latestMainWidth !== dimensions.mainWidth) {
      this.clearTextSelection();
    }
    const { scrollLines, dockLines, composerDockRows } = mainViewportParts(
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
    const visibleMetrics = viewportMetrics(
      scrollLines,
      dockLines,
      dimensions.height,
      this.scrollOffset,
    );
    this.latestMaxScrollOffset = visibleMetrics.maxOffset;
    this.composerScreenRows = visibleComposerRows(
      composerDockRows,
      dockLines.length,
      visibleMetrics.scrollHeight,
      visibleMetrics.dockHeight,
    );
    const transcriptSelection = this.textSelection?.source === "transcript"
      ? this.textSelection
      : undefined;
    const transcriptLineCount = transcriptSelection?.lines.length ?? scrollLines.length;
    const maxTranscriptStart = Math.max(
      0,
      transcriptLineCount - visibleMetrics.scrollHeight,
    );
    const logicalStart = transcriptSelection
      ? Math.max(0, Math.min(maxTranscriptStart, transcriptSelection.viewportStart))
      : visibleMetrics.start;
    if (transcriptSelection) transcriptSelection.viewportStart = logicalStart;
    this.transcriptViewport = {
      logicalStart,
      visibleRows: Math.min(
        visibleMetrics.scrollHeight,
        Math.max(0, transcriptLineCount - logicalStart),
      ),
      screenRows: visibleMetrics.scrollHeight,
    };
    this.previousScrollLineCount = scrollLines.length;
    const liveMainLines = fixedViewport(
      scrollLines,
      dockLines,
      dimensions.height,
      this.scrollOffset,
      KITTY_IMAGE_VIEWPORT,
    ).map((line) => clipLine(line, dimensions.mainWidth));
    this.latestMainLines = liveMainLines;
    this.latestScrollLines = scrollLines;
    this.latestMainWidth = dimensions.mainWidth;

    this.refreshAutoScrollFocus();
    this.reconcileTextSelection(liveMainLines, scrollLines);
    const mainLines = this.highlightSelection(liveMainLines);
    if (!dimensions.showSidebar) return mainLines;
    return combineWorkbenchColumns({
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
    this.composerClickCandidate = undefined;
    this.clearTextSelection();
    this.scrollOffset = this.clampScrollOffset(
      this.scrollOffset + mouseInput.wheelNotches * MOUSE_WHEEL_SCROLL_ROWS,
    );
    this.tui.requestRender();
    return mouseListenerResult(mouseInput);
  }

  private applySelectionKey(input: string): { consume: true } | undefined {
    this.composerClickCandidate = undefined;
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
      if (event.kind === "press" && event.button === 0) {
        this.stopSelectionAutoScroll();
        if (!this.beginComposerClick(event)) this.beginTextSelection(event);
      } else if (event.kind === "drag" && event.button === 0) {
        this.promoteMovedComposerClickToSelection(event);
        this.extendTextSelection(event);
        this.updateSelectionAutoScroll(event);
      } else if (event.kind === "release") {
        this.stopSelectionAutoScroll();
        if (!this.releaseComposerClick(event)) this.releaseTextSelection(event);
      }
    }
  }

  private beginComposerClick(event: TerminalMouseEvent): boolean {
    const screenRow = event.y - 1;
    const composerRows = this.composerScreenRows;
    if (!composerRows || screenRow < composerRows.start || screenRow >= composerRows.end) return false;
    this.clearTextSelection();
    this.composerClickCandidate = { x: event.x, y: event.y };
    return true;
  }

  private promoteMovedComposerClickToSelection(event: TerminalMouseEvent): void {
    const candidate = this.composerClickCandidate;
    if (!candidate || (candidate.x === event.x && candidate.y === event.y)) return;
    this.composerClickCandidate = undefined;
    this.beginTextSelection({
      ...event,
      kind: "press",
      x: candidate.x,
      y: candidate.y,
    });
  }

  private releaseComposerClick(event: TerminalMouseEvent): boolean {
    const candidate = this.composerClickCandidate;
    this.composerClickCandidate = undefined;
    if (!candidate || candidate.x !== event.x || candidate.y !== event.y) return false;
    const composerRows = this.composerScreenRows;
    if (!composerRows) return false;
    return this.placeComposerCursor({
      renderRow: composerRows.renderRowOffset + event.y - 1 - composerRows.start,
      screenColumn: event.x - 1,
      width: this.latestMainWidth,
    });
  }

  private beginTextSelection(event: TerminalMouseEvent): void {
    const transcriptPoint = this.transcriptSelectionPoint(
      event,
      this.latestScrollLines,
      false,
    );
    const source = transcriptPoint ? "transcript" : "viewport";
    const lines = source === "transcript"
      ? this.latestScrollLines
      : this.latestMainLines;
    const point = transcriptPoint ?? this.viewportSelectionPoint(event, lines);
    if (!point) {
      this.clearTextSelection();
      return;
    }
    this.textSelection = {
      anchor: point,
      focus: point,
      lines,
      source,
      viewportStart: source === "transcript"
        ? (this.transcriptViewport?.logicalStart ?? 0)
        : 0,
      dragging: true,
      moved: false,
      showReleasedFrame: false,
    };
    this.tui.requestRender();
  }

  private extendTextSelection(event: TerminalMouseEvent): void {
    const selection = this.textSelection;
    if (!selection?.dragging) return;
    const point = selection.source === "transcript"
      ? this.transcriptSelectionPoint(event, selection.lines, true)
      : this.viewportSelectionPoint(event, selection.lines);
    if (!point) return;
    selection.focus = point;
    selection.moved = true;
    this.tui.requestRender();
  }

  private releaseTextSelection(event: TerminalMouseEvent): void {
    const selection = this.textSelection;
    if (!selection?.dragging) return;
    const point = selection.source === "transcript"
      ? this.transcriptSelectionPoint(event, selection.lines, true)
      : this.viewportSelectionPoint(event, selection.lines);
    if (point) {
      selection.focus = point;
      selection.moved ||= !samePoint(point, selection.anchor);
    }
    if (!selection.moved) {
      this.clearTextSelection();
      this.tui.requestRender();
      return;
    }
    selection.dragging = false;
    selection.showReleasedFrame = true;
    this.tui.requestRender();
  }

  private transcriptSelectionPoint(
    event: Pick<TerminalMouseEvent, "x" | "y">,
    lines: readonly string[],
    clampToViewport: boolean,
  ): TextSelectionPoint | undefined {
    const viewport = this.transcriptViewport;
    if (!viewport || viewport.visibleRows === 0) return undefined;
    if (event.x < 1 || event.x > this.latestMainWidth || event.y < 1) return undefined;
    const screenRow = event.y - 1;
    if (!clampToViewport && screenRow >= viewport.visibleRows) return undefined;
    const visibleRow = Math.max(0, Math.min(viewport.visibleRows - 1, screenRow));
    return clampSelectionPoint(
      lines,
      viewport.logicalStart + visibleRow,
      event.x - 1,
    );
  }

  private viewportSelectionPoint(
    event: Pick<TerminalMouseEvent, "x" | "y">,
    lines: readonly string[],
  ): TextSelectionPoint | undefined {
    if (event.x < 1 || event.x > this.latestMainWidth || event.y < 1) return undefined;
    return clampSelectionPoint(lines, event.y - 1, event.x - 1);
  }

  private reconcileTextSelection(
    liveMainLines: string[],
    liveScrollLines: string[],
  ): void {
    const selection = this.textSelection;
    if (!selection || selection.dragging) return;
    if (selection.showReleasedFrame) {
      selection.showReleasedFrame = false;
      return;
    }
    const liveLines = selection.source === "transcript"
      ? liveScrollLines
      : liveMainLines;
    if (!sameLines(liveLines, selection.lines)) this.clearTextSelection();
  }

  private copyCurrentSelection(): void {
    if (!this.textSelection) return;
    const text = selectedTerminalText(this.textSelection.lines, this.textSelection);
    if (!text.trim()) return;
    void this.copyText(text)
      .then(() => this.onCopySuccess?.())
      .catch((error: unknown) => {
        this.onCopyError(error instanceof Error ? error : new Error(String(error)));
      });
  }

  private clearTextSelection(): void {
    this.stopSelectionAutoScroll();
    this.textSelection = undefined;
  }

  private highlightSelection(liveMainLines: string[]): string[] {
    const selection = this.textSelection;
    if (!selection) return liveMainLines;
    if (selection.source === "viewport") {
      return highlightTerminalSelection(selection.lines, selection);
    }
    const viewport = this.transcriptViewport;
    if (!viewport) return liveMainLines;
    const selectionScrollOffset = Math.max(
      0,
      selection.lines.length - viewport.screenRows - viewport.logicalStart,
    );
    const transcriptLines = fixedViewport(
      selection.lines,
      [],
      viewport.screenRows,
      selectionScrollOffset,
      KITTY_IMAGE_VIEWPORT,
    ).map((line) => clipLine(line, this.latestMainWidth));
    const screenRange = offsetSelectionRows(selection, -viewport.logicalStart);
    return [
      ...highlightTerminalSelection(transcriptLines, screenRange),
      ...liveMainLines.slice(viewport.screenRows),
    ];
  }

  private refreshAutoScrollFocus(): void {
    const selection = this.textSelection;
    const pointer = this.selectionDragPointer;
    if (!selection?.dragging || selection.source !== "transcript" || !pointer) return;
    const point = this.transcriptSelectionPoint(pointer, selection.lines, true);
    if (!point) return;
    selection.focus = point;
    selection.moved ||= !samePoint(point, selection.anchor);
  }

  private updateSelectionAutoScroll(event: TerminalMouseEvent): void {
    const selection = this.textSelection;
    const viewport = this.transcriptViewport;
    if (!selection?.dragging || selection.source !== "transcript" || !viewport) {
      this.stopSelectionAutoScroll();
      return;
    }
    if (event.x < 1 || event.x > this.latestMainWidth || viewport.screenRows === 0) {
      this.stopSelectionAutoScroll();
      return;
    }
    const screenRow = event.y - 1;
    this.selectionDragPointer = { x: event.x, y: event.y };
    this.selectionAutoScrollDirection = screenRow <= 0
      ? 1
      : screenRow >= viewport.screenRows - 1
        ? -1
        : 0;
    if (this.selectionAutoScrollDirection === 0) {
      this.stopSelectionAutoScroll();
      return;
    }
    if (this.selectionAutoScrollTimer) return;
    this.selectionAutoScrollTimer = setInterval(
      () => this.autoScrollSelection(),
      SELECTION_AUTO_SCROLL_INTERVAL_MS,
    );
    this.selectionAutoScrollTimer.unref?.();
  }

  private autoScrollSelection(): void {
    const direction = this.selectionAutoScrollDirection;
    const selection = this.textSelection;
    if (!selection?.dragging || selection.source !== "transcript" || direction === 0) {
      this.stopSelectionAutoScroll();
      return;
    }
    const viewport = this.transcriptViewport;
    if (!viewport) {
      this.stopSelectionAutoScroll();
      return;
    }
    const nextOffset = clampScrollOffset(
      this.scrollOffset + direction,
      this.latestMaxScrollOffset,
    );
    const maxViewportStart = Math.max(0, selection.lines.length - viewport.screenRows);
    const nextViewportStart = Math.max(
      0,
      Math.min(maxViewportStart, selection.viewportStart - direction),
    );
    if (
      nextOffset === this.scrollOffset ||
      nextViewportStart === selection.viewportStart
    ) {
      this.stopSelectionAutoScroll();
      return;
    }
    this.scrollOffset = nextOffset;
    selection.viewportStart = nextViewportStart;
    this.tui.requestRender();
  }

  private stopSelectionAutoScroll(): void {
    if (this.selectionAutoScrollTimer) {
      clearInterval(this.selectionAutoScrollTimer);
      this.selectionAutoScrollTimer = undefined;
    }
    this.selectionAutoScrollDirection = 0;
    this.selectionDragPointer = undefined;
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

  const renderedDockChildren = dockChildren.map((component) => component.render(width));
  const composerStart = renderedDockChildren[0]?.length ?? 0;
  const composerLength = renderedDockChildren[1]?.length ?? 0;
  return {
    scrollLines: renderComponents(scrollChildren, width),
    dockLines: renderedDockChildren.flat(),
    composerDockRows: composerLength > 0
      ? { start: composerStart, end: composerStart + composerLength }
      : undefined,
  };
}

function renderComponents(components: readonly Component[], width: number): string[] {
  const lines: string[] = [];
  for (const component of components) lines.push(...component.render(width));
  return lines;
}

function visibleComposerRows(
  composerDockRows: { start: number; end: number } | undefined,
  dockLineCount: number,
  scrollHeight: number,
  dockHeight: number,
): { start: number; end: number; renderRowOffset: number } | undefined {
  if (!composerDockRows) return undefined;
  const clippedDockRows = Math.max(0, dockLineCount - dockHeight);
  const visibleStart = Math.max(composerDockRows.start, clippedDockRows);
  const visibleEnd = Math.min(composerDockRows.end, dockLineCount);
  if (visibleStart >= visibleEnd) return undefined;
  return {
    start: scrollHeight + visibleStart - clippedDockRows,
    end: scrollHeight + visibleEnd - clippedDockRows,
    renderRowOffset: visibleStart - composerDockRows.start,
  };
}

export function combineWorkbenchColumns(request: ColumnRequest): string[] {
  const { mainLines, sidebarLines, mainWidth, sidebarWidth, height } = request;
  const lines: string[] = [];
  let protectedImageRows = 0;
  for (let row = 0; row < height; row++) {
    const mainLine = mainLines[row] ?? "";
    protectedImageRows = Math.max(protectedImageRows, inlineImageRows(mainLine));
    const fittedMain = protectedImageRows > 0
      ? preserveImageColumn(mainLine, mainWidth)
      : fitLine(mainLine, mainWidth);
    lines.push(fittedMain + fitLine(sidebarLines[row] ?? "", sidebarWidth));
    protectedImageRows = Math.max(0, protectedImageRows - 1);
  }
  return lines;
}

function inlineImageRows(line: string): number {
  const kittyStart = line.indexOf(KITTY_IMAGE_PREFIX);
  if (kittyStart >= 0) {
    const controlsEnd = line.indexOf(";", kittyStart + KITTY_IMAGE_PREFIX.length);
    const controls = controlsEnd >= 0
      ? line.slice(kittyStart + KITTY_IMAGE_PREFIX.length, controlsEnd)
      : "";
    const rows = /(?:^|,)r=(\d+)(?:,|$)/.exec(controls)?.[1];
    return Math.max(1, Number.parseInt(rows ?? "1", 10) || 1);
  }
  return line.includes(ITERM_IMAGE_PREFIX) ? 1 : 0;
}

function preserveImageColumn(line: string, width: number): string {
  const cursorColumns = Math.max(0, Math.floor(width));
  return cursorColumns > 0 ? `${line}\x1b[${cursorColumns}C` : line;
}

function clipLine(line: string, width: number): string {
  if (inlineImageRows(line) > 0) return line;
  return truncateToWidth(line, Math.max(0, width), "");
}

function fitLine(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "", true);
}

function offsetSelectionRows(
  range: TextSelectionRange,
  rowOffset: number,
): TextSelectionRange {
  return {
    anchor: { ...range.anchor, row: range.anchor.row + rowOffset },
    focus: { ...range.focus, row: range.focus.row + rowOffset },
  };
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function samePoint(left: TextSelectionPoint, right: TextSelectionPoint): boolean {
  return left.row === right.row && left.column === right.column && left.endColumn === right.endColumn;
}

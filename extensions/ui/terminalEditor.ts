import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  matchesKey,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  background,
  bold,
  clipToWidth,
  color,
  textWidth,
} from "./formatting.ts";
import {
  buildComposerBodyLine,
  buildComposerFooter,
  buildComposerHeader,
} from "./header.ts";
import {
  readBestImage,
  readClipboardText,
  savePastedText,
} from "./imagePaste.ts";
import { highlightPasteMarkers } from "./pasteMarkers.ts";
import {
  isEmptyBracketedPaste,
  legacyArabicAltSShortcut,
} from "./terminalCompatibility.ts";
import {
  logicalIndexAtRtlVisualColumn,
  rtlVisualWidth,
  usesVisualRtlReordering,
  visualRtlText,
} from "./rtlText.ts";
import type { KeybindingsManager } from "./types.ts";
import { composerFrame, directionStatus } from "./workbenchLayout.ts";

function isWarpTerminal(): boolean {
  return (
    process.env.TERM_PROGRAM === "WarpTerminal" ||
    process.env.WARP_IS_LOCAL_SHELL_SESSION === "1"
  );
}

function stripAnsi(input: string): string {
  return input
    .replaceAll(CURSOR_MARKER, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P_\^][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

function looksLikeEditorBorder(line: string): boolean {
  const clean = stripAnsi(line).trim();
  return clean.includes("─") && /^[─ ↑↓0-9more]+$/.test(clean);
}

interface EditorVisualLine {
  logicalLine: number;
  startCol: number;
  length: number;
}

interface EditorRuntimeAdapter {
  state: { lines: string[]; cursorLine: number };
  lastWidth: number;
  scrollOffset: number;
  buildVisualLineMap(width: number): EditorVisualLine[];
  setCursorCol(column: number): void;
  cancelAutocomplete?(): void;
  exitHistoryBrowsing?(): void;
  lastAction?: unknown;
}

interface ComposerEditorLayout {
  outerPadding: number;
  frame: ReturnType<typeof composerFrame>;
  direction: string;
  isRtl: boolean;
  prompt: string;
  promptWidth: number;
  editorWidth: number;
  inputStartRow: number;
}

export class TerminalEditor extends CustomEditor {
  private busyPastingClipboard = false;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) {
    // paddingX 0 avoids the stock editor's side-padding/wrap weirdness.
    super(tui, theme, keybindings, { paddingX: 0 });
  }

  requestRender(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  override handleInput(inputSequence: string): void {
    const arabicAltS = isWarpTerminal()
      ? legacyArabicAltSShortcut(inputSequence)
      : undefined;
    if (arabicAltS && this.onExtensionShortcut?.(arabicAltS)) return;

    const isCustomPaste =
      matchesKey(inputSequence, "ctrl+v") || matchesKey(inputSequence, "alt+v");
    const isWarpImagePaste = isWarpTerminal() && isEmptyBracketedPaste(inputSequence);
    if (process.platform === "win32" && (isCustomPaste || isWarpImagePaste)) {
      this.pasteCompactImage();
      return;
    }

    super.handleInput(inputSequence);
  }

  private pasteClipboardText(): boolean {
    const text = readClipboardText();
    if (!text) return false;
    const pastedText = savePastedText(text, this.getText());
    this.insertTextAtCursor(pastedText.marker);
    this.requestRender();
    return true;
  }

  private pasteCompactImage(): void {
    if (this.busyPastingClipboard) return;
    this.busyPastingClipboard = true;
    try {
      const image = readBestImage(this.getText());
      if (image) {
        this.insertTextAtCursor(image.marker);
        this.requestRender();
        return;
      }

      this.pasteClipboardText();
    } finally {
      this.busyPastingClipboard = false;
    }
  }

  placeCursorFromRenderedCell(renderRow: number, screenColumn: number, width: number): boolean {
    const layout = composerEditorLayout(width, this.getText());
    const inputRow = Math.floor(renderRow) - layout.inputStartRow;
    if (inputRow < 0) return false;

    const runtime = this as unknown as EditorRuntimeAdapter;
    if (!supportsMouseCursorPlacement(runtime)) return false;
    const target = editorCursorTarget(runtime, layout, inputRow, screenColumn);
    if (!target) return false;

    runtime.cancelAutocomplete?.();
    runtime.exitHistoryBrowsing?.();
    runtime.lastAction = null;
    runtime.state.cursorLine = target.line;
    runtime.setCursorCol(target.column);
    this.requestRender();
    return true;
  }

  override render(width: number): string[] {
    const text = this.getText();
    const layout = composerEditorLayout(width, text);
    const { outerPadding, frame, direction, isRtl, prompt, promptWidth, editorWidth } = layout;

    const stockLines = super
      .render(editorWidth)
      .filter((line) => !looksLikeEditorBorder(line));
    const inputLines = stockLines.length > 0 ? stockLines : [""];
    const lines = buildComposerHeader(frame.width, direction);

    for (let index = 0; index < inputLines.length; index++) {
      const visualLine = isRtl
        ? visualRtlText(inputLines[index]!, CURSOR_MARKER)
        : inputLines[index]!;
      const inputLine = highlightPasteMarkers(visualLine, (marker) =>
        color("mdCode", bold(marker)),
      );
      const content = isRtl
        ? rtlComposerLine(inputLine, index === 0 ? prompt : "", frame.innerWidth)
        : `${index === 0 ? prompt : " ".repeat(promptWidth)}${inputLine}`;
      lines.push(buildComposerBodyLine(content, frame.width));
    }

    lines.push(buildComposerFooter(frame.width));
    const horizontalGutter = " ".repeat(outerPadding);
    const composerLines = lines.map((line) =>
      `${horizontalGutter}${background("userMessageBg", line)}${horizontalGutter}`
    );
    if (outerPadding === 0) return composerLines;
    const verticalGutter = " ".repeat(width);
    return [verticalGutter, ...composerLines, verticalGutter];
  }
}

function composerEditorLayout(width: number, text: string): ComposerEditorLayout {
  const outerPadding = width >= 3 ? 1 : 0;
  const frame = composerFrame(Math.max(1, width - outerPadding * 2));
  const direction = directionStatus(text);
  const isRtl = direction.startsWith("RTL");
  const promptSymbol = text.startsWith("!") ? "# " : isRtl ? " ‹" : "› ";
  const prompt = frame.innerWidth >= 3 ? color("accent", promptSymbol) : "";
  const promptWidth = textWidth(prompt);
  return {
    outerPadding,
    frame,
    direction,
    isRtl,
    prompt,
    promptWidth,
    editorWidth: Math.max(1, frame.innerWidth - promptWidth),
    inputStartRow: (outerPadding > 0 ? 1 : 0) + 3,
  };
}

function supportsMouseCursorPlacement(runtime: EditorRuntimeAdapter): boolean {
  return !!runtime.state &&
    Array.isArray(runtime.state.lines) &&
    Number.isFinite(runtime.lastWidth) &&
    Number.isFinite(runtime.scrollOffset) &&
    typeof runtime.buildVisualLineMap === "function" &&
    typeof runtime.setCursorCol === "function";
}

function editorCursorTarget(
  runtime: EditorRuntimeAdapter,
  layout: ComposerEditorLayout,
  inputRow: number,
  screenColumn: number,
): { line: number; column: number } | undefined {
  const visualLine = runtime.buildVisualLineMap(runtime.lastWidth)[runtime.scrollOffset + inputRow];
  if (!visualLine) return undefined;
  const logicalText = runtime.state.lines[visualLine.logicalLine] ?? "";
  const segment = logicalText.slice(visualLine.startCol, visualLine.startCol + visualLine.length);
  const segmentHit = composerSegmentHit(layout, screenColumn, segment, inputRow);
  return {
    line: visualLine.logicalLine,
    column: visualLine.startCol + logicalSegmentIndex(segment, segmentHit),
  };
}

function logicalSegmentIndex(
  segment: string,
  hit: { column: number; visuallyReordered: boolean },
): number {
  if (!hit.visuallyReordered) return logicalIndexAtVisualColumn(segment, Math.max(0, hit.column));
  return hit.column < 0
    ? segment.length
    : logicalIndexAtRtlVisualColumn(segment, hit.column, visibleWidth);
}

function composerSegmentHit(
  layout: ComposerEditorLayout,
  screenColumn: number,
  segment: string,
  inputRow: number,
): { column: number; visuallyReordered: boolean } {
  const contentStart = layout.outerPadding + (layout.frame.framed ? 2 : 0);
  const visuallyReordered = layout.isRtl && usesVisualRtlReordering(segment);
  if (!layout.isRtl) {
    const column = Math.max(0, Math.floor(screenColumn) - contentStart - layout.promptWidth);
    return { column, visuallyReordered };
  }
  return {
    column: rtlSegmentColumn(layout, screenColumn, segment, inputRow),
    visuallyReordered,
  };
}

function rtlSegmentColumn(
  layout: ComposerEditorLayout,
  screenColumn: number,
  segment: string,
  inputRow: number,
): number {
  const contentStart = layout.outerPadding + (layout.frame.framed ? 2 : 0);
  const visuallyReordered = usesVisualRtlReordering(segment);
  const segmentWidth = visuallyReordered
    ? rtlVisualWidth(segment, visibleWidth)
    : visibleWidth(segment);
  const continuationInset = inputRow > 0 ? layout.promptWidth : 0;
  const visualStart = contentStart + continuationInset + Math.max(0, layout.editorWidth - segmentWidth);
  if (screenColumn < visualStart) return visuallyReordered ? -1 : 0;
  return Math.max(0, Math.floor(screenColumn) - visualStart);
}

function logicalIndexAtVisualColumn(text: string, visualColumn: number): number {
  const targetColumn = Math.max(0, Math.floor(visualColumn));
  let currentColumn = 0;
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (targetColumn < currentColumn + visibleWidth(segment)) return index;
    currentColumn += visibleWidth(segment);
  }
  return text.length;
}

function rtlComposerLine(text: string, prompt: string, width: number): string {
  const promptWidth = textWidth(prompt);
  const contentWidth = Math.max(0, width - promptWidth);
  const content = clipToWidth(text, contentWidth);
  const leftPadding = " ".repeat(Math.max(0, contentWidth - textWidth(content)));
  return `${leftPadding}${content}${prompt}`;
}

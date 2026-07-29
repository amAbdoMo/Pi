import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

export interface TextSelectionPoint {
  row: number;
  column: number;
  endColumn: number;
}

export interface TextSelectionRange {
  anchor: TextSelectionPoint;
  focus: TextSelectionPoint;
}

const CSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OSC_SEQUENCE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
const STRING_SEQUENCE = /\x1b[P_\^][\s\S]*?(?:\x07|\x1b\\)/g;
const SHORT_ESCAPE = /\x1b[@-Z\\-_]/g;
const STYLE_RESET = /\x1b\[(?:0|27)m/g;
const SELECT_ON = "\x1b[7m";
const SELECT_OFF = "\x1b[27m";

export function clampSelectionPoint(
  lines: readonly string[],
  row: number,
  column: number,
): TextSelectionPoint | undefined {
  if (lines.length === 0) return undefined;
  const safeRow = Math.max(0, Math.min(Math.floor(row), lines.length - 1));
  const lineWidth = selectableLineWidth(lines[safeRow] ?? "");
  if (lineWidth === 0) return undefined;
  const targetColumn = Math.max(0, Math.min(Math.floor(column), lineWidth - 1));
  return {
    row: safeRow,
    column: visibleWidth(sliceByColumn(lines[safeRow] ?? "", 0, targetColumn, true)),
    endColumn: visibleWidth(sliceByColumn(lines[safeRow] ?? "", 0, targetColumn + 1)),
  };
}

export function selectedTerminalText(
  lines: readonly string[],
  range: TextSelectionRange,
): string {
  const { start, end } = orderedRange(range);
  const selected: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const line = lines[row] ?? "";
    const lineWidth = selectableLineWidth(line);
    const startColumn = row === start.row ? start.column : 0;
    const endColumn = row === end.row ? end.endColumn : lineWidth;
    const segment = sliceByColumn(line, startColumn, Math.max(0, endColumn - startColumn), true);
    selected.push(stripTerminalSequences(segment).replace(/[ \t]+$/u, ""));
  }
  return selected.join("\n");
}

export function highlightTerminalSelection(
  lines: readonly string[],
  range: TextSelectionRange,
): string[] {
  const { start, end } = orderedRange(range);
  return lines.map((line, row) => {
    if (row < start.row || row > end.row) return line;
    const selectableWidth = selectableLineWidth(line);
    const fullLineWidth = visibleWidth(line);
    const startColumn = row === start.row ? start.column : 0;
    const endColumn = row === end.row ? end.endColumn : selectableWidth;
    if (endColumn <= startColumn) return line;

    const before = sliceByColumn(line, 0, startColumn, true);
    const selected = sliceByColumn(line, startColumn, endColumn - startColumn, true);
    const after = sliceByColumn(line, endColumn, Math.max(0, fullLineWidth - endColumn), true);
    if (visibleWidth(selected) === 0) return line;

    const painted = selected.replace(STYLE_RESET, (reset) => `${reset}${SELECT_ON}`);
    return `${before}${SELECT_ON}${painted}${SELECT_OFF}${after}`;
  });
}

function orderedRange(range: TextSelectionRange): {
  start: TextSelectionPoint;
  end: TextSelectionPoint;
} {
  if (
    range.anchor.row < range.focus.row ||
    (range.anchor.row === range.focus.row && range.anchor.column <= range.focus.column)
  ) {
    return { start: range.anchor, end: range.focus };
  }
  return { start: range.focus, end: range.anchor };
}

function selectableLineWidth(line: string): number {
  return visibleWidth(stripTerminalSequences(line).replace(/[ \t]+$/u, ""));
}

function stripTerminalSequences(text: string): string {
  return text
    .replace(CSI_SEQUENCE, "")
    .replace(OSC_SEQUENCE, "")
    .replace(STRING_SEQUENCE, "")
    .replace(SHORT_ESCAPE, "");
}

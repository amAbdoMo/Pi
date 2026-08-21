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
  return stripFrameDecorations(selected.join("\n"));
}

// Box-drawing glyphs used by Workbench message frames and panels.
const FRAME_GLYPHS = new Set([
  ..."\u2500\u2501\u2502\u2503\u2550\u2551\u2504\u2505\u2508\u2509\u250a\u250b",
  ..."\u250c\u250d\u250e\u250f\u2510\u2511\u2512\u2513\u2514\u2515\u2516\u2517",
  ..."\u2518\u2519\u251a\u251b\u251c\u251d\u251e\u251f\u2520\u2521\u2522\u2523",
  ..."\u2524\u2525\u2526\u2527\u2528\u2529\u252a\u252b\u252c\u252d\u252e\u252f",
  ..."\u2530\u2531\u2532\u2533\u2534\u2535\u2536\u2537\u2538\u2539\u253a\u253b",
  ..."\u253c\u253d\u253e\u253f\u2540\u2541\u2542\u2543\u2544\u2545\u2546\u2547",
  ..."\u2548\u2549\u254a\u254b\u2554\u2557\u255a\u255d\u2560\u2563\u2566\u2569",
  ..."\u256c\u256d\u256e\u256f\u2570",
]);
// Corners and tees that mark a full frame border row (top/bottom edges).
const FRAME_EDGE_START = /^[\u250c\u250f\u2514\u251c\u2523\u2554\u255e\u255f\u2560\u256d\u2570]/u;
const FRAME_EDGE_END = /[\u2510\u2513\u2518\u2524\u252b\u2557\u2561\u2562\u2563\u2566\u2569\u256c\u256e\u256f\u2570]$/u;

/** Drop frame borders and column rules from copied text so only content remains. */
export function stripFrameDecorations(text: string): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && [...trimmed].every((glyph) => FRAME_GLYPHS.has(glyph))) continue;
    if (
      trimmed.length >= 2 &&
      FRAME_EDGE_START.test(trimmed) &&
      FRAME_EDGE_END.test(trimmed)
    ) {
      continue;
    }
    kept.push(
      line
        .replace(/^\s*[\u2502\u2503\u2551]\s?/u, "")
        .replace(/\s?[\u2502\u2503\u2551]\s*$/u, "")
        .replace(/[^\S \t]+$/u, ""),
    );
  }
  while (kept.length > 0 && kept[0].trim().length === 0) kept.shift();
  while (kept.length > 0 && (kept.at(-1) ?? "").trim().length === 0) kept.pop();
  return kept.join("\n");
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

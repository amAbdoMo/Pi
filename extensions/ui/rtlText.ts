import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();
const CURSOR_SENTINEL = "\u2060";
const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
const ANSI_SEQUENCE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[P_^][\s\S]*?\x1b\\|[@-Z\\-_])/g;

export function logicalIndexAtRtlVisualColumn(
  text: string,
  visualColumn: number,
  cellWidth: (text: string) => number,
): number {
  if (!text) return 0;
  const shapedText = ArabicReshaper.convertArabic(text);
  const embeddingLevels = bidi.getEmbeddingLevels(shapedText, "rtl");
  const visualText = bidi.getReorderedString(shapedText, embeddingLevels);
  const reorderedIndices = bidi.getReorderedIndices(shapedText, embeddingLevels) as number[];
  const shapedToLogical = shapedIndexToLogicalIndex(shapedText);
  const targetColumn = Math.max(0, Math.floor(visualColumn));
  let currentColumn = 0;
  let visualOffset = 0;

  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(visualText)) {
    const segmentWidth = cellWidth(segment);
    if (targetColumn < currentColumn + segmentWidth) {
      const shapedIndices = reorderedIndices.slice(visualOffset, visualOffset + segment.length);
      const logicalIndices = shapedIndices.map((index) => shapedToLogical[index] ?? 0);
      return logicalIndices.length > 0 ? Math.min(...logicalIndices) : 0;
    }
    currentColumn += segmentWidth;
    visualOffset += segment.length;
  }
  return 0;
}

export function rtlVisualWidth(text: string, cellWidth: (text: string) => number): number {
  return cellWidth(ArabicReshaper.convertArabic(text));
}

export function usesVisualRtlReordering(text: string): boolean {
  return ARABIC_SCRIPT_RE.test(text);
}

function shapedIndexToLogicalIndex(shapedText: string): number[] {
  const shapedToLogical: number[] = [];
  let logicalOffset = 0;
  let shapedOffset = 0;
  for (const character of shapedText) {
    for (let index = 0; index < character.length; index++) {
      shapedToLogical[shapedOffset + index] = logicalOffset;
    }
    shapedOffset += character.length;
    logicalOffset += ArabicReshaper.convertArabicBack(character).length;
  }
  return shapedToLogical;
}

export function visualRtlText(text: string, cursorMarker?: string): string {
  const normalized = cursorMarker
    ? normalizeCursorCell(text, cursorMarker).replaceAll(cursorMarker, CURSOR_SENTINEL)
    : text;
  const plainText = normalized.replace(ANSI_SEQUENCE_RE, "");
  if (!ARABIC_SCRIPT_RE.test(plainText)) return text;

  const shapedText = ArabicReshaper.convertArabic(plainText);
  const embeddingLevels = bidi.getEmbeddingLevels(shapedText, "rtl");
  const visualText = bidi.getReorderedString(shapedText, embeddingLevels);
  if (!cursorMarker || !visualText.includes(CURSOR_SENTINEL)) return visualText;
  return visualText.replace(
    CURSOR_SENTINEL,
    `${cursorMarker}\x1b[7m \x1b[0m`,
  );
}

function normalizeCursorCell(text: string, cursorMarker: string): string {
  const marker = escapeRegExp(cursorMarker);
  const cursorCell = new RegExp(`${marker}\\x1b\\[7m([\\s\\S]*?)\\x1b\\[0m`, "g");
  return text.replace(cursorCell, (_match, cell: string) =>
    cursorMarker + (cell === " " ? "" : cell),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

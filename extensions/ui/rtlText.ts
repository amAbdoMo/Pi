import ArabicReshaper from "arabic-reshaper";
import bidiFactory from "bidi-js";

const bidi = bidiFactory();
const CURSOR_SENTINEL = "\u2060";
const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
const ANSI_SEQUENCE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[P_^][\s\S]*?\x1b\\|[@-Z\\-_])/g;

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

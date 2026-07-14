import { withoutPasteMarkers } from "./pasteMarkers.ts";

export type TextDirection = "ltr" | "rtl";

export type ComposerFrame = {
  width: number;
  innerWidth: number;
  framed: boolean;
};

const CODE_OR_PATH_RE =
  /`[^`\n]*`|(?:https?:\/\/|file:\/\/)[^\s`]+|(?:[A-Za-z]:[\\/]|(?:~|\.{1,2})?[\\/])[^\s`]*/giu;
const LETTER_RE = /\p{Letter}/u;
const RTL_SCRIPT_RE = /(?:\p{Script=Arabic}|\p{Script=Hebrew})/u;
const LATIN_SCRIPT_RE = /\p{Script=Latin}/u;

function normalizedWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

/**
 * Returns the usable composer width. Four columns are reserved for `│ ` and
 * ` │` whenever the terminal is wide enough to draw a complete frame.
 */
export function composerFrame(width: number): ComposerFrame {
  const safeWidth = normalizedWidth(width);
  const framed = safeWidth >= 4;
  return {
    width: safeWidth,
    innerWidth: framed ? safeWidth - 4 : safeWidth,
    framed,
  };
}

/**
 * Detects the dominant strong script without changing the editor text. Inline
 * code, URLs, and path-like tokens are ignored so Arabic prose containing an
 * LTR path still reports RTL while the path remains byte-for-byte untouched.
 */
export function detectTextDirection(text: string): TextDirection {
  const prose = withoutPasteMarkers(text).replace(CODE_OR_PATH_RE, " ");
  let rtlLetters = 0;
  let latinLetters = 0;

  for (const character of prose) {
    if (!LETTER_RE.test(character)) continue;
    if (RTL_SCRIPT_RE.test(character)) rtlLetters++;
    else if (LATIN_SCRIPT_RE.test(character)) latinLetters++;
  }

  if (rtlLetters === 0) return "ltr";
  return rtlLetters >= latinLetters ? "rtl" : "ltr";
}

export function directionStatus(text: string): string {
  return detectTextDirection(text) === "rtl" ? "RTL · code/paths LTR" : "LTR";
}

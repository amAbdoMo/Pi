import { Image, getCapabilities, stripTerminalSequences } from "@earendil-works/pi-tui";
import { imagesForText } from "./imagePaste.ts";

const CHAT_IMAGE_MAX_WIDTH_CELLS = 44;
const CHAT_IMAGE_MAX_HEIGHT_CELLS = 20;
const IMAGE_MARKER_LINE_RE = /^\s*\[Image (\d+)\]\s*$/;
const ROLE_LABEL_RE = /^(?:user|assistant|assistant message|you|pi|tool|system)$/i;

// Stable Image components per pasted-image id so Kitty image IDs stay constant
// across frames and the terminal reuses the already-transmitted bitmap.
const chatImageComponents = new Map<number, Image>();

type BorderKind = "pure" | "labeled";

/**
 * Classify a transcript row as part of a message frame. A border row must
 * contain box-drawing glyphs and nothing else besides whitespace or a known
 * role label ("user"). Real content rows always fail this check.
 */
function borderKind(line: string): BorderKind | undefined {
  const plain = stripTerminalSequences(line);
  if (!/[\u2500-\u257f]/u.test(plain)) return undefined;
  const remainder = plain.replace(/[\u2500-\u257f\s]/gu, "");
  if (remainder.length === 0) return "pure";
  if (remainder.length <= 20 && ROLE_LABEL_RE.test(remainder)) return "labeled";
  return undefined;
}

function markerIdOnLine(line: string): number | undefined {
  // Peel side borders and padding so a framed "│ [Image 1] │" row still matches.
  const plain = stripTerminalSequences(line)
    .replace(/^[\u2500-\u257f\s]+/, "")
    .replace(/[\u2500-\u257f\s]+$/, "");
  const match = IMAGE_MARKER_LINE_RE.exec(plain);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : undefined;
}

function chatImage(id: number): Image | undefined {
  const existing = chatImageComponents.get(id);
  if (existing) return existing;
  const image = imagesForText(`[Image ${id}]`)[0];
  if (!image) return undefined;
  const component = new Image(image.data, image.mimeType, {
    fallbackColor: (text: string) => text,
  }, {
    maxWidthCells: CHAT_IMAGE_MAX_WIDTH_CELLS,
    maxHeightCells: CHAT_IMAGE_MAX_HEIGHT_CELLS,
  });
  chatImageComponents.set(id, component);
  return component;
}

/**
 * Replace `[Image N]` markers in the transcript with the actual inline image.
 * Only complete image-only framed messages are swapped: the frame block must
 * run from a top border to a bottom border and contain just the marker as
 * content, so the picture stands alone like tool-result images do. Mixed
 * text-and-image messages keep their textual `[Image N]` marker untouched.
 *
 * Returns the input lines unchanged when the terminal cannot render images or
 * no known pasted-image markers are present.
 */
export function renderChatImageMarkers(lines: readonly string[], mainWidth: number): string[] {
  if (getCapabilities().images === null || lines.length === 0) return [...lines];
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const id = markerIdOnLine(lines[index]);
    const component = id !== undefined ? chatImage(id) : undefined;
    if (!component) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    let start = index;
    while (start > 0 && borderKind(lines[start - 1]) !== undefined) start -= 1;
    let end = index;
    while (end + 1 < lines.length && borderKind(lines[end + 1]) !== undefined) end += 1;
    // A replaceable block closes with a bottom border and holds exactly one
    // content row: the marker itself.
    const closable = borderKind(lines[end]) === "pure";
    let contentRows = 0;
    for (let row = start; row <= end && closable; row += 1) {
      if (borderKind(lines[row]) === undefined) contentRows += 1;
    }
    if (!closable || contentRows !== 1) {
      // Mixed or unterminated content: keep the frame and its marker untouched.
      output.push(lines[index]);
      index += 1;
      continue;
    }
    // Rows between start and index were already emitted above; drop them so the
    // rendered image fully replaces the frame block.
    output.length -= index - start;
    output.push(...component.render(Math.max(8, Math.min(mainWidth - 2, CHAT_IMAGE_MAX_WIDTH_CELLS + 2))));
    index = end + 1;
  }
  return output;
}

import { inflateSync } from "node:zlib";

/**
 * Windows Terminal renders Sixel images but not the Kitty graphics protocol.
 * Pi emits Kitty sequences, so on WT we swap each Kitty image line for an
 * equivalent Sixel drawing of the same cell size and restore the cursor to the
 * image's top row so the TUI's own row accounting stays valid.
 */

const KITTY_SEGMENT_RE = /\x1b_G([^;]*);([^\x1b]*)\x1b\\/g;

export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA, 4 bytes per pixel
}

export function decodePng(bytes: Uint8Array): RgbaImage | undefined {
  if (bytes.length < 8) return undefined;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== signature[i]) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const data = bytes.subarray(dataStart, Math.min(dataStart + length, bytes.length));
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip data + CRC
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) return undefined;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || idat.length === 0) return undefined;

  let raw: Uint8Array;
  try {
    raw = inflateSync(concat(idat));
  } catch {
    return undefined;
  }

  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return undefined;

  // Reverse PNG row filters (None, Sub, Up, Average, Paeth).
  const lines: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      switch (filter) {
        case 1: line[x] = (line[x] + left) & 0xff; break;
        case 2: line[x] = (line[x] + up) & 0xff; break;
        case 3: line[x] = (line[x] + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          line[x] = (line[x] + predictor) & 0xff;
          break;
        }
      }
    }
    lines.push(line);
    previous = line;
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const line = lines[y];
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 3 && palette) {
        const index = line[source];
        pixels[target] = palette[index * 3];
        pixels[target + 1] = palette[index * 3 + 1];
        pixels[target + 2] = palette[index * 3 + 2];
        pixels[target + 3] = 255;
      } else if (colorType === 0) {
        const value = line[source];
        pixels[target] = value;
        pixels[target + 1] = value;
        pixels[target + 2] = value;
        pixels[target + 3] = 255;
      } else if (colorType === 4) {
        const value = line[source];
        pixels[target] = value;
        pixels[target + 1] = value;
        pixels[target + 2] = value;
        pixels[target + 3] = line[source + 1];
      } else {
        pixels[target] = line[source];
        pixels[target + 1] = line[source + 1];
        pixels[target + 2] = line[source + 2];
        pixels[target + 3] = channels === 4 ? line[source + 3] : 255;
      }
    }
  }
  return { width, height, pixels };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Uniform 3-3-2 RGB quantization: fast and dependable for terminal screenshots. */
const quantIndex = (r: number, g: number, b: number): number => ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6);

export function encodeSixel(image: RgbaImage, targetWidth: number, targetHeight: number): string {
  const width = Math.max(1, Math.min(targetWidth, 4096));
  const height = Math.max(1, Math.min(targetHeight, 4096));

  // Sample the source into the target cell size and collect used palette colors.
  const indices = new Int32Array(width * height).fill(-1);
  const usedColors = new Map<number, { r: number; g: number; b: number }>();
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const offset = (sourceY * image.width + sourceX) * 4;
      if (image.pixels[offset + 3] < 128) continue;
      const index = quantIndex(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]);
      indices[y * width + x] = index;
      if (!usedColors.has(index)) {
        usedColors.set(index, {
          r: Math.round(((index >> 5) & 7) * 100 / 7),
          g: Math.round(((index >> 2) & 7) * 100 / 7),
          b: Math.round((index & 3) * 100 / 3),
        });
      }
    }
  }

  const parts: string[] = [`\x1bPq"1;1;${width};${height}`];
  for (const [index, { r, g, b }] of [...usedColors].sort((a, b) => a[0] - b[0])) {
    parts.push(`#${index};2;${r};${g};${b}`);
  }

  for (let band = 0; band < height; band += 6) {
    const bandRows = Math.min(6, height - band);
    const colorsInBand = new Set<number>();
    for (let y = band; y < band + bandRows; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = indices[y * width + x];
        if (index >= 0) colorsInBand.add(index);
      }
    }
    for (const index of [...colorsInBand].sort((a, b) => a - b)) {
      parts.push(`#${index}`);
      let runChar = "";
      let runLength = 0;
      const flush = () => {
        if (!runChar) return;
        parts.push(runLength > 3 ? `!${runLength}${runChar}` : runChar.repeat(runLength));
        runChar = "";
        runLength = 0;
      };
      for (let x = 0; x < width; x += 1) {
        let bits = 0;
        for (let row = 0; row < bandRows; row += 1) {
          if (indices[(band + row) * width + x] === index) bits |= 1 << row;
        }
        if (bits === 0) {
          flush();
          continue;
        }
        const char = String.fromCharCode(0x3f + bits);
        if (char === runChar) runLength += 1;
        else {
          flush();
          runChar = char;
          runLength = 1;
        }
      }
      flush();
    }
    if (band + bandRows < height) parts.push("-");
  }
  parts.push("\x1b\\");
  return parts.join("");
}

/**
 * Replace every embedded Kitty graphics sequence in a rendered transcript line
 * with a Sixel drawing of the same cell footprint, followed by a cursor
 * restore to the image's top row.
 */
export function convertKittyLineToSixel(
  line: string,
  cellWidthPx: number,
  cellHeightPx: number,
): string {
  if (!line.includes("\x1b_G")) return line;
  KITTY_SEGMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let payload = "";
  let columns = 0;
  let rows = 0;
  while ((match = KITTY_SEGMENT_RE.exec(line)) !== null) {
    const controls = match[1].split(",");
    payload += match[2];
    const readControl = (name: string): number => {
      const entry = controls.find((item) => item.startsWith(`${name}=`));
      return Number.parseInt(entry?.slice(name.length + 1) ?? "0", 10) || 0;
    };
    columns = readControl("c");
    rows = readControl("r");
  }
  if (!payload) return line;

  const png = decodePng(base64ToBytes(payload));
  if (!png) return line;

  const resolvedColumns = columns > 0 ? columns : Math.max(1, Math.round(png.width / cellWidthPx));
  const resolvedRows = rows > 0 ? rows : Math.max(1, Math.round(png.height / cellHeightPx));
  const sixel = encodeSixel(png, resolvedColumns * cellWidthPx, resolvedRows * cellHeightPx);
  // After drawing, the cursor sits below the image; return it to the top row of
  // the image so the TUI's remaining reserved rows and following content align.
  const cursorRestore = resolvedRows > 1 ? `\x1b[${resolvedRows}A` : "";
  return sixel + cursorRestore;
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type PastedImage = {
  marker: string;
  mimeType: string;
  data: string;
};

export type PastedText = {
  marker: string;
  text: string;
};

export const IMAGE_MARKER_RE = /\[Image (\d+)\]/g;
export const TEXT_MARKER_RE = /\[(\d+) lines? pasted #(\d+)\]/g;

const pastedImages = new Map<number, PastedImage>();
const pastedTexts = new Map<number, PastedText>();

function nextId(currentText: string, markerPattern: RegExp, idGroup: number): number {
  const usedIds = new Set(
    [...currentText.matchAll(markerPattern)].map((match) => Number(match[idGroup])).filter(Number.isFinite),
  );

  let id = 1;
  while (usedIds.has(id)) id++;
  return id;
}

function nextImageId(currentText: string): number {
  return nextId(currentText, IMAGE_MARKER_RE, 1);
}

function nextTextId(currentText: string): number {
  return nextId(currentText, TEXT_MARKER_RE, 2);
}

function pastedLineCount(text: string): number {
  const normalized = text.replace(/\n$/, "");
  if (!normalized) return 1;
  return normalized.split("\n").length;
}

function saveImage(bytes: Uint8Array, mimeType: string, currentText: string): PastedImage {
  const id = nextImageId(currentText);
  const image: PastedImage = {
    marker: `[Image ${id}]`,
    mimeType,
    data: Buffer.from(bytes).toString("base64"),
  };
  pastedImages.set(id, image);
  return image;
}

function readClipboardImageViaPowerShell(currentText: string): PastedImage | null {
  const filePath = path.join(os.tmpdir(), `pi-clipboard-image-${crypto.randomUUID()}.png`);
  try {
    const escapedPath = filePath.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      `$path = '${escapedPath}'`,
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($img -eq $null) { exit 2 }",
      "$img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
    ].join("; ");

    execFileSync("powershell.exe", ["-NoProfile", "-Sta", "-Command", script], {
      timeout: 5000,
      stdio: ["ignore", "ignore", "ignore"],
    });

    if (!fs.existsSync(filePath)) return null;
    const bytes = fs.readFileSync(filePath);
    if (bytes.length === 0) return null;
    return saveImage(bytes, "image/png", currentText);
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
  }
}

export function readClipboardText(): string {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
      encoding: "utf8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  } catch {
    return "";
  }
}

export function savePastedText(text: string, currentText: string): PastedText {
  const id = nextTextId(currentText);
  const lineCount = pastedLineCount(text);
  const noun = lineCount === 1 ? "line" : "lines";
  const marker = `[${lineCount} ${noun} pasted #${id}]`;
  const pastedText = { marker, text };
  pastedTexts.set(id, pastedText);
  return pastedText;
}

function mimeTypeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

function readImageFile(filePath: string, currentText: string): PastedImage | null {
  try {
    const cleaned = filePath.trim().replace(/^"|"$/g, "");
    const mimeType = mimeTypeFromPath(cleaned);
    if (!mimeType || !fs.existsSync(cleaned)) return null;
    return saveImage(fs.readFileSync(cleaned), mimeType, currentText);
  } catch {
    return null;
  }
}

export function readBestImage(currentText = ""): PastedImage | null {
  const clipboardImage = readClipboardImageViaPowerShell(currentText);
  if (clipboardImage) return clipboardImage;

  const clipboardText = readClipboardText();
  for (const line of clipboardText.split(/\r?\n/)) {
    const image = readImageFile(line, currentText);
    if (image) return image;
  }
  return null;
}

export function imagesForText(text: string): PastedImage[] {
  const ids = [...text.matchAll(IMAGE_MARKER_RE)].map((match) => Number(match[1])).filter(Number.isFinite);
  return [...new Set(ids)].map((id) => pastedImages.get(id)).filter((image): image is PastedImage => Boolean(image));
}

export function expandPastedTextMarkers(text: string): string {
  return text.replace(TEXT_MARKER_RE, (marker, _lineCount, idText) => {
    const pastedText = pastedTexts.get(Number(idText));
    return pastedText?.text ?? marker;
  });
}

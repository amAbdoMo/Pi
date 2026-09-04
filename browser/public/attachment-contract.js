export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_IMAGE_ATTACHMENT_COUNT = 3;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 3 * 1024 * 1024;
export const MAX_BROWSER_COMMAND_BYTES = 5 * 1024 * 1024;
export const MAX_BROWSER_RPC_LINE_BYTES = 8 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function startsWithText(bytes, text, offset = 0) {
  return startsWith(bytes, [...text].map((character) => character.charCodeAt(0)), offset);
}

function readUint16LE(bytes, offset) {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0));
}

function readUint32LE(bytes, offset) {
  return ((bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    (bytes[offset + 3] ?? 0) * 0x1000000);
}

function isSupportedPng(bytes) {
  if (!startsWith(bytes, PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.length;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32BE(bytes, offset);
    const typeOffset = offset + 4;
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset <= offset || nextOffset > bytes.length) return false;
    if (offset === PNG_SIGNATURE.length && (chunkLength !== 13 || !startsWithText(bytes, "IHDR", typeOffset))) return false;
    if (startsWithText(bytes, "acTL", typeOffset)) return false;
    if (startsWithText(bytes, "IDAT", typeOffset)) sawImageData = true;
    if (startsWithText(bytes, "IEND", typeOffset)) return chunkLength === 0 && sawImageData && nextOffset === bytes.length;
    offset = nextOffset;
  }
  return false;
}

function isGif(bytes) {
  const validHeader = startsWithText(bytes, "GIF87a") || startsWithText(bytes, "GIF89a");
  return validHeader && bytes.length >= 14 && readUint16LE(bytes, 6) > 0 &&
    readUint16LE(bytes, 8) > 0 && bytes.at(-1) === 0x3b;
}

function isWebp(bytes) {
  if (!startsWithText(bytes, "RIFF") || !startsWithText(bytes, "WEBP", 8) || bytes.length < 20) return false;
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  return readUint32LE(bytes, 4) === bytes.length - 8 && ["VP8 ", "VP8L", "VP8X"].includes(chunkType);
}

function isJpeg(bytes) {
  if (!startsWith(bytes, [0xff, 0xd8]) || !startsWith(bytes.subarray(bytes.length - 2), [0xff, 0xd9])) return false;
  let cursor = 2;
  let sawFrame = false;
  while (cursor + 3 < bytes.length - 2) {
    if (bytes[cursor] !== 0xff) return false;
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor];
    if (marker === 0xda) return sawFrame;
    const segmentLength = (bytes[cursor + 1] << 8) + bytes[cursor + 2];
    if (segmentLength < 2 || cursor + 1 + segmentLength > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) sawFrame = true;
    cursor += 1 + segmentLength;
  }
  return false;
}

function isBmp(bytes) {
  if (bytes.length < 30 || !startsWithText(bytes, "BM")) return false;
  const fileSize = readUint32LE(bytes, 2);
  const pixelOffset = readUint32LE(bytes, 10);
  const headerSize = readUint32LE(bytes, 14);
  const planesOffset = headerSize === 12 ? 22 : 26;
  const bitsOffset = headerSize === 12 ? 24 : 28;
  if (headerSize !== 12 && (headerSize < 40 || headerSize > 124)) return false;
  return (fileSize === 0 || fileSize === bytes.length) && pixelOffset >= 14 + headerSize &&
    pixelOffset < bytes.length && readUint16LE(bytes, planesOffset) === 1 &&
    [1, 4, 8, 16, 24, 32].includes(readUint16LE(bytes, bitsOffset));
}

export function detectedImageType(bytes) {
  if (isJpeg(bytes)) return "image/jpeg";
  if (isSupportedPng(bytes)) return "image/png";
  if (isGif(bytes)) return "image/gif";
  if (isWebp(bytes)) return "image/webp";
  return isBmp(bytes) ? "image/bmp" : null;
}

export function decodedBase64Size(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return -1;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function validatedAttachment(image, decodeBase64) {
  if (!image || typeof image !== "object" || Array.isArray(image)) throw new TypeError("Invalid image attachment");
  if (Object.keys(image).sort().join(",") !== "data,mimeType,type" || image.type !== "image") {
    throw new TypeError("Image attachments must contain only type, data, and mimeType");
  }
  const byteLength = decodedBase64Size(image.data);
  if (byteLength < 1 || byteLength > MAX_ATTACHMENT_BYTES) throw new TypeError("Each image must be 1 MB or smaller");
  const bytes = decodeBase64(image.data);
  if (!(bytes instanceof Uint8Array) || bytes.length !== byteLength || detectedImageType(bytes) !== image.mimeType) {
    throw new TypeError("Image data does not match its supported file type");
  }
  return { byteLength, image: { type: "image", data: image.data, mimeType: image.mimeType } };
}

export function validateAttachmentList(images, decodeBase64) {
  if (images === undefined) return undefined;
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGE_ATTACHMENT_COUNT) {
    throw new TypeError(`Attach between 1 and ${MAX_IMAGE_ATTACHMENT_COUNT} images`);
  }
  const attachments = images.map((image) => validatedAttachment(image, decodeBase64));
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.byteLength, 0);
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new TypeError("Combined images are too large");
  return attachments.map((attachment) => attachment.image);
}

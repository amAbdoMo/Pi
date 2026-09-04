import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_IMAGE_ATTACHMENT_COUNT,
  detectedImageType,
} from "./attachment-contract.js";
import {
  MAX_TEXT_REFERENCE_BYTES,
  normalizeReferenceMimeType,
  normalizeReferenceName,
  validateTextReference,
} from "./reference-contract.js";

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fileBytes(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new TypeError("Choose an image or UTF-8 text file");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
    throw new TypeError("Each attachment must be 1 MB or smaller");
  }
  return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function imageAttachment(bytes, name, mimeType) {
  const data = base64FromBytes(bytes);
  return {
    kind: "image",
    name: String(name || "Image"),
    size: bytes.length,
    previewUrl: `data:${mimeType};base64,${data}`,
    image: { type: "image", data, mimeType },
  };
}

function decodedText(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) {
    if (error instanceof TypeError) throw new TypeError("Text files must contain valid UTF-8");
    throw error;
  }
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function textAttachment(bytes, file) {
  if (bytes.length > MAX_TEXT_REFERENCE_BYTES) throw new TypeError("Each text file must be 512 KB or smaller");
  const name = normalizeReferenceName(String(file.name || ""));
  const mimeType = normalizeReferenceMimeType(name, file.type);
  const validated = validateTextReference({ type: "text", name, mimeType, text: decodedText(bytes) });
  return {
    kind: "text",
    name,
    size: validated.byteLength,
    reference: validated.reference,
  };
}

export function runtimeModel(currentModel, runtimeState) {
  return Object.hasOwn(runtimeState, "model") ? runtimeState.model ?? null : currentModel;
}

export function attachmentLabelBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function imageAttachmentFromFile(file) {
  const bytes = await fileBytes(file);
  const mimeType = detectedImageType(bytes);
  if (!mimeType) throw new TypeError("Use a supported PNG, JPEG, GIF, WebP, or BMP image");
  return imageAttachment(bytes, file.name, mimeType);
}

export async function textAttachmentFromFile(file) {
  const bytes = await fileBytes(file);
  if (detectedImageType(bytes)) throw new TypeError("Image bytes cannot be attached as a text reference");
  return textAttachment(bytes, file);
}

export async function attachmentFromFile(file, { allowImages = true } = {}) {
  const bytes = await fileBytes(file);
  const mimeType = detectedImageType(bytes);
  if (mimeType) {
    if (!allowImages) throw new TypeError("The selected Pi model does not accept images");
    return imageAttachment(bytes, file.name, mimeType);
  }
  return textAttachment(bytes, file);
}

export function assertAttachmentCapacity(current, additions) {
  const attachments = [...current, ...additions];
  if (attachments.length > MAX_ATTACHMENT_COUNT) throw new TypeError(`Attach up to ${MAX_ATTACHMENT_COUNT} files`);
  if (attachments.filter((attachment) => attachment.kind === "image").length > MAX_IMAGE_ATTACHMENT_COUNT) {
    throw new TypeError(`Attach up to ${MAX_IMAGE_ATTACHMENT_COUNT} images`);
  }
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new TypeError("Combined attachments are too large");
}

export async function loadImageAttachments(files, currentAttachments, contextIsCurrent) {
  const additions = [];
  for (const file of files) additions.push(await imageAttachmentFromFile(file));
  if (!contextIsCurrent()) throw new TypeError("The session or model changed while images were loading");
  assertAttachmentCapacity(currentAttachments, additions);
  return additions;
}

export async function loadAttachments(files, currentAttachments, contextIsCurrent, options) {
  const additions = [];
  for (const file of files) additions.push(await attachmentFromFile(file, options));
  if (!contextIsCurrent()) throw new TypeError("The session changed while attachments were loading");
  assertAttachmentCapacity(currentAttachments, additions);
  return additions;
}

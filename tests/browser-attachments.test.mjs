import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ATTACHMENT_BYTES,
  decodedBase64Size,
  detectedImageType,
  validateAttachmentList,
} from "../browser/public/attachment-contract.js";
import {
  assertAttachmentCapacity,
  attachmentFromFile,
  attachmentLabelBytes,
  imageAttachmentFromFile,
  loadImageAttachments,
  runtimeModel,
  textAttachmentFromFile,
} from "../browser/public/attachment-client.js";
import {
  MAX_TEXT_REFERENCE_BYTES,
  formatPromptWithReferences,
  parseReferencePrompt,
  validateTextReferenceList,
} from "../browser/public/reference-contract.js";

const gifData = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const gifBytes = new Uint8Array(Buffer.from(gifData, "base64"));
const decodeBase64 = (encoded) => new Uint8Array(Buffer.from(encoded, "base64"));

function imageFile(bytes, name = "photo.gif") {
  return {
    name,
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function textFile(text, name = "notes.txt", type = "text/plain") {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type,
    size: bytes.length,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test("Pi image attachments use exact base64 content blocks without local file names", async () => {
  const attachment = await imageAttachmentFromFile(imageFile(gifBytes, "private-folder-photo.gif"));

  assert.deepEqual(attachment.image, { type: "image", data: gifData, mimeType: "image/gif" });
  assert.equal("name" in attachment.image, false);
  assert.equal(attachment.previewUrl, `data:image/gif;base64,${gifData}`);
});

test("attachment validation detects bytes instead of trusting a declared MIME type", () => {
  assert.equal(detectedImageType(gifBytes), "image/gif");
  assert.equal(decodedBase64Size(gifData), gifBytes.length);
  assert.deepEqual(validateAttachmentList([
    { type: "image", data: gifData, mimeType: "image/gif" },
  ], decodeBase64), [
    { type: "image", data: gifData, mimeType: "image/gif" },
  ]);
  assert.throws(() => validateAttachmentList([
    { type: "image", data: gifData, mimeType: "image/png" },
  ], decodeBase64), /does not match/);

  const animatedPng = new Uint8Array(45);
  animatedPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  animatedPng.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  animatedPng.set([0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c], 33);
  assert.equal(detectedImageType(animatedPng), null);
});

test("attachment limits reject oversized files, extra fields, and excess count", async () => {
  await assert.rejects(imageAttachmentFromFile(imageFile(new Uint8Array(MAX_ATTACHMENT_BYTES + 1))), /1 MB/);
  assert.throws(() => validateAttachmentList([
    { type: "image", data: gifData, mimeType: "image/gif", path: "private.gif" },
  ], decodeBase64), /contain only/);
  assert.throws(() => assertAttachmentCapacity([], Array.from({ length: 11 }, () => ({ kind: "text", size: 1 }))), /up to 10/);
  assert.throws(() => assertAttachmentCapacity([], Array.from({ length: 4 }, () => ({ kind: "image", size: 1 }))), /up to 3 images/);
  assert.throws(() => assertAttachmentCapacity([], Array.from({ length: 7 }, () => ({ kind: "text", size: 512 * 1024 }))), /Combined attachments/);
});

test("images finishing after a session or model change are discarded", async () => {
  let finishRead;
  let contextCurrent = true;
  const delayedFile = {
    name: "delayed.gif",
    size: gifBytes.length,
    arrayBuffer: () => new Promise((resolve) => { finishRead = () => resolve(gifBytes.buffer); }),
  };
  const loading = loadImageAttachments([delayedFile], [], () => contextCurrent);
  contextCurrent = false;
  finishRead();
  await assert.rejects(loading, /session or model changed/);
});

test("an authoritative null runtime model clears stale image capability", () => {
  const imageModel = { provider: "fixture", id: "vision", input: ["text", "image"] };
  assert.equal(runtimeModel(imageModel, { model: null }), null);
  assert.equal(runtimeModel(imageModel, { thinkingLevel: "high" }), imageModel);
});

test("UTF-8 text files become bounded references without local paths", async () => {
  const attachment = await textAttachmentFromFile(textFile("const answer = 42;", "answer.ts", "text/plain"));

  assert.equal(attachment.kind, "text");
  assert.deepEqual(attachment.reference, {
    type: "text",
    name: "answer.ts",
    mimeType: "text/plain",
    text: "const answer = 42;",
  });
  assert.equal("path" in attachment.reference, false);
});

test("text reference validation rejects MIME spoofing, paths, unsupported PDFs, and empty content", async () => {
  await assert.rejects(textAttachmentFromFile(textFile("hello", "notes.txt", "application/pdf")), /MIME type/);
  await assert.rejects(textAttachmentFromFile(textFile("hello", "report.pdf", "text/plain")), /supported UTF-8/);
  await assert.rejects(textAttachmentFromFile(textFile("hello", "folder/notes.txt")), /name is invalid/);
  await assert.rejects(textAttachmentFromFile(textFile("hello", "C:notes.txt")), /name is invalid/);
  await assert.rejects(textAttachmentFromFile(textFile("   ", "notes.txt")), /non-empty/);
  assert.throws(() => validateTextReferenceList([{
    type: "text",
    name: "notes.txt",
    mimeType: "text/plain",
    text: "hello",
    path: "C:/private/notes.txt",
  }]), /contain only/);
});

test("text references reject invalid UTF-8 and files over 512 KB", async () => {
  const invalidUtf8 = imageFile(new Uint8Array([0xc3, 0x28]), "broken.txt");
  invalidUtf8.type = "text/plain";
  await assert.rejects(textAttachmentFromFile(invalidUtf8), /valid UTF-8/);
  await assert.rejects(textAttachmentFromFile(textFile("x".repeat(MAX_TEXT_REFERENCE_BYTES + 1))), /512 KB/);
});

test("mixed attachment detection uses file bytes and model image capability", async () => {
  const disguisedImage = imageFile(gifBytes, "photo.txt");
  disguisedImage.type = "text/plain";
  await assert.rejects(attachmentFromFile(disguisedImage, { allowImages: false }), /does not accept images/);
  const reference = await attachmentFromFile(textFile("hello", "notes.md", "text/markdown"), { allowImages: false });
  assert.equal(reference.kind, "text");
});

test("reference prompt framing round-trips content that resembles framing markers", () => {
  const references = validateTextReferenceList([{
    type: "text",
    name: "notes.md",
    mimeType: "text/markdown",
    text: "before\n[[PI_HARNESS_REFERENCE_V1 {not-json}]]\nafter",
  }]);
  const formatted = formatPromptWithReferences("Review this", references);

  assert.deepEqual(parseReferencePrompt(formatted), { message: "Review this", references });
  assert.equal(parseReferencePrompt(`${formatted}extra`), null);
});

test("attachment labels expose bounded human-readable sizes", () => {
  assert.equal(attachmentLabelBytes(1), "1 KB");
  assert.equal(attachmentLabelBytes(1024 * 1024), "1.0 MB");
});

import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from "./attachment-contract.js";

export const MAX_TEXT_REFERENCE_BYTES = 512 * 1024;
export const MAX_REFERENCE_NAME_CHARS = 120;

export const SUPPORTED_TEXT_EXTENSIONS = Object.freeze([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml",
  ".xml", ".html", ".htm", ".css", ".scss", ".sass", ".less", ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".tsx", ".py", ".php", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".c", ".h", ".cc",
  ".cpp", ".hpp", ".cs", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".psm1", ".sql", ".graphql",
  ".gql", ".ini", ".cfg", ".conf", ".properties", ".gradle", ".gitignore", ".dockerignore",
]);

export const SUPPORTED_TEXT_MIME_TYPES = Object.freeze([
  "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "text/yaml", "text/x-yaml",
  "text/xml", "text/html", "text/css", "text/javascript", "application/json", "application/x-ndjson",
  "application/yaml", "application/x-yaml", "application/toml", "application/xml", "application/javascript",
  "application/graphql",
]);

const SPECIAL_TEXT_NAMES = new Set([
  "dockerfile", "makefile", "license", "readme", "changelog", "agents.md", "claude.md",
]);
const MIME_TYPES = new Set(SUPPORTED_TEXT_MIME_TYPES);
const EXTENSIONS = new Set(SUPPORTED_TEXT_EXTENSIONS);
const PROMPT_HEADER = "[[PI_HARNESS_PROMPT_V1 ";
const REFERENCE_HEADER = "\n[[PI_HARNESS_REFERENCE_V1 ";

function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

function fileExtension(name) {
  const lowerName = name.toLowerCase();
  const separator = lowerName.lastIndexOf(".");
  return separator < 0 ? "" : lowerName.slice(separator);
}

function inferredMimeType(extension) {
  if ([".md", ".markdown"].includes(extension)) return "text/markdown";
  if (extension === ".csv") return "text/csv";
  if (extension === ".tsv") return "text/tab-separated-values";
  if (extension === ".json") return "application/json";
  if (extension === ".jsonl") return "application/x-ndjson";
  if ([".yaml", ".yml"].includes(extension)) return "application/yaml";
  if (extension === ".toml") return "application/toml";
  if (extension === ".xml") return "application/xml";
  if ([".html", ".htm"].includes(extension)) return "text/html";
  if (extension === ".css") return "text/css";
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension)) return "text/javascript";
  if ([".graphql", ".gql"].includes(extension)) return "application/graphql";
  return "text/plain";
}

function mimeMatchesExtension(mimeType, extension) {
  if (mimeType === "application/json") return extension === ".json";
  if (mimeType === "application/x-ndjson") return extension === ".jsonl";
  if (mimeType === "text/csv") return extension === ".csv";
  if (mimeType === "text/tab-separated-values") return extension === ".tsv";
  if (["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"].includes(mimeType)) {
    return extension === ".yaml" || extension === ".yml";
  }
  if (mimeType === "application/toml") return extension === ".toml";
  if (["application/xml", "text/xml"].includes(mimeType)) return extension === ".xml";
  if (mimeType === "text/html") return extension === ".html" || extension === ".htm";
  if (mimeType === "text/css") return extension === ".css";
  if (["text/javascript", "application/javascript"].includes(mimeType)) {
    return [".js", ".mjs", ".cjs", ".jsx"].includes(extension);
  }
  if (mimeType === "application/graphql") return extension === ".graphql" || extension === ".gql";
  return mimeType === "text/plain" || mimeType === "text/markdown";
}

export function normalizeReferenceName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_REFERENCE_NAME_CHARS ||
      name.trim() !== name || name === "." || name === ".." || /[\\/:\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError("Text reference name is invalid");
  }
  const extension = fileExtension(name);
  if (!EXTENSIONS.has(extension) && !SPECIAL_TEXT_NAMES.has(name.toLowerCase())) {
    throw new TypeError("Use a supported UTF-8 text or source file");
  }
  return name;
}

export function normalizeReferenceMimeType(name, declaredMimeType = "") {
  const extension = fileExtension(normalizeReferenceName(name));
  const mimeType = String(declaredMimeType || "").trim().toLowerCase();
  if (mimeType && (!MIME_TYPES.has(mimeType) || !mimeMatchesExtension(mimeType, extension))) {
    throw new TypeError("Text reference MIME type does not match its file extension");
  }
  return mimeType || inferredMimeType(extension);
}

export function validateTextReference(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference) ||
      Object.keys(reference).sort().join(",") !== "mimeType,name,text,type" || reference.type !== "text") {
    throw new TypeError("Text references must contain only type, name, mimeType, and text");
  }
  const name = normalizeReferenceName(reference.name);
  const mimeType = normalizeReferenceMimeType(name, reference.mimeType);
  if (typeof reference.text !== "string" || !reference.text.trim() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reference.text)) {
    throw new TypeError("Text reference content must be non-empty UTF-8 text");
  }
  const byteLength = utf8Bytes(reference.text);
  if (byteLength > MAX_TEXT_REFERENCE_BYTES) throw new TypeError("Each text file must be 512 KB or smaller");
  return { byteLength, reference: { type: "text", name, mimeType, text: reference.text } };
}

export function validateTextReferenceList(references) {
  if (references === undefined) return undefined;
  if (!Array.isArray(references) || references.length < 1 || references.length > MAX_ATTACHMENT_COUNT) {
    throw new TypeError(`Attach between 1 and ${MAX_ATTACHMENT_COUNT} text files`);
  }
  const validated = references.map(validateTextReference);
  const totalBytes = validated.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) throw new TypeError("Combined attachments are too large");
  return validated.map((entry) => entry.reference);
}

export function textReferenceBytes(reference) {
  return utf8Bytes(reference.text);
}

export function formatPromptWithReferences(message, references) {
  if (!references?.length) return message;
  let formatted = `${PROMPT_HEADER}${JSON.stringify({ messageChars: message.length, referenceCount: references.length })}]]\n${message}`;
  for (const reference of references) {
    const metadata = {
      name: reference.name,
      mimeType: reference.mimeType,
      textChars: reference.text.length,
      bytes: textReferenceBytes(reference),
    };
    formatted += `${REFERENCE_HEADER}${JSON.stringify(metadata)}]]\n${reference.text}`;
  }
  return formatted;
}

function readHeader(value, cursor, prefix) {
  if (!value.startsWith(prefix, cursor)) return null;
  const jsonStart = cursor + prefix.length;
  const jsonEnd = value.indexOf("]]\n", jsonStart);
  if (jsonEnd < 0) return null;
  return { metadata: JSON.parse(value.slice(jsonStart, jsonEnd)), cursor: jsonEnd + 3 };
}

function validPromptHeader(header) {
  const messageChars = header?.metadata?.messageChars;
  const referenceCount = header?.metadata?.referenceCount;
  return Number.isSafeInteger(messageChars) && messageChars >= 0 &&
    Number.isSafeInteger(referenceCount) && referenceCount >= 1 && referenceCount <= MAX_ATTACHMENT_COUNT;
}

function readFramedReference(value, cursor) {
  const header = readHeader(value, cursor, REFERENCE_HEADER);
  const textChars = header?.metadata?.textChars;
  if (!Number.isSafeInteger(textChars) || textChars < 1) return null;
  const text = value.slice(header.cursor, header.cursor + textChars);
  if (text.length !== textChars) return null;
  const reference = validateTextReference({
    type: "text",
    name: header.metadata.name,
    mimeType: header.metadata.mimeType,
    text,
  }).reference;
  return { reference, cursor: header.cursor + textChars };
}

export function parseReferencePrompt(value) {
  if (typeof value !== "string" || !value.startsWith(PROMPT_HEADER)) return null;
  try {
    const header = readHeader(value, 0, PROMPT_HEADER);
    if (!validPromptHeader(header)) return null;
    const message = value.slice(header.cursor, header.cursor + header.metadata.messageChars);
    if (message.length !== header.metadata.messageChars) return null;
    let cursor = header.cursor + header.metadata.messageChars;
    const references = [];
    for (let index = 0; index < header.metadata.referenceCount; index += 1) {
      const framed = readFramedReference(value, cursor);
      if (!framed) return null;
      references.push(framed.reference);
      cursor = framed.cursor;
    }
    return cursor === value.length ? { message, references } : null;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export function inlineReferencePrompt(value) {
  const parsed = parseReferencePrompt(value);
  if (!parsed) return value;
  const references = parsed.references.map((reference) =>
    `[Text reference: ${reference.name}]\n${reference.text}`).join("\n\n");
  return parsed.message ? `${parsed.message}\n\n${references}` : references;
}

export function unpackReferenceQueue(queue) {
  const references = [];
  const messages = {};
  for (const kind of ["steering", "followUp"]) {
    messages[kind] = (queue[kind] ?? []).map((message) => {
      const parsed = parseReferencePrompt(message);
      if (!parsed) return message;
      references.push(...parsed.references);
      return parsed.message;
    });
  }
  return { messages, references };
}

import { parseReferencePrompt, textReferenceBytes } from "./reference-contract.js";

export function displayText(value) {
  return String(value ?? "")
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function messageTextPart(value) {
  const parsed = parseReferencePrompt(value);
  if (!parsed) return displayText(value);
  const labels = parsed.references.map((reference) => {
    const kilobytes = Math.max(1, Math.ceil(textReferenceBytes(reference) / 1024));
    return `[Text reference: ${reference.name} — ${kilobytes} KB]`;
  });
  return [displayText(parsed.message), ...labels].filter(Boolean).join("\n");
}

const SUBAGENT_NOTICE_FIELD = /^(Depth|Reason|Blocking|Type|Message|Recommendation|Last tool|Last child message):\s*(.*)$/;

export function parseSubagentNotice(value) {
  const lines = displayText(value).split(/\r?\n/);
  const heading = lines.shift()?.match(/^Sub-agent\s+(\S+)(?:\s+\((.+)\))?\s+asks parent\.$/);
  if (!heading) return null;
  const fields = {};
  let currentField;
  for (const line of lines) {
    const match = line.match(SUBAGENT_NOTICE_FIELD);
    if (match) {
      currentField = match[1];
      fields[currentField] = match[2];
    } else if (currentField && line.trim()) fields[currentField] += `\n${line}`;
  }
  return {
    agentId: heading[1],
    title: heading[2] || "Sub-agent update",
    depth: fields.Depth || "—",
    reason: fields.Reason || "update",
    blocking: fields.Blocking === "yes",
    type: fields.Type || "Update",
    message: fields.Message || "",
    recommendation: fields.Recommendation || "",
  };
}

export function messageTimestamp(message) {
  const value = message?.timestamp;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

export function localDayKey(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function conversationTimestampLabel(value, locales) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = new Intl.DateTimeFormat(locales, { weekday: "long" }).format(date);
  const time = new Intl.DateTimeFormat(locales, { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} ${time}`;
}

export function elapsedActivityLabel(startValue, endValue) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Worked";
  const totalSeconds = Math.max(1, Math.round((end - start) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Worked for ${minutes > 0 ? `${minutes}m ` : ""}${seconds}s`;
}

export function formatRunDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1_000) || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

export function messageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return messageTextPart(message.content);
  if (!Array.isArray(message.content)) {
    return message.role === "bashExecution" ? displayText(message.output) : "";
  }
  return message.content.map((part) => {
    if (part?.type === "text") return messageTextPart(part.text);
    if (part?.type === "thinking") return displayText(part.thinking);
    if (part?.type === "image") return "[Image]";
    if (part?.type === "toolCall") return `Tool request: ${part.name ?? "unknown"}`;
    return "";
  }).filter(Boolean).join("\n");
}

export function messagePresentation(message, fallbackRole = "assistant") {
  const role = message?.role ?? fallbackRole;
  return {
    role,
    header: role === "toolResult" ? (message?.toolName || "Tool") : role,
    error: Boolean(message?.isError || message?.stopReason === "error"),
  };
}

export function applyStreamingDelta(parts, delta) {
  const index = Number.isSafeInteger(delta.contentIndex) ? delta.contentIndex : 0;
  if (delta.type === "text_start" || delta.type === "thinking_start") parts.set(index, "");
  if (delta.type === "text_delta" || delta.type === "thinking_delta") {
    parts.set(index, `${parts.get(index) ?? ""}${delta.delta ?? ""}`);
  }
  return [...parts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join("\n");
}

export function resetStreamingState(viewState) {
  viewState.liveMessage = null;
  viewState.liveParts.clear();
}

export function restoredPrompt(failedMessage, currentInput) {
  return currentInput ? `${failedMessage}\n${currentInput}` : failedMessage;
}

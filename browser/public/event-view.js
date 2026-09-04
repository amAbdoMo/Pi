import { displayText } from "./message-view.js";

export const MAX_TOOL_DETAIL_CHARS = 64 * 1024;

export const SAFE_IGNORED_EVENT_TYPES = new Set([
  "browser_connected",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "bash_execution_update",
  "pi_custom_event",
]);

export const UI_EVENT_TYPES = new Set([
  "agent_start",
  "agent_settled",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "extension_error",
  "extension_ui_request",
  "browser_error",
  "session_changed",
]);

function serializedDetail(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); }
  catch (error) {
    if (error instanceof TypeError) return "[Unserializable tool detail]";
    throw error;
  }
}

export function boundedToolDetail(value) {
  const text = displayText(serializedDetail(value));
  if (text.length <= MAX_TOOL_DETAIL_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_DETAIL_CHARS)}\n[Tool detail truncated]`;
}

function retryStartLabel(event) {
  const attempt = Number.isSafeInteger(event.attempt) ? event.attempt : "?";
  const maximum = Number.isSafeInteger(event.maxAttempts) ? ` of ${event.maxAttempts}` : "";
  return `Retry ${attempt}${maximum}`;
}

export function lifecycleActivity(event) {
  switch (event.type) {
    case "auto_retry_start": return { label: retryStartLabel(event), tone: "warn" };
    case "auto_retry_end": return event.success
      ? { label: `Retry ${event.attempt ?? ""} succeeded`.replace("  ", " "), tone: "idle" }
      : { label: `Retry ${event.attempt ?? ""} failed`.replace("  ", " "), tone: "error", error: event.finalError };
    case "summarization_retry_scheduled": return { label: retryStartLabel(event).replace("Retry", "Summary retry"), tone: "warn" };
    case "summarization_retry_attempt_start": return { label: "Retrying summary", tone: "live" };
    case "summarization_retry_finished": return { label: "Summary retry finished", tone: "idle" };
    case "compaction_start": return { label: "Compacting context", tone: "warn", compacting: true };
    case "compaction_end":
      if (event.aborted) return { label: "Context compaction cancelled", tone: "warn", compacting: false };
      if (!event.result) return { label: "Context compaction failed", tone: "error", compacting: false, error: event.errorMessage };
      return { label: "Context compacted", tone: "idle", compacting: false };
    default: return null;
  }
}

export function hasExplicitEventDecision(type) {
  return UI_EVENT_TYPES.has(type) || SAFE_IGNORED_EVENT_TYPES.has(type);
}

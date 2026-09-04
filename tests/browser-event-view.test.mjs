import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TOOL_DETAIL_CHARS,
  SAFE_IGNORED_EVENT_TYPES,
  UI_EVENT_TYPES,
  boundedToolDetail,
  hasExplicitEventDecision,
  lifecycleActivity,
} from "../browser/public/event-view.js";

const INSTALLED_PI_EVENTS = [
  "agent_start", "agent_end", "agent_settled", "turn_start", "turn_end",
  "message_start", "message_update", "message_end", "bash_execution_update",
  "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update",
  "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end",
  "summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished",
  "extension_error", "extension_ui_request",
];

test("every installed Pi event has an explicit UI or safe-ignore decision", () => {
  for (const type of INSTALLED_PI_EVENTS) assert.equal(hasExplicitEventDecision(type), true, type);
  assert.equal(hasExplicitEventDecision("undocumented_event"), false);
  assert.equal(UI_EVENT_TYPES.has("message_end"), true);
  assert.equal(UI_EVENT_TYPES.has("session_changed"), true);
  assert.equal(SAFE_IGNORED_EVENT_TYPES.has("message_end"), false);
});

test("retry and summarization events map to truthful activity states", () => {
  assert.deepEqual(lifecycleActivity({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }),
    { label: "Retry 2 of 3", tone: "warn" });
  assert.deepEqual(lifecycleActivity({ type: "auto_retry_end", success: false, attempt: 3, finalError: "overloaded" }),
    { label: "Retry 3 failed", tone: "error", error: "overloaded" });
  assert.deepEqual(lifecycleActivity({ type: "summarization_retry_attempt_start", source: "compaction" }),
    { label: "Retrying summary", tone: "live" });
});

test("compaction cancellation and failure are not presented as success", () => {
  assert.deepEqual(lifecycleActivity({ type: "compaction_end", aborted: true }),
    { label: "Context compaction cancelled", tone: "warn", compacting: false });
  assert.deepEqual(lifecycleActivity({ type: "compaction_end", result: null, errorMessage: "quota" }),
    { label: "Context compaction failed", tone: "error", compacting: false, error: "quota" });
  assert.deepEqual(lifecycleActivity({ type: "compaction_end", result: {} }),
    { label: "Context compacted", tone: "idle", compacting: false });
});

test("tool details strip controls and remain bounded before DOM rendering", () => {
  assert.equal(boundedToolDetail("safe\u001b[31m red\u0000"), "safe red");
  const bounded = boundedToolDetail({ output: "x".repeat(MAX_TOOL_DETAIL_CHARS + 100) });
  assert.ok(bounded.length <= MAX_TOOL_DETAIL_CHARS + 30);
  assert.match(bounded, /\[Tool detail truncated\]$/);
});

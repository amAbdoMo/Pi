import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStreamingDelta,
  conversationTimestampLabel,
  displayText,
  elapsedActivityLabel,
  formatRunDuration,
  localDayKey,
  messagePresentation,
  messageText,
  messageTimestamp,
  parseSubagentNotice,
  resetStreamingState,
  restoredPrompt,
} from "../browser/public/message-view.js";
import { formatPromptWithReferences } from "../browser/public/reference-contract.js";

test("final assistant presentation replaces a provisional thinking role and header", () => {
  const provisional = messagePresentation({ role: "thinking" });
  const authoritative = messagePresentation({ role: "assistant", stopReason: "stop" }, provisional.role);

  assert.equal(provisional.header, "thinking");
  assert.deepEqual(authoritative, { role: "assistant", header: "assistant", error: false });
});

test("authoritative assistant content supersedes accumulated streaming fragments", () => {
  const parts = new Map();
  applyStreamingDelta(parts, { type: "thinking_start", contentIndex: 0 });
  applyStreamingDelta(parts, { type: "thinking_delta", contentIndex: 0, delta: "draft" });
  applyStreamingDelta(parts, { type: "text_start", contentIndex: 1 });
  const streamed = applyStreamingDelta(parts, { type: "text_delta", contentIndex: 1, delta: "partial" });
  const authoritative = messageText({ role: "assistant", content: [{ type: "text", text: "Final answer" }] });

  assert.equal(streamed, "draft\npartial");
  assert.equal(authoritative, "Final answer");
  assert.equal(authoritative.includes(streamed), false);
});

test("replacing a transcript clears detached streaming state", () => {
  const viewState = { liveMessage: { article: "detached" }, liveParts: new Map([[0, "partial"]]) };

  resetStreamingState(viewState);

  assert.equal(viewState.liveMessage, null);
  assert.equal(viewState.liveParts.size, 0);
});

test("failed prompt restoration preserves text entered while the request was pending", () => {
  assert.equal(restoredPrompt("Original prompt", "New draft"), "Original prompt\nNew draft");
  assert.equal(restoredPrompt("Original prompt", ""), "Original prompt");
});

test("text references render bounded labels instead of full attached contents", () => {
  const framed = formatPromptWithReferences("Review this", [{
    type: "text",
    name: "notes.md",
    mimeType: "text/markdown",
    text: "private reference body",
  }]);

  const visible = messageText({ role: "user", content: [{ type: "text", text: framed }] });
  assert.equal(visible, "Review this\n[Text reference: notes.md — 1 KB]");
  assert.equal(visible.includes("private reference body"), false);
});

test("browser message text strips terminal controls before display or copy", () => {
  assert.equal(displayText("\u001b[31mred\u001b[0m\u0007"), "red");
  assert.equal(messageText({ role: "bashExecution", output: "\u001b[32mok\u001b[0m" }), "ok");
});

test("conversation dates and elapsed work labels remain compact and local", () => {
  const timestamp = messageTimestamp({ timestamp: "2026-09-01T10:05:00.000Z" });
  assert.equal(timestamp.toISOString(), "2026-09-01T10:05:00.000Z");
  assert.equal(localDayKey(timestamp), `${timestamp.getFullYear()}-${timestamp.getMonth()}-${timestamp.getDate()}`);
  assert.match(conversationTimestampLabel(timestamp, "en-US"), /^Tuesday \d{1,2}:05 [AP]M$/);
  assert.equal(elapsedActivityLabel("2026-09-01T10:00:00.000Z", "2026-09-01T10:05:25.000Z"), "Worked for 5m 25s");
  assert.equal(formatRunDuration(14_999), "14s");
  assert.equal(formatRunDuration(65_900), "1m 05s");
  assert.equal(formatRunDuration(-1), "0s");
  assert.equal(messageTimestamp({ timestamp: "invalid" }), null);
  assert.equal(localDayKey(null), null);
});

test("sub-agent parent updates retain useful fields and omit operational noise", () => {
  const notice = parseSubagentNotice([
    "Sub-agent sa_review (Review chat) asks parent.",
    "Depth: 1",
    "Reason: risk_detected",
    "Blocking: no",
    "Type: course-changing update",
    "Message: The chat needs a clearer hierarchy.",
    "Recommendation: Group repeated activity.",
    "Last tool: ask_parent (unserializable args)",
    "Last child message: Parent notified.",
  ].join("\n"));

  assert.deepEqual(notice, {
    agentId: "sa_review",
    title: "Review chat",
    depth: "1",
    reason: "risk_detected",
    blocking: false,
    type: "course-changing update",
    message: "The chat needs a clearer hierarchy.",
    recommendation: "Group repeated activity.",
  });
});

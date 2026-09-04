import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUEUE_MODE,
  QUEUE_MODE_STORAGE_KEY,
  clearQueueBeforeAbort,
  normalizedQueue,
  queueMessageCount,
  readQueueMode,
  restoredQueueText,
  takeClearedQueueRecords,
  writeQueueMode,
} from "../browser/public/queue-client.js";
import {
  formatPromptWithReferences,
  inlineReferencePrompt,
  unpackReferenceQueue,
} from "../browser/public/reference-contract.js";

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => initial.get(key) ?? null,
    setItem: (key, value) => initial.set(key, value),
  };
}

test("queue mode defaults, validates, and persists", () => {
  const storage = memoryStorage();
  assert.equal(readQueueMode(storage), DEFAULT_QUEUE_MODE);
  writeQueueMode(storage, "followUp");
  assert.equal(readQueueMode(storage), "followUp");
  assert.throws(() => writeQueueMode(storage, "all"), /Invalid queue mode/);
  assert.equal(readQueueMode(memoryStorage(new Map([[QUEUE_MODE_STORAGE_KEY, "invalid"]]))), DEFAULT_QUEUE_MODE);
});

test("queue normalization counts only Pi text queues", () => {
  const queue = normalizedQueue({ steering: ["one", 2], followUp: ["two"], sessionPath: "private" });
  assert.deepEqual(queue, { steering: ["one"], followUp: ["two"] });
  assert.equal(queueMessageCount(queue), 2);
});

test("cleared queue text is restored before an existing draft", () => {
  const queue = { steering: ["Change direction"], followUp: ["Then summarize"] };
  assert.equal(restoredQueueText(queue, "Unsent draft"),
    "Change direction\n\nThen summarize\n\nUnsent draft");
  assert.equal(restoredQueueText({}, "Unsent draft"), "Unsent draft");
});

test("cleared queue records remove the newest matching optimistic rows", () => {
  const records = [
    { kind: "followUp", message: "same", id: "already delivered" },
    { kind: "steering", message: "other", id: "keep" },
    { kind: "followUp", message: "same", id: "still queued" },
  ];
  const result = takeClearedQueueRecords(records, { steering: [], followUp: ["same"] });
  assert.deepEqual(result.removed.map((record) => record.id), ["still queued"]);
  assert.deepEqual(result.remaining.map((record) => record.id), ["already delivered", "keep"]);
});

test("cleared text references recover original prompts and attachment content", () => {
  const reference = { type: "text", name: "notes.txt", mimeType: "text/plain", text: "reference body" };
  const framed = formatPromptWithReferences("Queued prompt", [reference]);
  const unpacked = unpackReferenceQueue({ steering: [framed], followUp: ["plain"] });

  assert.deepEqual(unpacked, {
    messages: { steering: ["Queued prompt"], followUp: ["plain"] },
    references: [reference],
  });
  assert.equal(inlineReferencePrompt(framed), "Queued prompt\n\n[Text reference: notes.txt]\nreference body");
});

test("abort clears and restores queued messages before stopping Pi", async () => {
  const calls = [];
  const restored = [];
  const queue = await clearQueueBeforeAbort(async (command) => {
    calls.push(command.type);
    if (command.type === "clear_queue") return { data: { steering: ["queued"], followUp: [] } };
    return { success: true };
  }, (value) => restored.push(value));

  assert.deepEqual(calls, ["clear_queue", "abort"]);
  assert.deepEqual(restored, [{ steering: ["queued"], followUp: [] }]);
  assert.deepEqual(queue, restored[0]);
});

test("abort is not sent when clearing the queue fails", async () => {
  const calls = [];
  await assert.rejects(clearQueueBeforeAbort(async (command) => {
    calls.push(command.type);
    throw new Error("clear failed");
  }, () => assert.fail("queue must not be restored after a failed clear")), /clear failed/);
  assert.deepEqual(calls, ["clear_queue"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTodoItems,
  getTodoCounts,
  MAX_TODO_EVIDENCE_CHARS,
  normalizeTodoItems,
  todoStatusSymbol,
  transitionTodoItems,
} from "../extensions/plan-mode/utils.ts";

test("plan steps require an explicit start before evidence-backed completion", () => {
  const pendingItems = extractTodoItems("Plan:\n1. Verify the explicit progress flow");

  assert.equal(pendingItems[0]?.status, "pending");
  assert.throws(
    () => transitionTodoItems(pendingItems, 1, "completed", "Observed the expected output"),
    /cannot transition from pending to completed/,
  );

  const runningItems = transitionTodoItems(pendingItems, 1, "running");
  assert.equal(runningItems[0]?.status, "running");
  assert.equal(pendingItems[0]?.status, "pending");
  assert.throws(() => transitionTodoItems(runningItems, 1, "completed"), /require concise evidence/);
  assert.throws(
    () => transitionTodoItems(runningItems, 1, "completed", "x".repeat(MAX_TODO_EVIDENCE_CHARS + 1)),
    /characters or fewer/,
  );

  const completedItems = transitionTodoItems(runningItems, 1, "completed", "  Targeted test\npassed  ");
  assert.deepEqual(completedItems[0], {
    step: 1,
    text: "Explicit progress flow",
    status: "completed",
    evidence: "Targeted test passed",
  });
});

test("failed plan steps can retry while completed steps remain terminal", () => {
  const pendingItems = [{ step: 1, text: "Run validation", status: "pending" }];
  const runningItems = transitionTodoItems(pendingItems, 1, "running");
  const failedItems = transitionTodoItems(runningItems, 1, "failed");

  assert.equal(failedItems[0]?.status, "failed");
  assert.throws(
    () => transitionTodoItems(failedItems, 1, "completed", "Validation passed"),
    /cannot transition from failed to completed/,
  );

  const retriedItems = transitionTodoItems(failedItems, 1, "running");
  const completedItems = transitionTodoItems(retriedItems, 1, "completed", "Validation passed");
  assert.throws(
    () => transitionTodoItems(completedItems, 1, "failed"),
    /cannot transition from completed to failed/,
  );
});

test("persisted legacy and explicit task states normalize on resume", () => {
  const normalizedItems = normalizeTodoItems([
    { step: 8, text: " Legacy completed ", completed: true },
    { step: 9, text: "Legacy pending", completed: false },
    { step: 10, text: "Explicit running", status: "running" },
    { step: 11, text: "Explicit completed", status: "completed", evidence: " test\npassed " },
    null,
    { text: "   ", status: "failed" },
  ]);

  assert.deepEqual(normalizedItems, [
    { step: 1, text: "Legacy completed", status: "completed" },
    { step: 2, text: "Legacy pending", status: "pending" },
    { step: 3, text: "Explicit running", status: "running" },
    { step: 4, text: "Explicit completed", status: "completed", evidence: "test passed" },
  ]);
  assert.deepEqual(normalizeTodoItems(undefined), []);
});

test("progress counts and symbols reflect every explicit task state", () => {
  const items = [
    { step: 1, text: "Queued", status: "pending" },
    { step: 2, text: "Active", status: "running" },
    { step: 3, text: "Done one", status: "completed", evidence: "Checked" },
    { step: 4, text: "Done two", status: "completed", evidence: "Checked" },
    { step: 5, text: "Blocked", status: "failed" },
  ];

  assert.deepEqual(getTodoCounts(items), {
    total: 5,
    pending: 1,
    running: 1,
    completed: 2,
    failed: 1,
  });
  assert.deepEqual(items.map((item) => todoStatusSymbol(item.status)), ["○", "◉", "✓", "✓", "✕"]);
});

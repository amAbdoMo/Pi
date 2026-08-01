import assert from "node:assert/strict";
import test from "node:test";
import { boundDelegateDetails } from "../extensions/subagents/runtime/detail-bounds.ts";

test("delegate details remain bounded without raw args or nested child payloads", () => {
  const details = boundDelegateDetails(
    {
      id: "child-1",
      label: "review",
      status: "completed",
      contextMode: "compact",
      depth: 1,
      maxDepth: 1,
      task: "task ".repeat(10_000),
      model: `custom/${"model-".repeat(2_000)}`,
      sessionDir: `C:/${"deep/".repeat(1_000)}`,
      error: "stderr ".repeat(10_000),
      finalOutput: "raw-output ".repeat(10_000),
      events: Array.from({ length: 40 }, (_, index) => ({
        type: "tool_execution_end",
        timestamp: index,
        text: "summary ".repeat(1_000),
        toolName: "read",
        toolCallId: `tool-${index}`,
        args: { secret: "do-not-retain".repeat(1_000) },
        delegateDetails: { finalOutput: "nested-raw".repeat(1_000) },
      })),
    },
    1_000,
  );

  const serialized = JSON.stringify(details);
  assert.ok(Buffer.byteLength(serialized, "utf8") <= 1_000);
  assert.doesNotMatch(serialized, /do-not-retain|nested-raw/);
});

test("minimal details fallback remains byte-bounded for wide Unicode fields", () => {
  const wide = "界".repeat(10_000);
  const details = boundDelegateDetails(
    {
      id: wide,
      label: wide,
      status: "failed",
      contextMode: "compact",
      depth: 1,
      maxDepth: 1,
      task: wide,
      model: wide,
      error: wide,
      finalOutput: wide,
      events: [],
    },
    1_000,
  );

  assert.ok(Buffer.byteLength(JSON.stringify(details), "utf8") <= 1_000);
  assert.doesNotMatch(JSON.stringify(details), /�/);
});

test("detail truncation preserves complete emoji code points", () => {
  const emoji = "😀".repeat(10_000);
  const details = boundDelegateDetails(
    {
      id: emoji,
      label: emoji,
      status: "failed",
      contextMode: "compact",
      depth: 1,
      maxDepth: 1,
      task: emoji,
      error: emoji,
      events: [],
    },
    1_000,
  );

  for (const text of [details.id, details.label, details.task, details.error]) {
    for (const character of text ?? "") {
      const codePoint = character.codePointAt(0);
      assert.ok(codePoint < 0xd800 || codePoint > 0xdfff);
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(details), "utf8") <= 1_000);
});

test("details budget accounts for JSON escaping of control characters", () => {
  const escaped = "\u0000".repeat(10_000);
  const details = boundDelegateDetails(
    {
      id: escaped,
      label: escaped,
      status: "failed",
      contextMode: "compact",
      depth: 1,
      maxDepth: 1,
      task: escaped,
      model: escaped,
      error: escaped,
      finalOutput: escaped,
      events: [],
    },
    1_000,
  );

  assert.ok(Buffer.byteLength(JSON.stringify(details), "utf8") <= 1_000);
});

test("limit-failure-sized task text is reduced to the configured details budget", () => {
  const details = boundDelegateDetails(
    {
      id: "",
      label: "concurrency",
      status: "failed",
      contextMode: "fresh",
      depth: 0,
      maxDepth: 1,
      task: "oversized ".repeat(50_000),
      error: "maxConcurrent 3 reached",
      events: [],
    },
    1_000,
  );

  assert.ok(Buffer.byteLength(JSON.stringify(details), "utf8") <= 1_000);
  assert.match(details.error, /maxConcurrent/);
});

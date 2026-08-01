import assert from "node:assert/strict";
import test from "node:test";
import { delegateLimitIssue } from "../extensions/subagents/runtime/limits.ts";

const defaults = {
  allowChildSubagents: true,
  currentDepth: 0,
  maxDepth: 1,
  activeCount: 0,
  maxConcurrent: 3,
};

test("default limits allow a small parent-owned fan-out", () => {
  assert.equal(delegateLimitIssue(defaults), undefined);
  assert.equal(
    delegateLimitIssue({ ...defaults, activeCount: 2 }),
    undefined,
  );
});

test("default limits stop a fourth concurrent child", () => {
  assert.deepEqual(delegateLimitIssue({ ...defaults, activeCount: 3 }), {
    kind: "concurrency",
    message: "maxConcurrent 3 reached with 3 active children",
  });
});

test("default depth prevents recursive delegation while remaining configurable", () => {
  assert.deepEqual(
    delegateLimitIssue({ ...defaults, currentDepth: 1 }),
    {
      kind: "depth",
      message: "maxDepth 1 reached at depth 1",
    },
  );
  assert.equal(
    delegateLimitIssue({ ...defaults, currentDepth: 1, maxDepth: 2 }),
    undefined,
  );
});

test("delegation can be disabled explicitly", () => {
  assert.deepEqual(
    delegateLimitIssue({ ...defaults, allowChildSubagents: false }),
    {
      kind: "disabled",
      message: "sub-agent delegation is disabled by settings",
    },
  );
});

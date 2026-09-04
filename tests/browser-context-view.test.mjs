import assert from "node:assert/strict";
import test from "node:test";

import {
  formatContextPercent,
  formatSessionCost,
  formatTokenCount,
  normalizeContextUsage,
  normalizeSessionStats,
} from "../browser/public/context-view.js";

test("context usage accepts only finite non-negative numeric fields", () => {
  assert.deepEqual(normalizeContextUsage({ tokens: 50_000, contextWindow: 200_000, percent: 25 }),
    { tokens: 50_000, contextWindow: 200_000, percent: 25 });
  assert.equal(normalizeContextUsage({ tokens: null, contextWindow: 200_000, percent: 0 }), null);
  assert.equal(normalizeContextUsage({ tokens: 1, contextWindow: 2, percent: Number.POSITIVE_INFINITY }), null);
});

test("session stats discard private and unsupported fields", () => {
  assert.deepEqual(normalizeSessionStats({
    sessionFile: "R:/Private/session.jsonl",
    sessionId: "private-id",
    totalMessages: 4,
    cost: 0.125,
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
  }), {
    totalMessages: 4,
    cost: 0.125,
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
  });
});

test("context labels stay compact and bounded", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_500), "1.5K");
  assert.equal(formatTokenCount(50_000), "50K");
  assert.equal(formatTokenCount(2_500_000), "2.5M");
  assert.equal(formatContextPercent(31.6), "Context 32%");
  assert.equal(formatContextPercent(140), "Context 100%");
  assert.equal(formatSessionCost(0), "<$0.01");
  assert.equal(formatSessionCost(1.236), "$1.24");
});

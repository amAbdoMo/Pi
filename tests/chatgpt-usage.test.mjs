import assert from "node:assert/strict";
import test from "node:test";
import { extractChatGptUsage } from "../extensions/ui/usageWindows.ts";

test("Codex usage windows are identified by duration rather than response position", () => {
  const cases = [
    {
      payload: {
        rate_limit: {
          primary_window: { used_percent: 16, limit_window_seconds: 604800 },
          secondary_window: { used_percent: 42, limit_window_seconds: 18000 },
        },
      },
      expected: { fiveHourUsedPercent: 42, weeklyUsedPercent: 16 },
    },
    {
      payload: {
        rate_limit: {
          primary_window: { used_percent: 9, limit_window_seconds: 18060 },
          secondary_window: null,
        },
      },
      expected: { fiveHourUsedPercent: 9, weeklyUsedPercent: undefined },
    },
    {
      payload: {
        rate_limit: {
          primary_window: { used_percent: "invalid", limit_window_seconds: 604800 },
          secondary_window: { used_percent: 3, limit_window_seconds: 0 },
        },
      },
      expected: { fiveHourUsedPercent: undefined, weeklyUsedPercent: undefined },
    },
  ];

  for (const { payload, expected } of cases) {
    assert.deepEqual(extractChatGptUsage(payload), expected);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { extractChatGptUsage } from "../extensions/ui/usageWindows.ts";
import {
  createUsageRefreshPoller,
  SUBAGENT_USAGE_REFRESH_INTERVAL_MS,
} from "../extensions/ui/usagePolling.ts";

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

test("Codex usage refreshes while sub-agents run and once after they settle", () => {
  const intervals = new Map();
  const cleared = [];
  let nextHandle = 0;
  let refreshes = 0;
  const scheduler = {
    setInterval(callback, intervalMs) {
      const handle = ++nextHandle;
      intervals.set(handle, { callback, intervalMs });
      return handle;
    },
    clearInterval(handle) {
      cleared.push(handle);
      intervals.delete(handle);
    },
  };
  const poller = createUsageRefreshPoller(async () => {
    refreshes++;
  }, scheduler);

  poller.setActive(true);
  assert.equal(refreshes, 1, "activation should refresh immediately");
  assert.equal(intervals.get(1)?.intervalMs, SUBAGENT_USAGE_REFRESH_INTERVAL_MS);

  poller.setActive(true);
  assert.equal(refreshes, 1, "repeated activity updates should not restart polling");
  intervals.get(1).callback();
  assert.equal(refreshes, 2, "active sub-agents should trigger periodic refreshes");

  poller.setActive(false);
  assert.equal(refreshes, 3, "settling should force a final refresh");
  assert.deepEqual(cleared, [1]);

  poller.setActive(false);
  assert.equal(refreshes, 3, "repeated idle updates should do nothing");
  poller.setActive(true);
  assert.equal(refreshes, 4);
  poller.dispose();
  assert.deepEqual(cleared, [1, 2]);
  assert.equal(refreshes, 4, "disposing should not issue another request");
});

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { extractChatGptUsage } from "../extensions/ui/usageWindows.ts";
import {
  createUsageRefreshPoller,
  SUBAGENT_USAGE_REFRESH_INTERVAL_MS,
} from "../extensions/ui/usagePolling.ts";
import {
  beginWorkflowActivity,
  clearWorkflowActivity,
  hasActiveWorkflowActivity,
  setWorkflowActivityPhase,
  subscribeWorkflowActivity,
} from "../extensions/workflow/activity.ts";

afterEach(() => clearWorkflowActivity());

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

function createTestScheduler() {
  const intervals = new Map();
  const cleared = [];
  let nextHandle = 0;
  return {
    intervals,
    cleared,
    scheduler: {
      setInterval(callback, intervalMs) {
        const handle = ++nextHandle;
        intervals.set(handle, { callback, intervalMs });
        return handle;
      },
      clearInterval(handle) {
        cleared.push(handle);
        intervals.delete(handle);
      },
    },
  };
}

test("Codex usage refreshes while sub-agents run and once after they settle", () => {
  const { intervals, cleared, scheduler } = createTestScheduler();
  let refreshes = 0;
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

test("Codex usage refreshes for the whole active workflow lifecycle", () => {
  const { intervals, cleared, scheduler } = createTestScheduler();
  let refreshes = 0;
  const poller = createUsageRefreshPoller(async () => {
    refreshes++;
  }, scheduler);
  const syncWorkflowUsage = () => poller.setActive(hasActiveWorkflowActivity());
  const unsubscribe = subscribeWorkflowActivity(syncWorkflowUsage);

  try {
    syncWorkflowUsage();
    assert.equal(refreshes, 0);

    beginWorkflowActivity("run-usage", "pipeline");
    assert.equal(refreshes, 1, "workflow start should refresh immediately");
    assert.equal(intervals.get(1)?.intervalMs, SUBAGENT_USAGE_REFRESH_INTERVAL_MS);

    setWorkflowActivityPhase("run-usage", "verify");
    assert.equal(refreshes, 1, "phase updates should not restart active polling");
    intervals.get(1).callback();
    assert.equal(refreshes, 2, "active workflow should trigger periodic refreshes");

    clearWorkflowActivity("run-usage");
    assert.equal(refreshes, 3, "workflow settle should force a final refresh");
    assert.deepEqual(cleared, [1]);

    unsubscribe();
    beginWorkflowActivity("run-after-unsubscribe", "pipeline");
    assert.equal(refreshes, 3, "cleanup should remove workflow usage subscription");
  } finally {
    unsubscribe();
    poller.dispose();
  }
});

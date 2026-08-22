import assert from "node:assert/strict";
import test from "node:test";
import {
  agentTimeStatus,
  resetAgentTime,
  settleAgentTime,
  startAgentTime,
} from "../extensions/ui/agentTime.ts";
import {
  AGENT_TIME_ICON,
  AgentTimeTracker,
  formatElapsedDuration,
  workedLabel,
  workingLabel,
} from "../extensions/ui/agentTimeTracker.ts";

test("agent timer measures one continuous run through repeated starts", () => {
  const tracker = new AgentTimeTracker();

  assert.equal(tracker.start(1_000), true);
  assert.equal(tracker.start(5_000), false);
  assert.equal(tracker.elapsedMs(8_500), 7_500);
  assert.equal(tracker.settle(11_000), 10_000);
});

test("agent timer ignores settlement without an active run", () => {
  const tracker = new AgentTimeTracker();

  assert.equal(tracker.settle(1_000), null);
  tracker.start(1_000);
  assert.equal(tracker.settle(2_000), 1_000);
  assert.equal(tracker.settle(3_000), null);
});

test("agent timer reset discards an active run", () => {
  const tracker = new AgentTimeTracker();

  tracker.start(4_000);
  tracker.reset();
  assert.equal(tracker.elapsedMs(8_000), 0);
  assert.equal(tracker.settle(8_000), null);
});

test("agent timer clamps backwards elapsed values", () => {
  const tracker = new AgentTimeTracker();

  tracker.start(2_000);
  assert.equal(tracker.elapsedMs(1_000), 0);
  assert.equal(tracker.settle(1_000), 0);
});

test("UI timer adapter keeps one live run and one settled duration", (context) => {
  context.after(resetAgentTime);
  resetAgentTime();

  startAgentTime(1_000);
  startAgentTime(9_000);
  assert.deepEqual(agentTimeStatus, {
    label: `${AGENT_TIME_ICON} working 0s`,
    working: true,
  });
  assert.equal(settleAgentTime(11_000), 10_000);
  assert.deepEqual(agentTimeStatus, {
    label: `${AGENT_TIME_ICON} worked 10s`,
    working: false,
  });
  assert.equal(settleAgentTime(12_000), null);
});

test("agent duration labels stay concise across boundaries", () => {
  const cases = [
    [-1, "0s"],
    [999, "0s"],
    [42_999, "42s"],
    [60_000, "1m 00s"],
    [125_999, "2m 05s"],
    [3_599_999, "59m 59s"],
    [3_600_000, "1h 00m"],
    [11_220_000, "3h 07m"],
  ];

  for (const [elapsedMs, expected] of cases) {
    assert.equal(formatElapsedDuration(elapsedMs), expected);
  }
  assert.equal(workingLabel(42_000), `${AGENT_TIME_ICON} working 42s`);
  assert.equal(workedLabel(125_000), `${AGENT_TIME_ICON} worked 2m 05s`);
});

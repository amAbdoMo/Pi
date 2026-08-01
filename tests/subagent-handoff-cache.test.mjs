import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrCreateHandoffPromise,
  waitForHandoffSummary,
} from "../extensions/subagents/runtime/handoff-cache.ts";

test("parallel delegates reuse one compact handoff for the same parent context", async () => {
  let generated = 0;
  const create = async () => {
    generated++;
    return "compact handoff";
  };

  const first = getOrCreateHandoffPromise(undefined, "turn-1", create);
  const second = getOrCreateHandoffPromise(first.entry, "turn-1", create);

  assert.equal(await first.summary, "compact handoff");
  assert.equal(await second.summary, "compact handoff");
  assert.equal(generated, 1);
  assert.equal(first.summary, second.summary);
});

test("aborting one delegate does not cancel a shared handoff for siblings", async () => {
  let resolveSummary;
  const shared = new Promise((resolve) => {
    resolveSummary = resolve;
  });
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();
  const firstWaiter = waitForHandoffSummary(shared, firstAbort.signal);
  const secondWaiter = waitForHandoffSummary(shared, secondAbort.signal);

  firstAbort.abort();
  await assert.rejects(firstWaiter, /Sub-agent aborted/);
  resolveSummary("shared evidence");
  assert.equal(await secondWaiter, "shared evidence");
});

test("a changed parent context creates a fresh compact handoff", async () => {
  let generated = 0;
  const first = getOrCreateHandoffPromise(undefined, "turn-1", async () =>
    `summary-${++generated}`,
  );
  const second = getOrCreateHandoffPromise(first.entry, "turn-2", async () =>
    `summary-${++generated}`,
  );

  assert.equal(await first.summary, "summary-1");
  assert.equal(await second.summary, "summary-2");
  assert.equal(generated, 2);
});

import assert from "node:assert/strict";
import test from "node:test";
import { boundedChildError } from "../extensions/subagents/runtime/errors.ts";

test("child process failures cannot bypass the parent result byte budget with unbounded stderr", () => {
  const error = new Error(`launch failed\n${"sensitive-stderr ".repeat(2_000)}`);
  const message = boundedChildError(error);

  assert.ok(message.length <= 1_000);
  assert.match(message, /^launch failed sensitive-stderr/);
  assert.match(message, /…$/);
  assert.doesNotMatch(message, /\n/);
});

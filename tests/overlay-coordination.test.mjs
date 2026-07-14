import assert from "node:assert/strict";
import test from "node:test";

import {
  beginWorkbenchModal,
  isWorkbenchModalActive,
  subscribeWorkbenchModals,
  withWorkbenchModal,
} from "../extensions/ui/modalState.ts";

test("nested modal windows keep the workbench sidebar suspended until all close", () => {
  const observed = [];
  const unsubscribe = subscribeWorkbenchModals(() => {
    observed.push(isWorkbenchModalActive());
  });
  const closeOuter = beginWorkbenchModal();
  const closeInner = beginWorkbenchModal();

  closeOuter();
  assert.equal(isWorkbenchModalActive(), true);
  closeInner();
  closeInner();

  assert.equal(isWorkbenchModalActive(), false);
  assert.deepEqual(observed, [true, true, true, false]);
  unsubscribe();
});

test("modal suspension is released when an overlay operation fails", async () => {
  await assert.rejects(
    withWorkbenchModal(async () => {
      throw new Error("overlay failed");
    }),
    /overlay failed/,
  );

  assert.equal(isWorkbenchModalActive(), false);
});

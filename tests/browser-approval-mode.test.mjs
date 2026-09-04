import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_APPROVAL_MODE,
  readApprovalMode,
  writeApprovalMode,
} from "../browser/public/approval-mode.js";

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("approval mode defaults to Workspace Write and persists valid choices", () => {
  const storage = memoryStorage();
  assert.equal(readApprovalMode(storage), DEFAULT_APPROVAL_MODE);
  writeApprovalMode(storage, "read-only");
  assert.equal(readApprovalMode(storage), "read-only");
  assert.throws(() => writeApprovalMode(storage, "unlimited"), /Invalid approval mode/);
});

test("invalid or unavailable browser storage falls back to Workspace Write", () => {
  assert.equal(readApprovalMode(memoryStorage({ "pi-harness-approval-mode": "unlimited" })), DEFAULT_APPROVAL_MODE);
  assert.equal(readApprovalMode({ getItem() { throw new DOMException("blocked"); } }), DEFAULT_APPROVAL_MODE);
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExtensionUiRequest } from "../browser/public/extension-ui-contract.js";

const base = { type: "extension_ui_request", id: "request-1" };

test("all installed RPC dialog methods normalize to bounded public shapes", () => {
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "select", title: "Choose", options: ["One", "Two"], timeout: 1000 }),
    { ...base, method: "select", title: "Choose", options: ["One", "Two"], timeout: 1000 });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "confirm", title: "Allow?", message: "Review this" }),
    { ...base, method: "confirm", title: "Allow?", message: "Review this" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "input", title: "Name", placeholder: "Type" }),
    { ...base, method: "input", title: "Name", placeholder: "Type" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "editor", title: "Edit", prefill: "Line 1\nLine 2" }),
    { ...base, method: "editor", title: "Edit", prefill: "Line 1\nLine 2" });
});

test("fire-and-forget extension UI methods retain only validated fields", () => {
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "notify", message: "Done", notifyType: "warning" }),
    { ...base, method: "notify", message: "Done", notifyType: "warning" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "setStatus", statusKey: "build", statusText: "Running" }),
    { ...base, method: "setStatus", statusKey: "build", statusText: "Running" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "setWidget", widgetKey: "plan", widgetLines: ["Step 1"], widgetPlacement: "belowEditor" }),
    { ...base, method: "setWidget", widgetKey: "plan", widgetLines: ["Step 1"], widgetPlacement: "belowEditor" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "setTitle", title: "Pi work" }),
    { ...base, method: "setTitle", title: "Pi work" });
  assert.deepEqual(normalizeExtensionUiRequest({ ...base, method: "set_editor_text", text: "draft" }),
    { ...base, method: "set_editor_text", text: "draft" });
});

test("extension requests reject unknown fields, methods, and oversized values", () => {
  assert.throws(() => normalizeExtensionUiRequest({ ...base, method: "select", title: "Choose", options: [], secret: "private" }), /unsupported fields/);
  assert.throws(() => normalizeExtensionUiRequest({ ...base, method: "select", title: "Choose", options: [] }), /options/);
  assert.throws(() => normalizeExtensionUiRequest({ ...base, method: "custom", title: "Unsafe" }), /unsupported/);
  assert.throws(() => normalizeExtensionUiRequest({ ...base, method: "notify", message: "x".repeat(2049) }), /message/);
  assert.throws(() => normalizeExtensionUiRequest({ ...base, method: "setWidget", widgetKey: "plan", widgetLines: Array(51).fill("x") }), /Widget lines/);
});

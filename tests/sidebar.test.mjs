import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTokenCount,
  sidebarColumnWidth,
  sidebarGutterWidth,
  sidebarOverlayOptions,
  sidebarPanelContentWidth,
  sidebarPresentation,
} from "../extensions/ui/workbenchSidebarLayout.ts";
import {
  getPlanProgress,
  publishPlanProgress,
} from "../extensions/plan-mode/progressState.ts";

test("wide terminals use a non-capturing right rail", () => {
  assert.equal(sidebarPresentation(117), "overlay");
  assert.equal(sidebarPresentation(118), "rail");
  assert.equal(sidebarGutterWidth(160), 1);
  assert.equal(sidebarColumnWidth(160), 38);
  assert.equal(sidebarColumnWidth(240), 46);
  assert.deepEqual(sidebarOverlayOptions(160), {
    anchor: "top-right",
    width: sidebarColumnWidth(160),
    maxHeight: "100%",
    margin: 0,
    nonCapturing: true,
  });
});

test("sidebar body width matches the framed panel content area", () => {
  assert.equal(sidebarPanelContentWidth(40), 34);
  assert.equal(sidebarPanelContentWidth(4), 2);
});

test("context window sizes use compact token labels", () => {
  assert.equal(compactTokenCount(0), "0");
  assert.equal(compactTokenCount(272_000), "272k");
  assert.equal(compactTokenCount(1_250_000), "1.3m");
});

test("narrow terminals use a focused overlay layout", () => {
  assert.equal(sidebarGutterWidth(90), 0);
  assert.deepEqual(sidebarOverlayOptions(90), {
    anchor: "center",
    width: "90%",
    maxHeight: "86%",
    margin: 1,
    nonCapturing: false,
  });
});

test("sidebar plan snapshots are copied instead of exposing mutable state", () => {
  publishPlanProgress([
    { step: 1, text: "Verify the sidebar", status: "running" },
  ], true);

  const first = getPlanProgress();
  first.items[0].text = "changed by caller";

  assert.equal(getPlanProgress().items[0].text, "Verify the sidebar");
  publishPlanProgress([], false);
});

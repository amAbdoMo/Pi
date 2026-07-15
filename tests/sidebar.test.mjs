import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTokenCount,
  sidebarColumnWidth,
  sidebarGutterWidth,
  sidebarMcpStateLabel,
  sidebarOverlayOptions,
  sidebarPanelContentWidth,
  sidebarPresentation,
  sidebarSectionContentWidth,
  sidebarTitleRule,
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

test("sidebar body and section widths match their framed content areas", () => {
  assert.equal(sidebarPanelContentWidth(40), 34);
  assert.equal(sidebarPanelContentWidth(4), 2);
  assert.equal(sidebarSectionContentWidth(34), 30);
  assert.equal(sidebarSectionContentWidth(3), 3);
});

test("sidebar titles stay connected to complete box borders", () => {
  const sectionRule = sidebarTitleRule(20, "SESSION");
  assert.deepEqual(sectionRule, {
    left: "┌─",
    title: " SESSION ",
    right: "────────┐",
  });
  assert.equal(sectionRule.left.length + sectionRule.title.length + sectionRule.right.length, 20);

  const workspaceRule = sidebarTitleRule(20, "Pi workspace");
  assert.deepEqual(workspaceRule, {
    left: "┌─",
    title: " Pi workspace ",
    right: "───┐",
  });
  assert.equal(workspaceRule.left.length + workspaceRule.title.length + workspaceRule.right.length, 20);
});

test("context window sizes use compact token labels", () => {
  assert.equal(compactTokenCount(0), "0");
  assert.equal(compactTokenCount(272_000), "272k");
  assert.equal(compactTokenCount(1_250_000), "1.3m");
});

test("MCP sidebar states use clear user-facing labels", () => {
  const cases = [
    ["connected", "Connected"],
    ["connecting", "Connecting"],
    ["disconnected", "Disconnected"],
    ["disabled", "Disabled"],
    ["error", "Error"],
  ];
  for (const [state, label] of cases) {
    assert.equal(sidebarMcpStateLabel(state), label);
  }
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

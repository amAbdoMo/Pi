import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlanBuildMode,
  requestPlanBuildModeToggle,
  setPlanBuildMode,
  setPlanBuildModeToggleHandler,
  subscribePlanBuildMode,
} from "../extensions/plan-mode/modeState.ts";
import { highlightPasteMarkers } from "../extensions/ui/pasteMarkers.ts";

test("paste placeholders share the highlighted marker treatment", () => {
  const markers = [
    "[241 lines pasted #1]",
    "[Image 2]",
    "[paste #3 +22 lines]",
    "[paste #4 1200 chars]",
    "[Pasted ~9 lines]",
  ];
  const input = markers.join(" ");

  const highlighted = highlightPasteMarkers(input, (marker) => `<highlight>${marker}</highlight>`);

  for (const marker of markers) {
    assert.ok(highlighted.includes(`<highlight>${marker}</highlight>`));
  }
  assert.equal((highlighted.match(/<highlight>/g) ?? []).length, 5);
  assert.equal(highlightPasteMarkers("ordinary [text]", () => "changed"), "ordinary [text]");
});

test("plan/build mode state notifies subscribers and delegates toggle requests", () => {
  setPlanBuildMode("build");
  const observedModes = [];
  const unsubscribe = subscribePlanBuildMode((mode) => observedModes.push(mode));
  setPlanBuildModeToggleHandler(() => {
    setPlanBuildMode(getPlanBuildMode() === "build" ? "plan" : "build");
    return true;
  });

  try {
    assert.equal(requestPlanBuildModeToggle(), true);
    assert.equal(getPlanBuildMode(), "plan");
    assert.deepEqual(observedModes, ["plan"]);

    assert.equal(requestPlanBuildModeToggle(), true);
    assert.equal(getPlanBuildMode(), "build");
    assert.deepEqual(observedModes, ["plan", "build"]);
  } finally {
    unsubscribe();
    setPlanBuildModeToggleHandler(undefined);
    setPlanBuildMode("build");
  }

  assert.equal(requestPlanBuildModeToggle(), false);
});

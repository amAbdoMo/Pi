import assert from "node:assert/strict";
import test from "node:test";
import {
  publishPlanBuildMode,
  requestPlanBuildModeToggle,
  subscribePlanBuildModeChanges,
  subscribePlanBuildModeToggleRequests,
} from "../extensions/plan-mode/modeEvents.ts";
import {
  getPlanBuildMode,
  setPlanBuildMode,
  subscribePlanBuildMode,
} from "../extensions/plan-mode/modeState.ts";
import { highlightPasteMarkers } from "../extensions/ui/pasteMarkers.ts";
import { isEmptyBracketedPaste } from "../extensions/ui/terminalCompatibility.ts";

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

test("Warp image-only paste signal is distinguished from normal text paste", () => {
  assert.equal(isEmptyBracketedPaste("\x1b[200~\x1b[201~"), true);
  assert.equal(isEmptyBracketedPaste("\x1b[200~pasted text\x1b[201~"), false);
  assert.equal(isEmptyBracketedPaste("\x16"), false);
});

function createEventBus() {
  const listeners = new Map();
  return {
    emit(channel, payload) {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
    on(channel, listener) {
      const channelListeners = listeners.get(channel) ?? new Set();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
      return () => channelListeners.delete(listener);
    },
  };
}

test("shared events carry Tab toggle requests from the UI to plan mode", () => {
  const events = createEventBus();
  const observedModes = [];
  setPlanBuildMode("build");

  const unsubscribeState = subscribePlanBuildMode((mode) => observedModes.push(mode));
  const unsubscribeChanges = subscribePlanBuildModeChanges(events, setPlanBuildMode);
  const unsubscribeToggle = subscribePlanBuildModeToggleRequests(events, () => {
    const nextMode = getPlanBuildMode() === "build" ? "plan" : "build";
    publishPlanBuildMode(events, nextMode);
  });

  try {
    requestPlanBuildModeToggle(events);
    assert.equal(getPlanBuildMode(), "plan");
    assert.deepEqual(observedModes, ["plan"]);

    requestPlanBuildModeToggle(events);
    assert.equal(getPlanBuildMode(), "build");
    assert.deepEqual(observedModes, ["plan", "build"]);
  } finally {
    unsubscribeToggle();
    unsubscribeChanges();
    unsubscribeState();
    setPlanBuildMode("build");
  }
});

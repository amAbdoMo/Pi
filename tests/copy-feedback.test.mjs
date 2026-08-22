import assert from "node:assert/strict";
import test from "node:test";
import {
  COPY_FEEDBACK_VISIBLE_MS,
  TransientFeedback,
  clearCopyFeedbackTheme,
  copyFeedbackState,
  renderCopyBadgeLine,
  setCopyFeedbackTheme,
} from "../extensions/ui/copyFeedback.ts";

const badgeTheme = {
  bold: (text) => `<bold>${text}`,
  getFgAnsi: (color) => `\x1b[38;2;101;209;122m<${color}>`,
};

test("copy badge renders a background-highlighted chip only while visible", () => {
  clearCopyFeedbackTheme();
  assert.equal(renderCopyBadgeLine(), undefined);

  setCopyFeedbackTheme(badgeTheme);
  assert.equal(renderCopyBadgeLine(), undefined);

  copyFeedbackState.visible = true;
  const [line] = [renderCopyBadgeLine()];
  assert.ok(line);
  assert.ok(line.startsWith("\x1b[48;2;101;209;122m<success>"));
  assert.ok(line.includes("<bold> ✓ Copied "));
  assert.ok(line.endsWith("\x1b[39m\x1b[49m"));

  copyFeedbackState.visible = false;
  assert.equal(renderCopyBadgeLine(), undefined);
});

test("clearing the copy theme hides any visible badge", () => {
  setCopyFeedbackTheme(badgeTheme);
  copyFeedbackState.visible = true;
  assert.ok(renderCopyBadgeLine());

  clearCopyFeedbackTheme();
  assert.equal(copyFeedbackState.visible, false);
  assert.equal(renderCopyBadgeLine(), undefined);
});

test("copy confirmation shows immediately and hides once after its lifetime", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  const feedback = new TransientFeedback(
    () => events.push("show"),
    () => events.push("hide"),
  );

  feedback.trigger();
  assert.deepEqual(events, ["show"]);

  t.mock.timers.tick(COPY_FEEDBACK_VISIBLE_MS - 1);
  assert.deepEqual(events, ["show"]);

  t.mock.timers.tick(1);
  assert.deepEqual(events, ["show", "hide"]);
});

test("retriggering the copy confirmation restarts the lifetime", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  const feedback = new TransientFeedback(
    () => events.push("show"),
    () => events.push("hide"),
  );

  feedback.trigger();
  t.mock.timers.tick(COPY_FEEDBACK_VISIBLE_MS - 1);
  feedback.trigger();
  assert.deepEqual(events, ["show", "show"]);

  t.mock.timers.tick(COPY_FEEDBACK_VISIBLE_MS - 1);
  assert.deepEqual(events, ["show", "show"]);

  t.mock.timers.tick(1);
  assert.deepEqual(events, ["show", "show", "hide"]);
});

test("disposing the copy confirmation cancels the pending hide and hides now", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  const feedback = new TransientFeedback(
    () => events.push("show"),
    () => events.push("hide"),
  );

  feedback.trigger();
  feedback.dispose();
  assert.deepEqual(events, ["show", "hide"]);

  t.mock.timers.tick(COPY_FEEDBACK_VISIBLE_MS * 2);
  assert.deepEqual(events, ["show", "hide"]);
});

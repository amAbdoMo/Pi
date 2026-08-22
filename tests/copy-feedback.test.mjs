import assert from "node:assert/strict";
import test from "node:test";
import {
  COPY_FEEDBACK_VISIBLE_MS,
  CopyFeedbackWidget,
  TransientFeedback,
} from "../extensions/ui/copyFeedback.ts";

test("copy confirmation renders one background-highlighted success badge", () => {
  const widget = new CopyFeedbackWidget({
    bold: (text) => `<bold>${text}`,
    fg: (color, text) => `<${color}>${text}`,
    getFgAnsi: (color) => `\x1b[38;2;101;209;122m<${color}>`,
  });

  const [line] = widget.render();
  assert.ok(line.startsWith("\x1b[48;2;101;209;122m<success>"));
  assert.ok(line.includes("<bold> ✓ Copied "));
  assert.ok(line.endsWith("\x1b[39m\x1b[49m"));
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

import assert from "node:assert/strict";
import test from "node:test";

import { PlanTodoWidget, todoBubbleWidth } from "../extensions/plan-mode/todoWidget.ts";

const colorCodes = {
  accent: 35,
  success: 32,
  error: 31,
  muted: 2,
  dim: 2,
  customMessageLabel: 33,
  customMessageText: 37,
};

const theme = {
  fg: (color, text) => `\x1b[${colorCodes[color]}m${text}\x1b[0m`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  strikethrough: (text) => `\x1b[9m${text}\x1b[0m`,
};

function stripFormatting(text) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\[[^\]]+\]/g, "");
}

test("plan todo widget renders compact custom-message background and status colors", () => {
  const widget = new PlanTodoWidget([
    { step: 1, text: "Queue work", status: "pending" },
    { step: 2, text: "Run focused validation", status: "running" },
    { step: 3, text: "Ship verified behavior", status: "completed" },
    { step: 4, text: "Investigate blocker", status: "failed" },
  ], theme);
  const lines = widget.render(80);

  widget.invalidate();
  assert.ok(lines.length >= 5);
  assert.ok(lines.every((line) => line.startsWith("[customMessageBg]") && line.endsWith("[/customMessageBg]")));
  assert.match(stripFormatting(lines[0]), /Plan tasks · running 2/);
  assert.match(lines.join("\n"), /\x1b\[2m○\x1b\[0m/);
  assert.match(lines.join("\n"), /\x1b\[35m◉\x1b\[0m/);
  assert.match(lines.join("\n"), /\x1b\[32m✓\x1b\[0m/);
  assert.match(lines.join("\n"), /\x1b\[31m✕\x1b\[0m/);
  assert.match(lines.join("\n"), /\x1b\[9mShip verified behavior\x1b\[0m/);
});

test("plan todo widget wraps safely and fits its grey surface to content", () => {
  const narrowLines = new PlanTodoWidget([
    { step: 1, text: "A very long task description that needs wrapping safely in narrow terminals", status: "running" },
  ], theme).render(28);
  assert.ok(narrowLines.length > 2);
  assert.ok(narrowLines.every((line) => stripFormatting(line).length <= 28));

  assert.equal(todoBubbleWidth(140, 21), 24);
  assert.equal(todoBubbleWidth(140, 100), 88);
  const wideLines = new PlanTodoWidget([
    { step: 1, text: "Short task", status: "pending" },
  ], theme).render(140);
  assert.ok(wideLines.every((line) => stripFormatting(line).length === 24));
});

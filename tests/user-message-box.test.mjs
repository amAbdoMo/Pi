import assert from "node:assert/strict";
import test from "node:test";

import {
  fitUserMessageWidth,
  MIN_USER_MESSAGE_WIDTH,
  trimUserMessageRightPadding,
} from "../extensions/pi-tool-display/src/user-message-box-layout.ts";

test("user message boxes fit short content and cap long content", () => {
  assert.equal(fitUserMessageWidth(120, 2, 1), MIN_USER_MESSAGE_WIDTH);
  assert.equal(fitUserMessageWidth(120, 40, 1), 44);
  assert.equal(fitUserMessageWidth(40, 100, 1), 40);
});

test("user message boxes ignore renderer right-padding when fitting short content", () => {
  const message = "please commit the changes if needed";
  const availableWidth = 120;
  const originalRendererLine = `${message}${" ".repeat(
    availableWidth - message.length - 4,
  )}`;
  const normalizedLine = trimUserMessageRightPadding(originalRendererLine);

  assert.equal(normalizedLine, message);
  assert.equal(
    fitUserMessageWidth(availableWidth, normalizedLine.length, 1),
    message.length + 4,
  );
});

test("user message boxes trim right-padding before trailing ANSI resets", () => {
  const message = "please commit the changes if needed";
  const normalizedLine = trimUserMessageRightPadding(
    `\x1b[1m${message}${" ".repeat(20)}\x1b[0m`,
  );

  assert.equal(normalizedLine, `\x1b[1m${message}\x1b[0m`);
});

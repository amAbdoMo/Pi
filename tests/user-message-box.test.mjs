import assert from "node:assert/strict";
import test from "node:test";

import {
  fitUserMessageWidth,
  MIN_USER_MESSAGE_WIDTH,
} from "../extensions/pi-tool-display/src/user-message-box-layout.ts";

test("user message boxes fit short content and cap long content", () => {
  assert.equal(fitUserMessageWidth(120, 2, 1), MIN_USER_MESSAGE_WIDTH);
  assert.equal(fitUserMessageWidth(120, 40, 1), 44);
  assert.equal(fitUserMessageWidth(40, 100, 1), 40);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  composerFrame,
  detectTextDirection,
  directionStatus,
} from "../extensions/ui/workbenchLayout.ts";
import { visualRtlText } from "../extensions/ui/rtlText.ts";

test("composer frame geometry stays within every supplied width", () => {
  for (const suppliedWidth of [0, 1, 2, 3, 4, 5, 12, 24, 40, 80, 120]) {
    const frame = composerFrame(suppliedWidth);
    const line = frame.framed
      ? `│ ${"x".repeat(frame.innerWidth)} │`
      : "x".repeat(frame.innerWidth);

    assert.ok(frame.innerWidth <= frame.width);
    assert.equal([...line].length, frame.width);
    assert.equal(frame.framed, frame.width >= 4);
  }
});

test("Arabic prose with embedded LTR code and paths reports RTL", () => {
  const input = "راجع الملف C:\\work\\src\\index.ts ثم شغّل `npm test` [241 lines pasted #1]";

  assert.equal(detectTextDirection(input), "rtl");
  assert.equal(directionStatus(input), "RTL · code/paths LTR");
});

test("LTR and paste-only input keep a stable LTR direction", () => {
  assert.equal(detectTextDirection("open ./src/index.ts and run npm test"), "ltr");
  assert.equal(detectTextDirection("[241 lines pasted #1]"), "ltr");
});

test("Arabic input is shaped and reordered for terminals without bidi support", () => {
  assert.equal(visualRtlText("السلام عليكم"), "ﻢﻜﻴﻠﻋ ﻡﻼﺴﻟﺍ");

  const mixed = visualRtlText("راجع C:\\work ثم شغل npm test");
  assert.ok(mixed.includes("C:\\work"));
  assert.ok(mixed.includes("npm test"));
});

test("RTL visualization preserves the hardware cursor marker", () => {
  const marker = "\x1b_pi:c\x07";
  const visual = visualRtlText(`السلام${marker}\x1b[7m \x1b[0m`, marker);

  assert.ok(visual.includes(marker));
  assert.ok(visual.includes("\x1b[7m \x1b[0m"));
});

test("composer and sidebar backgrounds are distinct from the chat canvas", () => {
  const themePath = new URL("../themes/hypr-waves.json", import.meta.url);
  const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

  assert.notEqual(theme.colors.userMessageBg, theme.vars.bg);
  assert.notEqual(theme.colors.customMessageBg, theme.vars.bg);
  assert.notEqual(theme.colors.userMessageBg, theme.colors.customMessageBg);
  assert.equal(theme.colors.success, "green");
  assert.match(theme.vars.green, /^#[0-9A-F]{6}$/i);
});

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

test("syntax comments use a readable teal accent distinct from neighboring tokens", () => {
  const themePath = new URL("../themes/hypr-waves.json", import.meta.url);
  const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

  assert.equal(theme.colors.syntaxComment, "commentTeal");
  assert.match(theme.vars.commentTeal, /^#[0-9A-F]{6}$/i);

  // WCAG contrast against the black chat canvas must stay comfortably readable.
  const hex = theme.vars.commentTeal;
  const channel = (offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const contrast = (luminance + 0.05) / 0.05;
  assert.ok(contrast >= 7, `comment contrast ${contrast.toFixed(2)} below 7:1`);

  assert.notEqual(
    theme.vars.commentTeal.toLowerCase(),
    theme.vars.cyanBright.toLowerCase(),
  );
  assert.notEqual(theme.colors.syntaxComment, "surface3");
});

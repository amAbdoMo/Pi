import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedViewport,
  parseWorkbenchMouseInput,
  renderChatScrollbar,
  workbenchDimensions,
  workbenchMainContentWidth,
  WORKBENCH_ENTER_SEQUENCE,
  WORKBENCH_LEAVE_SEQUENCE,
} from "../extensions/ui/workbenchShellLayout.ts";

test("wide workbench reserves a fixed sidebar while narrow terminals collapse it", () => {
  const wide = workbenchDimensions(160, 40, true);
  assert.equal(wide.showSidebar, true);
  assert.equal(wide.mainWidth + wide.sidebarWidth, 160);
  assert.equal(wide.height, 40);

  const narrow = workbenchDimensions(100, 30, true);
  assert.equal(narrow.showSidebar, false);
  assert.equal(narrow.mainWidth, 100);
  assert.equal(narrow.sidebarWidth, 0);
});

test("workbench terminal modes enable SGR wheel reporting and keep Shift+drag selection escape", () => {
  assert.match(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?1007l/);
  assert.match(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?1006h/);
  assert.match(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?1000h/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1000l/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1006l/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1007h/);
});

test("composer dock stays at the bottom when chat content is short", () => {
  assert.deepEqual(
    fixedViewport(["header", "message"], ["composer-1", "composer-2"], 6),
    ["header", "message", "", "", "composer-1", "composer-2"],
  );
});

test("chat viewport keeps recent lines and supports paging into older output", () => {
  const chat = ["1", "2", "3", "4", "5", "6"];
  const dock = ["composer"];

  assert.deepEqual(fixedViewport(chat, dock, 4), ["4", "5", "6", "composer"]);
  assert.deepEqual(fixedViewport(chat, dock, 4, 2), ["2", "3", "4", "composer"]);
});

function thumbRows(rows) {
  return rows.map((row, index) => row === "█" ? index : -1).filter((index) => index >= 0);
}

test("SGR mouse parser extracts modified wheel events and strips mouse sequences", () => {
  const up = "\x1b[<64;10;4M";
  const shiftedDown = "\x1b[<69;10;4M";
  const ctrlUp = "\x1b[<80;10;4M";
  const click = "\x1b[<0;10;4M";
  const parsed = parseWorkbenchMouseInput(`a${up}${shiftedDown}${ctrlUp}${click}z`);

  assert.equal(parsed.data, "az");
  assert.equal(parsed.wheelNotches, 1);
  assert.equal(parsed.mouseSequences, 4);
});

test("chat scrollbar places thumb at bottom, top, and clears dock rows", () => {
  const chat = Array.from({ length: 20 }, (_, index) => String(index + 1));
  const dock = ["composer-1", "composer-2"];
  const atBottom = renderChatScrollbar(chat, dock, 8, 0);
  const atTop = renderChatScrollbar(chat, dock, 8, 99);

  assert.deepEqual(atBottom.slice(-2), [" ", " "]);
  assert.deepEqual(atTop.slice(-2), [" ", " "]);
  assert.equal(Math.max(...thumbRows(atBottom)), 5);
  assert.equal(Math.min(...thumbRows(atTop)), 0);
});

test("main content width reserves one scrollbar column without breaking narrow terminals", () => {
  assert.equal(workbenchMainContentWidth(1), 1);
  assert.equal(workbenchMainContentWidth(2), 1);
  assert.equal(workbenchMainContentWidth(80), 79);
});

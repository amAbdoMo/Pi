import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalMouseInput } from "../extensions/ui/terminalCompatibility.ts";
import {
  fixedViewport,
  splitWorkbenchChildren,
  workbenchDimensions,
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

test("workbench terminal modes enable SGR wheel reporting and restore terminal modes", () => {
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

test("above-editor widgets scroll while status editor and footer stay docked", () => {
  const children = [
    "header",
    "resources",
    "chat",
    "pending",
    "status",
    "above-editor-widget",
    "editor",
    "below-editor-widget",
    "footer",
  ];

  assert.deepEqual(splitWorkbenchChildren(children), {
    scrollChildren: ["header", "resources", "chat", "pending", "above-editor-widget"],
    dockChildren: ["status", "editor", "below-editor-widget", "footer"],
  });
});

test("empty above-editor widget slot still scrolls instead of taking dock space", () => {
  const children = [
    "header",
    "resources",
    "chat",
    "pending",
    "status",
    "above-editor-empty-spacer",
    "editor",
    "below-editor-empty",
    "footer",
  ];
  const groups = splitWorkbenchChildren(children);

  assert.deepEqual(groups.scrollChildren.slice(-1), ["above-editor-empty-spacer"]);
  assert.deepEqual(groups.dockChildren, ["status", "editor", "below-editor-empty", "footer"]);
});

test("terminal mouse parser extracts repeated modified wheel events and keeps mixed input", () => {
  const up = "\x1b[<64;10;4M";
  const shiftedDown = "\x1b[<69;10;4M";
  const ctrlUp = "\x1b[<80;10;4M";
  const click = "\x1b[<0;10;4M";
  const parsed = parseTerminalMouseInput(`a${up}${shiftedDown}${ctrlUp}${click}z`);

  assert.equal(parsed.data, "az");
  assert.equal(parsed.wheelNotches, 1);
  assert.equal(parsed.mouseSequences, 4);

  const nonMouseCsi = "\x1b[Mabc";
  assert.deepEqual(parseTerminalMouseInput(nonMouseCsi), {
    data: nonMouseCsi,
    wheelNotches: 0,
    mouseSequences: 0,
  });
});

test("workbench dimensions do not reserve a scrollbar column", () => {
  const dimensions = workbenchDimensions(160, 40, true);
  assert.equal(dimensions.mainWidth + dimensions.sidebarWidth, 160);
  assert.equal(fixedViewport(["chat"], ["composer"], 2)[0], "chat");
});

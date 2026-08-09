import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyArabicAltSShortcut,
  parseTerminalMouseInput,
} from "../extensions/ui/terminalCompatibility.ts";
import {
  fixedViewport,
  preserveScrollAnchor,
  splitWorkbenchChildren,
  workbenchDimensions,
  WORKBENCH_ENTER_SEQUENCE,
  WORKBENCH_LEAVE_SEQUENCE,
  WORKBENCH_MOUSE_TRACKING_SEQUENCE,
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
  assert.match(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?1049h/);
  assert.ok(WORKBENCH_ENTER_SEQUENCE.includes(WORKBENCH_MOUSE_TRACKING_SEQUENCE));
  assert.match(WORKBENCH_MOUSE_TRACKING_SEQUENCE, /\x1b\[\?1007l/);
  assert.match(WORKBENCH_MOUSE_TRACKING_SEQUENCE, /\x1b\[\?1006h/);
  assert.match(WORKBENCH_MOUSE_TRACKING_SEQUENCE, /\x1b\[\?1002h/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1002l/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1006l/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1007h/);
  assert.match(WORKBENCH_LEAVE_SEQUENCE, /\x1b\[\?1049l/);
});

test("terminal mouse parser extracts repeated modified wheel events and keeps mixed input", () => {
  const up = "\x1b[<64;10;4M";
  const shiftedDown = "\x1b[<69;10;4M";
  const ctrlUp = "\x1b[<80;10;4M";
  const click = "\x1b[<0;10;4M";
  const drag = "\x1b[<32;14;4M";
  const release = "\x1b[<0;14;4m";
  const parsed = parseTerminalMouseInput(`a${up}${shiftedDown}${ctrlUp}${click}${drag}${release}z`);

  assert.equal(parsed.data, "az");
  assert.equal(parsed.wheelNotches, 1);
  assert.equal(parsed.mouseSequences, 6);
  assert.deepEqual(parsed.events.slice(-3).map(({ kind, button, x, y }) => ({ kind, button, x, y })), [
    { kind: "press", button: 0, x: 10, y: 4 },
    { kind: "drag", button: 0, x: 14, y: 4 },
    { kind: "release", button: 0, x: 14, y: 4 },
  ]);
  assert.deepEqual(parseTerminalMouseInput("\x1b[Mabc"), {
    data: "\x1b[Mabc",
    wheelNotches: 0,
    mouseSequences: 0,
    events: [],
  });
});

test("legacy Arabic Alt+S normalizes without changing text or Kitty input", () => {
  assert.equal(legacyArabicAltSShortcut("\x1bس"), "\x1bs");
  for (const input of ["س", "\x1bش", "\x1bs", "\x1b[1587::115;3u"]) {
    assert.equal(legacyArabicAltSShortcut(input), undefined);
  }
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

test("scroll anchor remains on the same chat rows while streaming appends output", () => {
  assert.equal(preserveScrollAnchor(0, 20, 24, 20), 0);
  assert.equal(preserveScrollAnchor(3, 20, 24, 20), 7);
  assert.equal(preserveScrollAnchor(7, 24, 10, 6), 6);
});

test("Pi 0.84 document tree keeps above-editor widgets scrollable and bottom chrome docked", () => {
  const children = [
    "document",
    "pending",
    "status",
    "above-editor-widget",
    "editor",
    "below-editor-widget",
    "footer",
  ];

  assert.deepEqual(splitWorkbenchChildren(children), {
    scrollChildren: ["document", "pending", "above-editor-widget"],
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

test("workbench dimensions do not reserve a scrollbar column", () => {
  const dimensions = workbenchDimensions(160, 40, true);
  assert.equal(dimensions.mainWidth + dimensions.sidebarWidth, 160);
  assert.equal(fixedViewport(["chat"], ["composer"], 2)[0], "chat");
});

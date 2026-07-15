import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedViewport,
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

test("workbench terminal modes preserve native mouse selection", () => {
  assert.match(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?1007l/);
  assert.doesNotMatch(WORKBENCH_ENTER_SEQUENCE, /\x1b\[\?(?:1000|1006)h/);
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

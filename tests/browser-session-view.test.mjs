import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SESSION_VIEW,
  SESSION_BATCH_SIZE,
  SESSION_VIEW_STORAGE_KEY,
  matchingSessions,
  orderedSessions,
  readSessionView,
  visibleListSessions,
  workspaceGroups,
  writeSessionView,
} from "../browser/public/session-view.js";

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => initial.get(key) ?? null,
    setItem: (key, value) => initial.set(key, value),
  };
}

const sessions = [
  { id: "one", name: "Older", cwd: "Alpha", workspaceId: "g_alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "two", name: "Newest", cwd: "Beta", workspaceId: "g_beta", updatedAt: "2026-01-03T00:00:00.000Z" },
  { id: "three", name: "Middle", cwd: "Alpha", workspaceId: "g_alpha", updatedAt: "2026-01-02T00:00:00.000Z" },
];

test("session view defaults and persisted choices match the pinned reference", () => {
  const storage = memoryStorage();
  assert.deepEqual(readSessionView(storage), DEFAULT_SESSION_VIEW);
  writeSessionView(storage, { groupBy: "list", orderBy: "manual" });
  assert.deepEqual(readSessionView(storage), { groupBy: "list", orderBy: "manual" });
});

test("session view rejects malformed, invalid, and extended persisted state", () => {
  for (const value of [
    "not-json",
    JSON.stringify({ groupBy: "folders", orderBy: "updated" }),
    JSON.stringify({ groupBy: "workspace", orderBy: "updated", sourcePath: "private" }),
  ]) {
    const storage = memoryStorage(new Map([[SESSION_VIEW_STORAGE_KEY, value]]));
    assert.deepEqual(readSessionView(storage), DEFAULT_SESSION_VIEW);
  }
  assert.throws(() => writeSessionView(memoryStorage(), { groupBy: "workspace", orderBy: "newest" }), /Invalid/);
});

test("workspace grouping uses opaque IDs and preserves account order", () => {
  const groups = workspaceGroups(sessions, "updated");

  assert.deepEqual(groups.map((group) => group.key), ["g_alpha", "g_beta"]);
  assert.deepEqual(groups[0].sessions.map((session) => session.id), ["three", "one"]);
  assert.deepEqual(groups[1].sessions.map((session) => session.id), ["two"]);
});

test("sessions without an opaque workspace ID fall back to Ungrouped", () => {
  const [group] = workspaceGroups([{ id: "loose", name: "Loose", updatedAt: "2026-01-01T00:00:00.000Z" }], "manual");
  assert.deepEqual({ key: group.key, label: group.label, count: group.sessions.length },
    { key: "ungrouped", label: "Ungrouped", count: 1 });
});

test("manual ordering preserves catalog order while updated ordering sorts copies", () => {
  assert.deepEqual(orderedSessions(sessions, "manual").map((session) => session.id), ["one", "two", "three"]);
  assert.deepEqual(orderedSessions(sessions, "updated").map((session) => session.id), ["two", "three", "one"]);
  assert.deepEqual(sessions.map((session) => session.id), ["one", "two", "three"]);
});

test("400+ unfiltered sessions are windowed while search includes every match", () => {
  const many = Array.from({ length: SESSION_BATCH_SIZE * 8 + 7 }, (_, index) => ({
    id: `session-${index}`,
    name: `Build ${index}`,
    cwd: "Alpha",
    workspaceId: "g_alpha",
    updatedAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
  }));

  assert.equal(visibleListSessions(many, "", SESSION_BATCH_SIZE).length, SESSION_BATCH_SIZE);
  assert.equal(visibleListSessions(many, "Build", SESSION_BATCH_SIZE).length, many.length);
  assert.deepEqual(matchingSessions(sessions, "beta").map((session) => session.id), ["two"]);
});

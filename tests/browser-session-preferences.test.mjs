import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_SESSION_PREFERENCES,
  SESSION_PREFERENCES_STORAGE_KEY,
  archiveSession,
  archivedSessions,
  prioritizePinnedSessions,
  readSessionPreferences,
  restoreSession,
  togglePinnedSession,
  visibleSessions,
  writeSessionPreferences,
} from "../browser/public/session-preferences.js";

const sessionId = (character) => `s_${character.repeat(32)}`;
const one = sessionId("a");
const two = sessionId("b");
const three = sessionId("c");
const sessions = [{ id: one }, { id: two }, { id: three }];

function memoryStorage(value = null) {
  const values = new Map(value === null ? [] : [[SESSION_PREFERENCES_STORAGE_KEY, value]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, nextValue) => values.set(key, nextValue),
    value: () => values.get(SESSION_PREFERENCES_STORAGE_KEY),
  };
}

test("sidebar preferences persist strict opaque session IDs", () => {
  const storage = memoryStorage();
  const preferences = { pinned: [two], archived: [three] };

  writeSessionPreferences(storage, preferences);

  assert.deepEqual(readSessionPreferences(storage), preferences);
  assert.deepEqual(JSON.parse(storage.value()), preferences);
});

test("malformed or conflicting sidebar preferences fail closed", () => {
  const invalidValues = [
    "not-json",
    JSON.stringify(null),
    JSON.stringify({ pinned: [], archived: [], extra: true }),
    JSON.stringify({ pinned: ["raw/path"], archived: [] }),
    JSON.stringify({ pinned: [one, one], archived: [] }),
    JSON.stringify({ pinned: [one], archived: [one] }),
  ];

  for (const value of invalidValues) {
    assert.deepEqual(readSessionPreferences(memoryStorage(value)), EMPTY_SESSION_PREFERENCES);
  }
});

test("archive hides sessions, removes pins, and restore makes sessions visible", () => {
  const archived = archiveSession({ pinned: [two], archived: [] }, two);

  assert.deepEqual(archived, { pinned: [], archived: [two] });
  assert.deepEqual(visibleSessions(sessions, archived).map((session) => session.id), [one, three]);
  assert.deepEqual(archivedSessions(sessions, archived).map((session) => session.id), [two]);

  const restored = restoreSession(archived, two);
  assert.deepEqual(restored, { pinned: [], archived: [] });
  assert.deepEqual(visibleSessions(sessions, restored).map((session) => session.id), [one, two, three]);
});

test("pinning is reversible and moves pinned sessions first without disturbing peer order", () => {
  const pinned = togglePinnedSession({ pinned: [], archived: [] }, two);

  assert.deepEqual(prioritizePinnedSessions(sessions, pinned).map((session) => session.id), [two, one, three]);
  assert.deepEqual(togglePinnedSession(pinned, two), { pinned: [], archived: [] });
});

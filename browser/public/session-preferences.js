export const SESSION_PREFERENCES_STORAGE_KEY = "pi-harness.sidebar.sessions.v1";
export const EMPTY_SESSION_PREFERENCES = Object.freeze({ pinned: [], archived: [] });

const SESSION_ID_PATTERN = /^s_[A-Za-z0-9_-]{32}$/;
const MAX_STORED_SESSION_IDS = 1_000;

function validSessionIds(ids) {
  return Array.isArray(ids) && ids.length <= MAX_STORED_SESSION_IDS &&
    ids.every((id) => typeof id === "string" && SESSION_ID_PATTERN.test(id)) &&
    new Set(ids).size === ids.length;
}

function validPreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return false;
  if (Object.keys(preferences).sort().join(",") !== "archived,pinned") return false;
  if (!validSessionIds(preferences.pinned) || !validSessionIds(preferences.archived)) return false;
  const archived = new Set(preferences.archived);
  return preferences.pinned.every((id) => !archived.has(id));
}

function copyPreferences(preferences) {
  return { pinned: [...preferences.pinned], archived: [...preferences.archived] };
}

export function readSessionPreferences(storage) {
  try {
    const preferences = JSON.parse(storage.getItem(SESSION_PREFERENCES_STORAGE_KEY));
    return validPreferences(preferences) ? copyPreferences(preferences) : copyPreferences(EMPTY_SESSION_PREFERENCES);
  } catch {
    return copyPreferences(EMPTY_SESSION_PREFERENCES);
  }
}

export function writeSessionPreferences(storage, preferences) {
  if (!validPreferences(preferences)) throw new TypeError("Invalid session sidebar preferences");
  storage.setItem(SESSION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function visibleSessions(sessions, preferences) {
  const archived = new Set(preferences.archived);
  return sessions.filter((session) => !archived.has(session.id));
}

export function archivedSessions(sessions, preferences) {
  const archived = new Set(preferences.archived);
  return sessions.filter((session) => archived.has(session.id));
}

export function prioritizePinnedSessions(sessions, preferences) {
  const pinned = new Set(preferences.pinned);
  return [...sessions].sort((left, right) => Number(pinned.has(right.id)) - Number(pinned.has(left.id)));
}

export function togglePinnedSession(preferences, sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId) || preferences.archived.includes(sessionId)) return copyPreferences(preferences);
  const pinned = preferences.pinned.includes(sessionId)
    ? preferences.pinned.filter((id) => id !== sessionId)
    : [...preferences.pinned, sessionId];
  return { pinned, archived: [...preferences.archived] };
}

export function archiveSession(preferences, sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return copyPreferences(preferences);
  return {
    pinned: preferences.pinned.filter((id) => id !== sessionId),
    archived: preferences.archived.includes(sessionId)
      ? [...preferences.archived]
      : [...preferences.archived, sessionId],
  };
}

export function restoreSession(preferences, sessionId) {
  if (!SESSION_ID_PATTERN.test(sessionId)) return copyPreferences(preferences);
  return {
    pinned: [...preferences.pinned],
    archived: preferences.archived.filter((id) => id !== sessionId),
  };
}

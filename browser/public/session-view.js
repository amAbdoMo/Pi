export const SESSION_VIEW_STORAGE_KEY = "pi-harness.workspace.view.v1";
export const DEFAULT_SESSION_VIEW = Object.freeze({ groupBy: "workspace", orderBy: "updated" });
export const SESSION_BATCH_SIZE = 50;
export const COLLAPSED_WORKSPACE_SIZE = 5;

function validPreference(preference) {
  if (!preference || typeof preference !== "object" || Array.isArray(preference)) return false;
  if (Object.keys(preference).sort().join(",") !== "groupBy,orderBy") return false;
  return ["workspace", "list"].includes(preference.groupBy) &&
    ["manual", "updated"].includes(preference.orderBy);
}

export function readSessionView(storage) {
  try {
    const preference = JSON.parse(storage.getItem(SESSION_VIEW_STORAGE_KEY));
    return validPreference(preference) ? preference : { ...DEFAULT_SESSION_VIEW };
  } catch {
    return { ...DEFAULT_SESSION_VIEW };
  }
}

export function writeSessionView(storage, preference) {
  if (!validPreference(preference)) throw new TypeError("Invalid session view preference");
  storage.setItem(SESSION_VIEW_STORAGE_KEY, JSON.stringify(preference));
}

export function matchingSessions(sessions, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...sessions];
  return sessions.filter((session) => [session.name, session.cwd]
    .some((field) => field?.toLocaleLowerCase().includes(normalized)));
}

export function orderedSessions(sessions, orderBy) {
  if (orderBy === "manual") return [...sessions];
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function workspaceGroups(sessions, orderBy) {
  const groups = new Map();
  for (const session of sessions) {
    const key = session.workspaceId || "ungrouped";
    if (!groups.has(key)) groups.set(key, { key, label: session.cwd || "Ungrouped", sessions: [] });
    groups.get(key).sessions.push(session);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    sessions: orderedSessions(group.sessions, orderBy),
  }));
}

export function visibleListSessions(sessions, query, limit) {
  const matches = matchingSessions(sessions, query);
  return query.trim() ? matches : matches.slice(0, limit);
}

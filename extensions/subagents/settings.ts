import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CHILD_PROFILE_NAMES,
  CHILD_THINKING_LEVELS,
  DEFAULT_CHILD_PROFILES,
  type ChildProfileMap,
  type ChildProfileName,
  type ChildThinkingLevel,
} from "./child-profile.ts";
import { DEFAULT_RETURN_MAX_BYTES } from "./constants.ts";
import type { SubagentSettings } from "./types.ts";

export const DEFAULT_SETTINGS: SubagentSettings = {
  maxDepth: 1,
  maxConcurrent: 3,
  defaultContext: "compact",
  handoffTokenBudget: 4_000,
  handoffKeepRecentTokens: 2_000,
  childTools: "inherit-parent-or-pi-default",
  returnMaxBytes: DEFAULT_RETURN_MAX_BYTES,
  statusHistoryLimit: 0,
  shortcut: "alt+s",
  persistSessions: true,
  sessionDir: "~/.pi/agent/sessions/subagents",
  showInNormalResume: false,
  killChildrenOnParentExit: true,
  allowChildSubagents: true,
  profiles: DEFAULT_CHILD_PROFILES,
  summaryProfile: "fast",
};

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function readJsonFile(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function loadProfiles(value: unknown): ChildProfileMap {
  const configured =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    CHILD_PROFILE_NAMES.map((name) => {
      const fallback = DEFAULT_CHILD_PROFILES[name];
      const entry = configured[name];
      if (!entry || typeof entry !== "object") return [name, { ...fallback }];
      const candidate = entry as Record<string, unknown>;
      const model =
        typeof candidate.model === "string" && candidate.model.trim()
          ? candidate.model.trim()
          : fallback.model;
      const thinking = CHILD_THINKING_LEVELS.includes(
        candidate.thinking as ChildThinkingLevel,
      )
        ? (candidate.thinking as ChildThinkingLevel)
        : fallback.thinking;
      return [name, { model, thinking }];
    }),
  ) as unknown as ChildProfileMap;
}

export function loadSettings(cwd: string): SubagentSettings {
  const globalSettings = readJsonFile(
    path.join(os.homedir(), ".pi", "agent", "settings.json"),
  );
  const projectSettings = readJsonFile(path.join(cwd, ".pi", "settings.json"));
  const merged = {
    ...(globalSettings?.subagents ?? {}),
    ...(projectSettings?.subagents ?? {}),
  };
  const defaultContext =
    merged.defaultContext === "fresh" ? "fresh" : "compact";
  const sessionDir =
    typeof merged.sessionDir === "string" && merged.sessionDir.trim()
      ? merged.sessionDir
      : DEFAULT_SETTINGS.sessionDir;
  const shortcut =
    typeof merged.shortcut === "string" && merged.shortcut.trim()
      ? merged.shortcut
      : DEFAULT_SETTINGS.shortcut;
  return {
    maxDepth: clampNumber(merged.maxDepth, DEFAULT_SETTINGS.maxDepth, 0, 20),
    maxConcurrent: clampNumber(
      merged.maxConcurrent,
      DEFAULT_SETTINGS.maxConcurrent,
      1,
      8,
    ),
    defaultContext,
    handoffTokenBudget: clampNumber(
      merged.handoffTokenBudget,
      DEFAULT_SETTINGS.handoffTokenBudget,
      1_000,
      200_000,
    ),
    handoffKeepRecentTokens: clampNumber(
      merged.handoffKeepRecentTokens,
      DEFAULT_SETTINGS.handoffKeepRecentTokens,
      500,
      100_000,
    ),
    childTools: "inherit-parent-or-pi-default",
    returnMaxBytes: clampNumber(
      merged.returnMaxBytes,
      DEFAULT_SETTINGS.returnMaxBytes,
      1_000,
      1_000_000,
    ),
    statusHistoryLimit: clampNumber(
      merged.statusHistoryLimit,
      DEFAULT_SETTINGS.statusHistoryLimit,
      0,
      10_000,
    ),
    shortcut,
    persistSessions: merged.persistSessions !== false,
    sessionDir: path.resolve(expandHome(sessionDir)),
    showInNormalResume: merged.showInNormalResume === true,
    killChildrenOnParentExit: merged.killChildrenOnParentExit !== false,
    allowChildSubagents: merged.allowChildSubagents !== false,
    profiles: loadProfiles(merged.profiles),
    summaryProfile: CHILD_PROFILE_NAMES.includes(
      merged.summaryProfile as ChildProfileName,
    )
      ? (merged.summaryProfile as ChildProfileName)
      : DEFAULT_SETTINGS.summaryProfile,
  };
}

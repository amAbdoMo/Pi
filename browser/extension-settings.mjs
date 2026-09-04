import { mkdir, readFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { atomicWrite } from "../scripts/bootstrap/files.mjs";

const WORKBENCH_SOURCE = /^git:github\.com\/amAbdoMo\/Pi(?:@.+)?$/i;
const LOCK_ATTEMPTS = 10;
const LOCK_DELAY_MS = 25;

export const WORKBENCH_EXTENSIONS = Object.freeze([
  { id: "ask-user", name: "Ask User", path: "extensions/ask-user/index.ts", description: "Framed questions, decisions, and guided interviews." },
  { id: "code-state", name: "Code State", path: "extensions/code-state/index.ts", description: "Git-backed conversational undo and redo." },
  { id: "fast-mode", name: "Fast Mode", path: "extensions/fast-mode/index.ts", description: "Faster responses for supported GPT models." },
  { id: "firecrawl-web", name: "Firecrawl Web", path: "extensions/firecrawl-web.ts", description: "Web search, fetch, mapping, and crawling tools." },
  { id: "image-gen", name: "Image Generation", path: "extensions/image-gen/index.ts", description: "Generate and edit images with OpenAI." },
  { id: "login-guard", name: "WordPress Login Guard", path: "extensions/login-guard.ts", description: "Pauses browser work until WordPress login is confirmed." },
  { id: "mcp", name: "MCP Hub", path: "extensions/mcp/index.ts", description: "Discover, connect to, and call MCP servers." },
  { id: "memory", name: "Persistent Memory", path: "extensions/memory/index.ts", description: "Curated user, project, and global memory." },
  { id: "pi-tool-display", name: "Tool Display", path: "extensions/pi-tool-display/index.ts", description: "Enhanced tool output and diff presentation." },
  { id: "plan-mode", name: "Plan Progress", path: "extensions/plan-mode/index.ts", description: "Tracked plan steps and progress updates." },
  { id: "side-chat", name: "Side Chat", path: "extensions/side-chat/index.ts", description: "Temporary side tasks with current context and tools." },
  { id: "skills-browser", name: "Skills Browser", path: "extensions/skills-browser/index.ts", description: "Browse the skills available to Pi." },
  { id: "subagents", name: "Subagents", path: "extensions/subagents/index.ts", description: "Delegate focused work to nested agents." },
  { id: "ui-learning-loop", name: "UI Learning Loop", path: "extensions/ui-learning-loop/index.ts", description: "Approval-gated WordPress UI lessons." },
  { id: "ui", name: "Workbench UI", path: "extensions/ui/index.ts", description: "Workbench header, editor, sidebar, usage, and terminal UI." },
  { id: "workflow", name: "Workflows", path: "extensions/workflow/index.ts", description: "Predefined sequential engineering workflows." },
]);

function parseSettings(settingsText) {
  const errors = [];
  const settings = parse(settingsText, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !settings || typeof settings !== "object" || Array.isArray(settings)) {
    const detail = errors[0] ? printParseErrorCode(errors[0].error) : "Invalid root";
    throw new TypeError(`Pi settings are invalid: ${detail}`);
  }
  if (!Array.isArray(settings.packages)) throw new TypeError("Pi settings packages must be an array");
  return settings;
}

function packageSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function workbenchPackage(settings) {
  const matches = settings.packages
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => WORKBENCH_SOURCE.test(packageSource(entry) ?? ""));
  if (matches.length !== 1) throw new TypeError("Pi settings must contain one Workbench package");
  return matches[0];
}

function globMatches(pattern, extensionPath) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(extensionPath);
}

function selectorState(selectors, extensionPath) {
  if (selectors === undefined) return true;
  if (selectors.length === 0) return false;
  const includes = selectors.filter((selector) => !/^[+!-]/.test(selector));
  let enabled = includes.length === 0 || includes.some((pattern) => globMatches(pattern, extensionPath));
  if (selectors.some((selector) => selector.startsWith("!") && globMatches(selector.slice(1), extensionPath))) enabled = false;
  if (selectors.includes(`+${extensionPath}`)) enabled = true;
  if (selectors.includes(`-${extensionPath}`)) enabled = false;
  return enabled;
}

export function extensionSnapshot(settingsText) {
  const settings = parseSettings(settingsText);
  const { entry } = workbenchPackage(settings);
  const selectors = typeof entry === "object" ? entry.extensions : undefined;
  if (selectors !== undefined && (!Array.isArray(selectors) || selectors.some((value) => typeof value !== "string"))) {
    throw new TypeError("Workbench extension filters must be strings");
  }
  return WORKBENCH_EXTENSIONS.map((extension) => ({
    ...extension,
    enabled: selectorState(selectors, extension.path),
  }));
}

function normalizedEnabledMap(enabled) {
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)) throw new TypeError("Extension states must be an object");
  const ids = new Set(WORKBENCH_EXTENSIONS.map((extension) => extension.id));
  if (Object.keys(enabled).length !== ids.size || Object.keys(enabled).some((id) => !ids.has(id))) {
    throw new TypeError("Extension states must include every Workbench extension");
  }
  if (Object.values(enabled).some((value) => typeof value !== "boolean")) throw new TypeError("Extension states must be boolean");
  return enabled;
}

export function updateExtensionSettings(settingsText, enabled) {
  const settings = parseSettings(settingsText);
  const { entry, index } = workbenchPackage(settings);
  const states = normalizedEnabledMap(enabled);
  const packageEntry = typeof entry === "string" ? { source: entry } : { ...entry };
  const knownPaths = new Set(WORKBENCH_EXTENSIONS.map((extension) => extension.path));
  const retained = Array.isArray(packageEntry.extensions)
    ? packageEntry.extensions.filter((selector) => !knownPaths.has(selector.replace(/^[+!-]/, "")))
    : [];
  packageEntry.extensions = [
    ...retained,
    ...WORKBENCH_EXTENSIONS.map((extension) => `${states[extension.id] ? "+" : "-"}${extension.path}`),
  ];
  const edits = modify(settingsText, ["packages", index], packageEntry, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  return applyEdits(settingsText, edits);
}

async function settingsLock(settingsPath) {
  const lockPath = `${settingsPath}.lock`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      return async () => { await rmdir(lockPath); };
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt === LOCK_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOCK_DELAY_MS));
    }
  }
  throw new Error("Unable to lock Pi settings");
}

export async function readExtensionSettings(settingsPath) {
  return extensionSnapshot(await readFile(settingsPath, "utf8"));
}

export async function writeExtensionSettings(settingsPath, enabled) {
  const release = await settingsLock(settingsPath);
  try {
    const current = await readFile(settingsPath, "utf8");
    const next = updateExtensionSettings(current, enabled);
    atomicWrite(settingsPath, `${next.trimEnd()}\n`);
    return extensionSnapshot(next);
  } finally {
    await release();
  }
}

export function globalSettingsPath(agentDir) {
  return path.join(agentDir, "settings.json");
}

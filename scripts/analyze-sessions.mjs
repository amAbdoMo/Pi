#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const SCHEMA_VERSION = 1;
const DEFAULT_DAYS = 30;
const ACTIVE_GAP_CAP_MS = 5 * 60 * 1000;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const UUID_SHAPE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const AUTOMATIC_VERIFICATION_PREFIX = "[automatic verification required";
const AUTH_BLOCKER_PATTERNS = [
  /wp-login\.php/i,
  /username or email address[\s\S]{0,1000}password[\s\S]{0,500}log in/i,
  /\b(?:401|403)\b[^\n]{0,120}(?:unauthorized|forbidden|access denied)/i,
  /\b(?:unauthorized|forbidden|access denied)\b/i,
  /sign in to continue|authentication required/i,
];
const ACCESS_BLOCKER_PATTERNS = [
  /err_connection_(?:refused|reset|timed_out)|net::err_/i,
  /(?:site|page) can.?t be reached|connection refused|failed to connect/i,
  /navigation timeout|timed out after/i,
  /target page, context or browser has been closed|browser has been closed/i,
];
const PUBLIC_PROVIDERS = new Set(["anthropic", "openai", "openai-codex", "google", "google-vertex", "github-copilot", "openrouter", "mistral", "groq", "xai", "deepseek"]);
const PUBLIC_TOOLS = new Set([
  "read", "write", "edit", "bash", "grep", "find", "ls", "mcp", "memory", "delegate", "workflow_run", "verification_report",
  "web_fetch", "web_search", "web_map", "web_crawl", "image_gen", "ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_search",
  "ctx_index", "ctx_fetch_and_index", "ctx_stats", "hypa_shell", "hypa_read", "hypa_grep", "hypa_find", "hypa_ls", "plan_progress",
  "workflow_phase_result",
]);

function usage() {
  return `Usage: node scripts/analyze-sessions.mjs [options]\n\nPrivacy-safe aggregate analyzer for Pi JSONL sessions.\n\nOptions:\n  --session-dir DIR  Session root (default: PI_CODING_AGENT_SESSION_DIR or ~/.pi/agent/sessions)\n  --days N          Analyze records from the last N days (default: ${DEFAULT_DAYS})\n  --output FILE     Write JSON report to FILE instead of stdout\n  --pretty          Pretty-print JSON\n  --help            Show this help\n`;
}

function fail(message) {
  console.error(`analyze-sessions: ${message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { days: DEFAULT_DAYS, pretty: false, output: undefined, sessionDir: undefined, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--days") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--days requires a positive number");
      const days = Number(value);
      if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");
      options.days = days;
    } else if (arg === "--output") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
      options.output = value;
    } else if (arg === "--session-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--session-dir requires a directory path");
      options.sessionDir = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return options;
}

function resolveTilde(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function defaultSessionDir() {
  return process.env.PI_CODING_AGENT_SESSION_DIR || path.join(os.homedir(), ".pi", "agent", "sessions");
}

function emptyCounts() {
  return Object.create(null);
}

function inc(map, key, amount = 1) {
  const safeKey = key || "unknown";
  map[safeKey] = (map[safeKey] || 0) + amount;
}

function addNumber(target, key, value) {
  if (typeof value === "number" && Number.isFinite(value)) target[key] += value;
}

function sanitizeIdentifier(value) {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || UUID_SHAPE.test(trimmed) || !SAFE_IDENTIFIER.test(trimmed)) return "other";
  return trimmed;
}

function sanitizeProvider(value) {
  const identifier = sanitizeIdentifier(value);
  return PUBLIC_PROVIDERS.has(identifier) ? identifier : "other";
}

function sanitizeModel(value) {
  const identifier = sanitizeIdentifier(value);
  return /^(?:gpt-|claude-|gemini-|o[1-9](?:-|$)|deepseek-|mistral-|grok-)[a-z0-9._:-]*$/i.test(identifier) ? identifier : "other";
}

function sanitizeTool(value) {
  const identifier = sanitizeIdentifier(value);
  return PUBLIC_TOOLS.has(identifier) || /^browser_[a-z0-9_]+$/.test(identifier) ? identifier : "other";
}

function safeRole(value) {
  const roles = new Map([
    ["system", "system"],
    ["user", "user"],
    ["assistant", "assistant"],
    ["tool", "toolResult"],
    ["toolResult", "toolResult"],
    ["bashExecution", "bashExecution"],
    ["custom", "custom"],
    ["branchSummary", "branchSummary"],
    ["compactionSummary", "compactionSummary"],
  ]);
  return roles.get(value) || "other";
}

function safeStopReason(value) {
  const safe = sanitizeIdentifier(value);
  return safe === "unknown" ? "unknown" : safe;
}

function classifyWorkspace(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "unknown";
  const normalized = cwd.replace(/\\/g, "/").toLowerCase();
  if (/(^|\/)wp-content\/|(^|\/)local sites\//.test(normalized)) return "wordpress-project";
  if (/(^|\/)projects\/pi($|\/)|(^|\/)pi($|\/)/.test(normalized) && /(^|\/)projects\/pi($|\/)|(^|\/)pi($|\/)/.test(normalized)) return "pi-repository";
  const home = os.homedir().replace(/\\/g, "/").toLowerCase();
  if (["/", "/usr", "/etc", "/var", "/tmp", "c:/", "c:/windows", "c:/program files", "c:/program files (x86)"].some((p) => normalized === p || normalized.startsWith(`${p}/`))) return "system-directory";
  if (home && normalized === home) return "home-workspace";
  return "other-workspace";
}

function isSubagentPath(filePath, root) {
  const relative = path.relative(root, filePath).replace(/\\/g, "/").split("/");
  return relative.includes("subagents");
}

function timestampOf(record) {
  const candidates = [record?.timestamp, record?.message?.timestamp];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate < 1_000_000_000_000 ? candidate * 1000 : candidate;
    }
    if (typeof candidate !== "string") continue;
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function textContent(content, maxCharacters = 50_000) {
  const parts = [];
  let capturedCharacters = 0;
  const addPart = (text) => {
    if (capturedCharacters >= maxCharacters) return;
    const remaining = maxCharacters - capturedCharacters;
    const part = text.slice(0, remaining);
    parts.push(part);
    capturedCharacters += part.length + 1;
  };
  const visit = (value) => {
    if (typeof value === "string") addPart(value);
    else if (Array.isArray(value)) for (const entry of value) visit(entry);
    else if (value && typeof value === "object" && typeof value.text === "string") addPart(value.text);
  };
  visit(content);
  return parts.join("\n").slice(0, maxCharacters);
}

function toolCallsIn(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((entry) => entry && typeof entry === "object" && ["toolCall", "tool-call", "tool_call"].includes(entry.type));
}

function contentStats(content) {
  const stats = { contentCharacters: 0, imagePayloadBytes: 0, toolCallCount: 0, toolNames: emptyCounts() };
  const visit = (value) => {
    if (typeof value === "string") {
      stats.contentCharacters += value.length;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.text === "string") stats.contentCharacters += value.text.length;
    if (["toolCall", "tool-call", "tool_call"].includes(value.type) && typeof value.name === "string") {
      stats.toolCallCount += 1;
      inc(stats.toolNames, sanitizeTool(value.name));
    }
    const mime = typeof value.mimeType === "string" ? value.mimeType.toLowerCase() : "";
    if (mime.startsWith("image/") && typeof value.data === "string") {
      stats.imagePayloadBytes += Buffer.byteLength(value.data, "base64");
    }
  };
  visit(content);
  return stats;
}

function looksLikeCompaction(record) {
  return record?.type === "compaction" || record?.customType === "compaction" || Object.hasOwn(record || {}, "tokensBefore") || Object.hasOwn(record || {}, "firstKeptEntryId");
}

function looksLikeBranchSummary(record) {
  return record?.type === "branch_summary" || record?.type === "branch-summary" || record?.customType === "branch_summary" || record?.customType === "branch-summary";
}

function newUsageTotals() {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    sessionReportedEstimatedCost: 0,
    sessionReportedEstimatedCostInput: 0,
    sessionReportedEstimatedCostOutput: 0,
    sessionReportedEstimatedCostCacheRead: 0,
    sessionReportedEstimatedCostCacheWrite: 0,
  };
}

function addUsage(totals, usage) {
  if (!usage || typeof usage !== "object") return;
  addNumber(totals, "input", usage.input);
  addNumber(totals, "output", usage.output);
  addNumber(totals, "reasoning", usage.reasoning);
  addNumber(totals, "cacheRead", usage.cacheRead);
  addNumber(totals, "cacheWrite", usage.cacheWrite);
  addNumber(totals, "totalTokens", usage.totalTokens);
  if (typeof usage.cost === "number") addNumber(totals, "sessionReportedEstimatedCost", usage.cost);
  else {
    addNumber(totals, "sessionReportedEstimatedCost", usage.cost?.total);
    addNumber(totals, "sessionReportedEstimatedCostInput", usage.cost?.input);
    addNumber(totals, "sessionReportedEstimatedCostOutput", usage.cost?.output);
    addNumber(totals, "sessionReportedEstimatedCostCacheRead", usage.cost?.cacheRead);
    addNumber(totals, "sessionReportedEstimatedCostCacheWrite", usage.cost?.cacheWrite);
  }
}

function newUsageBreakdown() {
  return {
    assistant: newUsageTotals(),
    nestedTools: newUsageTotals(),
    summaries: newUsageTotals(),
    total: newUsageTotals(),
  };
}

function newTurnAttribution() {
  return { turns: 0, promptCharacters: 0, assistantMessages: 0, toolCalls: 0, usage: newUsageTotals() };
}

function turnSource(kind, prompt) {
  if (kind === "subagent") return "subagentDelegated";
  return prompt.trim().toLowerCase().startsWith(AUTOMATIC_VERIFICATION_PREFIX)
    ? "automaticVerificationFollowUp"
    : "humanOrUnknown";
}

function stableArguments(value) {
  if (Array.isArray(value)) return value.map(stableArguments);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableArguments(value[key])]));
}

function normalizedSignature(toolName, args) {
  const serialized = JSON.stringify(stableArguments(args ?? {}));
  return `${toolName}:${serialized}`
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 2000);
}

function observedBrowserTool(toolName, args) {
  if (toolName.startsWith("browser_")) return toolName;
  if (toolName === "mcp" && args?.action === "call" && typeof args.tool === "string" && args.tool.startsWith("browser_")) return args.tool;
  const serialized = JSON.stringify(args ?? {}).toLowerCase();
  return /playwright|agent-browser/.test(serialized) ? "browser_cli" : undefined;
}

function toolCategory(toolName, args) {
  const browserTool = observedBrowserTool(toolName, args);
  if (browserTool) return "browserVisualVerification";
  if (toolName === "delegate") return "delegation";
  if (toolName === "workflow_run") return "workflow";
  if (["read", "find", "grep", "ls", "ctx_execute_file", "ctx_search", "ctx_index", "hypa_read", "hypa_find", "hypa_grep", "hypa_ls"].includes(toolName)) return "localInspection";
  if (["edit", "write", "apply_patch", "image_gen"].includes(toolName)) return "fileChanges";
  if (toolName.startsWith("web_") || ["ctx_fetch_and_index"].includes(toolName)) return "webResearch";
  if (toolName === "memory") return "memory";
  if (["bash", "ctx_execute", "ctx_batch_execute", "hypa_shell"].includes(toolName)) {
    const serialized = JSON.stringify(args ?? {}).toLowerCase();
    if (/\b(?:test|lint|build|typecheck|pytest|phpunit|vitest|jest|tsc|eslint)\b/.test(serialized)) return "testsBuildChecks";
    if (/\bgit\s+(?:status|log|diff|show|blame)\b/.test(serialized)) return "versionControlInspection";
    if (/\bgit\s+(?:add|commit|push|merge|checkout)\b/.test(serialized)) return "versionControlWrites";
    return "shellCodeExecution";
  }
  return "otherTools";
}

function blockerKind(browserTool, resultText, isError) {
  if (!browserTool) return undefined;
  if (AUTH_BLOCKER_PATTERNS.some((pattern) => pattern.test(resultText))) return "loginAuth";
  if (ACCESS_BLOCKER_PATTERNS.some((pattern) => pattern.test(resultText))) return "inaccessibleTimeout";
  return isError ? "toolError" : undefined;
}

function addUsageToBreakdown(breakdown, category, usage) {
  addUsage(breakdown[category], usage);
  addUsage(breakdown.total, usage);
}

function newStats(kind, scanIndex) {
  return {
    kind,
    scanIndex,
    workspaceLabel: "unknown",
    files: 1,
    records: 0,
    malformedRecords: 0,
    entriesInWindow: 0,
    messages: 0,
    roles: emptyCounts(),
    assistantMessages: 0,
    usage: newUsageBreakdown(),
    toolCalls: 0,
    toolResults: 0,
    toolResultErrors: 0,
    nestedToolResults: 0,
    contentCharacters: 0,
    roleContentCharacters: emptyCounts(),
    toolResultCharacters: 0,
    imagePayloadBytes: 0,
    compactions: 0,
    compactionTokensBefore: [],
    branchSummaries: 0,
    providers: emptyCounts(),
    models: emptyCounts(),
    stopReasons: emptyCounts(),
    toolCallsByName: emptyCounts(),
    toolResultsByName: emptyCounts(),
    firstTimestampMs: undefined,
    lastTimestampMs: undefined,
    timestamps: [],
    currentTurn: 0,
    currentTurnSource: kind === "subagent" ? "subagentDelegated" : "preWindowContext",
    turnAttribution: Object.create(null),
    pendingTools: new Map(),
    toolObservations: [],
  };
}

function applyRecord(stats, record, timestampMs) {
  stats.records += 1;
  stats.entriesInWindow += 1;
  if (stats.firstTimestampMs === undefined || timestampMs < stats.firstTimestampMs) stats.firstTimestampMs = timestampMs;
  if (stats.lastTimestampMs === undefined || timestampMs > stats.lastTimestampMs) stats.lastTimestampMs = timestampMs;
  stats.timestamps.push(timestampMs);

  if (record?.type === "session") stats.workspaceLabel = classifyWorkspace(record.cwd);
  if (looksLikeCompaction(record)) {
    stats.compactions += 1;
    if (typeof record.tokensBefore === "number" && Number.isFinite(record.tokensBefore)) stats.compactionTokensBefore.push(record.tokensBefore);
    addUsageToBreakdown(stats.usage, "summaries", record.usage);
  }
  if (looksLikeBranchSummary(record)) {
    stats.branchSummaries += 1;
    addUsageToBreakdown(stats.usage, "summaries", record.usage);
  }

  if (record?.provider) inc(stats.providers, sanitizeProvider(record.provider));
  if (record?.modelId) inc(stats.models, sanitizeModel(record.modelId));

  if (record?.type !== "message" || !record.message || typeof record.message !== "object") return;
  const message = record.message;
  stats.messages += 1;
  const role = safeRole(message.role);
  inc(stats.roles, role);

  const cstats = contentStats(message.content);
  stats.contentCharacters += cstats.contentCharacters;
  inc(stats.roleContentCharacters, role, cstats.contentCharacters);
  stats.imagePayloadBytes += cstats.imagePayloadBytes;
  stats.toolCalls += cstats.toolCallCount;
  mergeCounts(stats.toolCallsByName, cstats.toolNames);

  if (role === "user") {
    stats.currentTurn += 1;
    stats.currentTurnSource = turnSource(stats.kind, textContent(message.content));
    stats.turnAttribution[stats.currentTurnSource] ??= newTurnAttribution();
    stats.turnAttribution[stats.currentTurnSource].turns += 1;
    stats.turnAttribution[stats.currentTurnSource].promptCharacters += cstats.contentCharacters;
  }

  if (message.provider) inc(stats.providers, sanitizeProvider(message.provider));
  if (message.model) inc(stats.models, sanitizeModel(message.model));
  if (message.stopReason) inc(stats.stopReasons, safeStopReason(message.stopReason));

  if (role === "assistant") {
    stats.assistantMessages += 1;
    addUsageToBreakdown(stats.usage, "assistant", message.usage);
    stats.turnAttribution[stats.currentTurnSource] ??= newTurnAttribution();
    stats.turnAttribution[stats.currentTurnSource].assistantMessages += 1;
    addUsage(stats.turnAttribution[stats.currentTurnSource].usage, message.usage);

    for (const call of toolCallsIn(message.content)) {
      const toolName = sanitizeTool(call.name);
      const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
      const observation = {
        toolName,
        browserTool: observedBrowserTool(toolName, args),
        category: toolCategory(toolName, args),
        turn: stats.currentTurn,
        turnSource: stats.currentTurnSource,
        signature: normalizedSignature(toolName, args),
        startMs: timestampMs,
        endMs: undefined,
        resultCharacters: 0,
        isError: false,
        blocker: undefined,
      };
      stats.toolObservations.push(observation);
      stats.turnAttribution[stats.currentTurnSource].toolCalls += 1;
      if (typeof call.id === "string") stats.pendingTools.set(call.id, observation);
    }
  }

  if (role === "toolResult" || message.toolCallId || message.toolName) {
    stats.toolResults += 1;
    stats.toolResultCharacters += cstats.contentCharacters;
    if (message.isError) stats.toolResultErrors += 1;
    inc(stats.toolResultsByName, sanitizeTool(message.toolName));
    if (message.usage && typeof message.usage === "object") {
      stats.nestedToolResults += 1;
      addUsageToBreakdown(stats.usage, "nestedTools", message.usage);
      stats.turnAttribution[stats.currentTurnSource] ??= newTurnAttribution();
      addUsage(stats.turnAttribution[stats.currentTurnSource].usage, message.usage);
    }
    const observation = stats.pendingTools.get(message.toolCallId);
    if (observation) {
      observation.endMs = timestampMs;
      observation.resultCharacters = cstats.contentCharacters;
      observation.isError = message.isError === true;
      observation.blocker = blockerKind(observation.browserTool, textContent(message.content), observation.isError);
      stats.pendingTools.delete(message.toolCallId);
    }
  }
}

async function* walkJsonlFiles(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkJsonlFiles(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield fullPath;
  }
}

function activeMs(timestamps) {
  const sorted = [...new Set(timestamps)].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) total += Math.min(sorted[i] - sorted[i - 1], ACTIVE_GAP_CAP_MS);
  return total;
}

function intervalUnionMs(observations) {
  const intervals = observations
    .filter((entry) => Number.isFinite(entry.startMs) && Number.isFinite(entry.endMs) && entry.endMs >= entry.startMs)
    .map((entry) => [entry.startMs, entry.endMs])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let current;
  for (const interval of intervals) {
    if (!current || interval[0] > current[1]) {
      if (current) total += current[1] - current[0];
      current = [...interval];
    } else {
      current[1] = Math.max(current[1], interval[1]);
    }
  }
  return total + (current ? current[1] - current[0] : 0);
}

function repeatedCallMetrics(observations) {
  const groups = new Map();
  for (const entry of observations) {
    const key = `${entry.turn}:${entry.signature}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  const repeated = [...groups.values()].filter((group) => group.length > 1);
  return {
    groups: repeated.length,
    extraCalls: repeated.reduce((total, group) => total + group.length - 1, 0),
    repeatedErrors: repeated.reduce((total, group) => total + group.slice(1).filter((entry) => entry.isError).length, 0),
  };
}

function browserLoopMetrics(observations, highConfidenceOnly) {
  const turns = new Map();
  for (const entry of observations.filter((candidate) => candidate.browserTool)) {
    const group = turns.get(entry.turn) || [];
    group.push(entry);
    turns.set(entry.turn, group);
  }
  let incidents = 0;
  let subsequentCalls = 0;
  let maximumSubsequentCalls = 0;
  let subsequentObservedDurationMs = 0;
  for (const group of turns.values()) {
    const blockerIndex = group.findIndex((entry) => entry.blocker && (!highConfidenceOnly || entry.blocker !== "toolError"));
    if (blockerIndex < 0) continue;
    incidents += 1;
    const subsequent = group.slice(blockerIndex + 1);
    subsequentCalls += subsequent.length;
    maximumSubsequentCalls = Math.max(maximumSubsequentCalls, subsequent.length);
    subsequentObservedDurationMs += intervalUnionMs(subsequent);
  }
  return { incidents, subsequentCalls, maximumSubsequentCalls, subsequentObservedDurationMs };
}

function sessionHeuristics(session) {
  const categories = Object.create(null);
  for (const entry of session.toolObservations) {
    categories[entry.category] ??= { calls: 0, errors: 0, resultCharacters: 0, cumulativeObservedDurationMs: 0 };
    const category = categories[entry.category];
    category.calls += 1;
    category.errors += entry.isError ? 1 : 0;
    category.resultCharacters += entry.resultCharacters;
    category.cumulativeObservedDurationMs += entry.endMs === undefined ? 0 : Math.max(0, entry.endMs - entry.startMs);
  }
  for (const [category, metrics] of Object.entries(categories)) {
    metrics.parallelAdjustedObservedDurationMs = intervalUnionMs(session.toolObservations.filter((entry) => entry.category === category));
  }
  const blockers = emptyCounts();
  for (const entry of session.toolObservations) if (entry.blocker) inc(blockers, entry.blocker);
  return {
    activeTimeProxyMs: activeMs(session.timestamps),
    parallelAdjustedObservedToolTimeMs: intervalUnionMs(session.toolObservations),
    toolCategories: categories,
    repeatedEquivalentCalls: repeatedCallMetrics(session.toolObservations),
    browser: {
      calls: session.toolObservations.filter((entry) => entry.browserTool).length,
      blockers: sortedObject(blockers),
      afterAnyErrorOrBlocker: browserLoopMetrics(session.toolObservations, false),
      afterHighConfidenceAccessBlocker: browserLoopMetrics(session.toolObservations, true),
      snapshotOrScreenshotCalls: session.toolObservations.filter((entry) => /snapshot|screenshot/i.test(entry.browserTool || "")).length,
    },
    turnAttribution: Object.fromEntries(Object.entries(session.turnAttribution).map(([source, metrics]) => [source, metrics])),
  };
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source)) inc(target, key, value);
}

function mergeUsage(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] || 0;
}

function mergeUsageBreakdown(target, source) {
  for (const category of Object.keys(target)) mergeUsage(target[category], source[category]);
}

function addToAggregate(agg, session) {
  agg.files += session.files;
  agg.sessions += session.entriesInWindow > 0 ? 1 : 0;
  agg.records += session.records;
  agg.entriesInWindow += session.entriesInWindow;
  agg.messages += session.messages;
  agg.assistantMessages += session.assistantMessages;
  agg.toolCalls += session.toolCalls;
  agg.toolResults += session.toolResults;
  agg.toolResultErrors += session.toolResultErrors;
  agg.nestedToolResults += session.nestedToolResults;
  agg.contentCharacters += session.contentCharacters;
  agg.toolResultCharacters += session.toolResultCharacters;
  agg.imagePayloadBytes += session.imagePayloadBytes;
  agg.compactions += session.compactions;
  agg.compactionTokensBefore.push(...session.compactionTokensBefore);
  agg.branchSummaries += session.branchSummaries;
  mergeCounts(agg.roles, session.roles);
  mergeCounts(agg.roleContentCharacters, session.roleContentCharacters);
  mergeCounts(agg.providers, session.providers);
  mergeCounts(agg.models, session.models);
  mergeCounts(agg.stopReasons, session.stopReasons);
  mergeCounts(agg.toolCallsByName, session.toolCallsByName);
  mergeCounts(agg.toolResultsByName, session.toolResultsByName);
  mergeUsageBreakdown(agg.usage, session.usage);
}

function newHeuristicAggregate() {
  return {
    activity: { activeTimeProxyMs: 0, parallelAdjustedObservedToolTimeMs: 0 },
    toolCategories: Object.create(null),
    repeatedEquivalentCalls: { groups: 0, extraCalls: 0, repeatedErrors: 0 },
    browser: {
      calls: 0,
      blockers: emptyCounts(),
      afterAnyErrorOrBlocker: { incidents: 0, subsequentCalls: 0, maximumSubsequentCalls: 0, subsequentObservedDurationMs: 0 },
      afterHighConfidenceAccessBlocker: { incidents: 0, subsequentCalls: 0, maximumSubsequentCalls: 0, subsequentObservedDurationMs: 0 },
      snapshotOrScreenshotCalls: 0,
    },
    turnAttribution: Object.create(null),
  };
}

function addLoopMetrics(target, source) {
  target.incidents += source.incidents;
  target.subsequentCalls += source.subsequentCalls;
  target.maximumSubsequentCalls = Math.max(target.maximumSubsequentCalls, source.maximumSubsequentCalls);
  target.subsequentObservedDurationMs += source.subsequentObservedDurationMs;
}

function addSessionHeuristics(target, source) {
  target.activity.activeTimeProxyMs += source.activeTimeProxyMs;
  target.activity.parallelAdjustedObservedToolTimeMs += source.parallelAdjustedObservedToolTimeMs;
  for (const [category, metrics] of Object.entries(source.toolCategories)) {
    target.toolCategories[category] ??= { calls: 0, errors: 0, resultCharacters: 0, cumulativeObservedDurationMs: 0, parallelAdjustedObservedDurationMs: 0 };
    for (const key of Object.keys(metrics)) target.toolCategories[category][key] += metrics[key];
  }
  for (const key of Object.keys(source.repeatedEquivalentCalls)) target.repeatedEquivalentCalls[key] += source.repeatedEquivalentCalls[key];
  target.browser.calls += source.browser.calls;
  mergeCounts(target.browser.blockers, source.browser.blockers);
  addLoopMetrics(target.browser.afterAnyErrorOrBlocker, source.browser.afterAnyErrorOrBlocker);
  addLoopMetrics(target.browser.afterHighConfidenceAccessBlocker, source.browser.afterHighConfidenceAccessBlocker);
  target.browser.snapshotOrScreenshotCalls += source.browser.snapshotOrScreenshotCalls;
  for (const [sourceName, metrics] of Object.entries(source.turnAttribution)) {
    target.turnAttribution[sourceName] ??= newTurnAttribution();
    const attribution = target.turnAttribution[sourceName];
    attribution.turns += metrics.turns;
    attribution.promptCharacters += metrics.promptCharacters;
    attribution.assistantMessages += metrics.assistantMessages;
    attribution.toolCalls += metrics.toolCalls;
    mergeUsage(attribution.usage, metrics.usage);
  }
}

function newAggregate() {
  return {
    files: 0,
    sessions: 0,
    records: 0,
    entriesInWindow: 0,
    messages: 0,
    roles: emptyCounts(),
    assistantMessages: 0,
    usage: newUsageBreakdown(),
    toolCalls: 0,
    toolResults: 0,
    toolResultErrors: 0,
    nestedToolResults: 0,
    contentCharacters: 0,
    roleContentCharacters: emptyCounts(),
    toolResultCharacters: 0,
    imagePayloadBytes: 0,
    compactions: 0,
    compactionTokensBefore: [],
    branchSummaries: 0,
    providers: emptyCounts(),
    models: emptyCounts(),
    stopReasons: emptyCounts(),
    toolCallsByName: emptyCounts(),
    toolResultsByName: emptyCounts(),
  };
}

function sortedObject(counts) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function numericSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, minimum: 0, median: 0, maximum: 0 };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: sorted.length, minimum: sorted[0], median, maximum: sorted.at(-1) };
}

function topSummary(counts) {
  return Object.entries(sortedObject(counts)).map(([id, count]) => ({ id, count }));
}

function serializeAggregate(agg) {
  return {
    files: agg.files,
    sessions: agg.sessions,
    records: agg.records,
    entriesInWindow: agg.entriesInWindow,
    messages: agg.messages,
    roles: sortedObject(agg.roles),
    assistantMessages: agg.assistantMessages,
    usage: agg.usage,
    toolCalls: agg.toolCalls,
    toolResults: agg.toolResults,
    toolResultErrors: agg.toolResultErrors,
    nestedToolResults: agg.nestedToolResults,
    contentCharacters: agg.contentCharacters,
    roleContentCharacters: sortedObject(agg.roleContentCharacters),
    toolResultCharacters: agg.toolResultCharacters,
    imagePayloadBytes: agg.imagePayloadBytes,
    compactions: agg.compactions,
    compactionTokensBefore: numericSummary(agg.compactionTokensBefore),
    branchSummaries: agg.branchSummaries,
  };
}

function serializeSession(session, alias) {
  return {
    alias,
    kind: session.kind,
    workspaceLabel: session.workspaceLabel,
    entriesInWindow: session.entriesInWindow,
    messages: session.messages,
    roles: sortedObject(session.roles),
    assistantMessages: session.assistantMessages,
    usage: session.usage,
    toolCalls: session.toolCalls,
    toolResults: session.toolResults,
    toolResultErrors: session.toolResultErrors,
    nestedToolResults: session.nestedToolResults,
    contentCharacters: session.contentCharacters,
    roleContentCharacters: sortedObject(session.roleContentCharacters),
    toolResultCharacters: session.toolResultCharacters,
    imagePayloadBytes: session.imagePayloadBytes,
    compactions: session.compactions,
    compactionTokensBefore: numericSummary(session.compactionTokensBefore),
    branchSummaries: session.branchSummaries,
    startTimestamp: session.firstTimestampMs === undefined ? null : new Date(session.firstTimestampMs).toISOString(),
    endTimestamp: session.lastTimestampMs === undefined ? null : new Date(session.lastTimestampMs).toISOString(),
    providers: sortedObject(session.providers),
    models: sortedObject(session.models),
    stopReasons: sortedObject(session.stopReasons),
    toolCallsByName: sortedObject(session.toolCallsByName),
    toolResultsByName: sortedObject(session.toolResultsByName),
    heuristics: session.heuristics,
  };
}

async function analyze(options) {
  const snapshotMs = Date.now();
  const cutoffMs = snapshotMs - options.days * 24 * 60 * 60 * 1000;
  const root = path.resolve(resolveTilde(options.sessionDir || defaultSessionDir()));
  const rootStat = await fsp.stat(root).catch((error) => {
    if (error && ["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw new Error(`session root is not readable (${error.code})`);
    throw new Error("session root is not readable");
  });
  if (!rootStat.isDirectory()) throw new Error("session root is not a directory");

  const diagnostics = {
    filesDiscovered: 0,
    filesRead: 0,
    filesWithWindowEntries: 0,
    linesRead: 0,
    emptyLines: 0,
    malformedRecords: 0,
    recordsWithoutTimestamp: 0,
    recordsOutsideWindow: 0,
    readErrors: 0,
  };
  const sessions = [];
  let scanIndex = 0;

  for await (const filePath of walkJsonlFiles(root)) {
    diagnostics.filesDiscovered += 1;
    const stats = newStats(isSubagentPath(filePath, root) ? "subagent" : "parent", scanIndex++);
    let hadWindowEntry = false;
    try {
      diagnostics.filesRead += 1;
      const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        diagnostics.linesRead += 1;
        if (!line.trim()) {
          diagnostics.emptyLines += 1;
          continue;
        }
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          diagnostics.malformedRecords += 1;
          stats.malformedRecords += 1;
          continue;
        }
        if (record?.type === "session") stats.workspaceLabel = classifyWorkspace(record.cwd);
        const timestampMs = timestampOf(record);
        if (timestampMs === undefined) {
          diagnostics.recordsWithoutTimestamp += 1;
          continue;
        }
        if (timestampMs < cutoffMs || timestampMs > snapshotMs) {
          diagnostics.recordsOutsideWindow += 1;
          continue;
        }
        hadWindowEntry = true;
        applyRecord(stats, record, timestampMs);
      }
    } catch {
      diagnostics.readErrors += 1;
      continue;
    }
    if (hadWindowEntry) {
      diagnostics.filesWithWindowEntries += 1;
      sessions.push(stats);
    }
  }

  sessions.sort((a, b) =>
    (a.firstTimestampMs ?? 0) - (b.firstTimestampMs ?? 0) ||
    (a.lastTimestampMs ?? 0) - (b.lastTimestampMs ?? 0) ||
    a.kind.localeCompare(b.kind) ||
    a.scanIndex - b.scanIndex
  );

  const global = newAggregate();
  const byKind = { parent: newAggregate(), subagent: newAggregate() };
  const globalHeuristics = newHeuristicAggregate();
  const heuristicsByKind = { parent: newHeuristicAggregate(), subagent: newHeuristicAggregate() };
  for (const session of sessions) {
    addToAggregate(global, session);
    addToAggregate(byKind[session.kind], session);
    session.heuristics = sessionHeuristics(session);
    addSessionHeuristics(globalHeuristics, session.heuristics);
    addSessionHeuristics(heuristicsByKind[session.kind], session.heuristics);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(snapshotMs).toISOString(),
    window: {
      days: options.days,
      snapshot: new Date(snapshotMs).toISOString(),
      cutoff: new Date(cutoffMs).toISOString(),
      inclusion: "entry timestamps within [cutoff, snapshot]",
    },
    methodology: {
      exact: [
        "JSONL files discovered/read",
        "well-formed records with timestamps in the analysis window",
        "message roles and usage fields reported by assistant, tool-result, compaction, and branch-summary records",
        "tool call/result counters and sanitized tool-name frequencies present in session records",
        "content and tool-result character totals plus decoded image payload byte totals from structured content",
        "compaction and branch-summary records when represented by explicit record types/fields",
      ],
      heuristic: [
        `activeTimeProxyMs sums gaps between sorted in-window timestamps capped at ${ACTIVE_GAP_CAP_MS} ms`,
        "tool categories are inferred from sanitized tool names and transient argument inspection",
        "parallelAdjustedObservedToolTimeMs unions matched call/result intervals within each session",
        "repeated-equivalent calls normalize volatile identifiers and numbers before comparison within a user turn",
        "browser blockers use conservative login/authentication, inaccessible/timeout, and tool-error patterns",
        "turn attribution recognizes the known automatic-verification prefix; all other parent turns remain humanOrUnknown",
        "workspace labels are coarse classifications inferred from cwd and never expose cwd itself",
      ],
      interpretation: [
        "sessionReportedEstimatedCost is an exact copy of session-reported usage estimates, not proof of an amount billed",
        "heuristic classifications are directional diagnostics and must not be presented as exact causal attribution",
      ],
    },
    privacy: {
      guarantees: [
        "No source filenames, session IDs, UUIDs, prompt text, tool arguments, tool result payloads, error details, current-working-directory values, screenshots, or absolute paths are emitted.",
        "Workspace values are reduced to fixed labels only.",
        "Tool, model, and provider identifiers are emitted only when they match a conservative safe identifier pattern; otherwise they become other.",
        "Session aliases are deterministic within this report and do not encode file names or session IDs.",
      ],
      workspaceLabels: ["wordpress-project", "pi-repository", "system-directory", "home-workspace", "other-workspace", "unknown"],
    },
    diagnostics,
    totals: serializeAggregate(global),
    parentTotals: serializeAggregate(byKind.parent),
    subagentTotals: serializeAggregate(byKind.subagent),
    heuristics: {
      all: globalHeuristics,
      parent: heuristicsByKind.parent,
      subagent: heuristicsByKind.subagent,
    },
    modelSummary: topSummary(global.models),
    providerSummary: topSummary(global.providers),
    toolCallSummary: topSummary(global.toolCallsByName),
    toolResultSummary: topSummary(global.toolResultsByName),
    stopReasonSummary: topSummary(global.stopReasons),
    sessions: sessions.map((session, index) => serializeSession(session, `S-${String(index + 1).padStart(3, "0")}`)),
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    console.error(usage());
    return;
  }

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  try {
    const report = await analyze(options);
    const json = JSON.stringify(report, null, options.pretty ? 2 : 0) + "\n";
    if (options.output) {
      const outputPath = path.resolve(resolveTilde(options.output));
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, json, "utf8");
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    fail(error.message || "fatal error");
  }
}

main();

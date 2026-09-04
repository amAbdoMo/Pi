import { createHash, createHmac } from "node:crypto";
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersion, resolveAgentDir } from "../scripts/bootstrap/contracts.mjs";
import { readJson } from "../scripts/bootstrap/files.mjs";
import { PiBridge, resolvePiInvocation } from "./pi-bridge.mjs";
import { createAccountManager } from "./account-settings.mjs";
import { pickDirectory } from "./directory-picker.mjs";
import { readModelDefault, writeModelDefault } from "./model-default.mjs";
import { mutateMcpSettings, readMcpSettings, testMcpServerConnection } from "./mcp-settings.mjs";
import {
  beginTaskEdits,
  completeTaskEdits,
  disposeTaskEdits,
  publicTaskEditSummary,
  taskEditPatch,
  undoTaskEdits,
} from "./task-edits.mjs";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_BROWSER_COMMAND_BYTES,
  decodedBase64Size,
  validateAttachmentList,
} from "./public/attachment-contract.js";
import {
  formatPromptWithReferences,
  textReferenceBytes,
  validateTextReferenceList,
} from "./public/reference-contract.js";
import {
  DIALOG_UI_METHODS,
  normalizeExtensionUiRequest,
} from "./public/extension-ui-contract.js";
import {
  SecurityError,
  acquireWriterLock,
  assertLoopbackRequest,
  loadOrCreatePrivateToken,
  readJsonBody,
  resolveStaticPath,
  setSecurityHeaders,
  tokensEqual,
} from "./security.mjs";
import { SessionCatalog } from "./session-catalog.mjs";
import {
  WORKBENCH_EXTENSIONS,
  globalSettingsPath,
  readExtensionSettings,
  writeExtensionSettings,
} from "./extension-settings.mjs";
import {
  normalizeProviderRemoval,
  readProviderSettings,
  removeProviderSettings,
  writeProviderSettings,
} from "./provider-settings.mjs";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PUBLIC_DIR = path.join(SOURCE_ROOT, "browser", "public");
const COOKIE_PREFIX = "pi_harness";
const AUTH_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const COMMANDS = new Set([
  "prompt", "steer", "follow_up", "abort", "clear_queue", "get_messages",
  "set_model", "cycle_model", "get_available_models", "set_thinking_level", "cycle_thinking_level",
  "get_available_thinking_levels", "get_commands", "set_steering_mode", "set_follow_up_mode", "compact",
  "set_auto_compaction", "set_auto_retry", "abort_retry", "get_session_stats", "get_fork_messages",
  "set_session_name", "extension_ui_response",
]);
const SENSITIVE_FIELD = /(?:api[-_]?key|authorization|cookie|credential|password|secret|(?:access|refresh|auth|bearer)[-_]?token|^token$|session(?:file|path)|^session[-_]?id$|cwd|working[-_]?directory|extension[-_]?path|source[-_]?path|spill[-_]?path|process[-_]?id|^pid$|fullOutputPath)/i;
const PUBLIC_EVENT_TYPES = new Set([
  "agent_start", "agent_end", "agent_settled", "turn_start", "turn_end",
  "message_start", "message_update", "message_end", "bash_execution_update",
  "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update",
  "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end",
  "summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished",
  "extension_error", "extension_ui_request", "browser_error", "workspace_edit_summary", "session_changed", "account_login",
]);
const IMAGE_COMMANDS = new Set(["prompt", "steer", "follow_up"]);
const MAX_PENDING_UI_REQUESTS = 16;
const NO_ARGUMENT_COMMANDS = new Set([
  "abort", "clear_queue", "get_messages", "cycle_model", "get_available_models",
  "cycle_thinking_level", "get_available_thinking_levels", "get_commands", "abort_retry",
  "get_session_stats", "get_fork_messages",
]);
const MAX_MESSAGE_CHARS = 64 * 1024;
const INTERNAL_COMMAND_PREFIX = "pi-browser-";
const INTERNAL_RELOAD_COMMAND = `${INTERNAL_COMMAND_PREFIX}reload-runtime`;
const INTERNAL_APPROVAL_COMMAND = `${INTERNAL_COMMAND_PREFIX}set-approval-mode`;
const APPROVAL_MODES = new Set(["read-only", "workspace-write", "full-access"]);
const MODEL_SELECTOR_COMMANDS = new Set([
  "set_model", "cycle_model", "get_available_models",
  "set_thinking_level", "cycle_thinking_level", "get_available_thinking_levels",
]);
const MODEL_PREFERENCE_COMMANDS = new Set(["set_model", "cycle_model", "set_thinking_level", "cycle_thinking_level"]);
const MANUAL_COMPACTION_TIMEOUT_MS = 5 * 60 * 1000;
const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(response, statusCode, payload) {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const statusCode = error instanceof SecurityError ? error.statusCode : 500;
  const message = statusCode >= 500 ? "Pi Harness encountered an internal error" : error.message;
  sendJson(response, statusCode, { error: message, code: error.code ?? "INTERNAL_ERROR" });
}

function requireJson(request) {
  const type = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new SecurityError("JSON content type required", 415, "UNSUPPORTED_MEDIA_TYPE");
}

function cookieValue(request, name) {
  const header = String(request.headers.cookie ?? "");
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}

function lockName(scope) {
  return `${createHash("sha256").update(scope).digest("hex").slice(0, 32)}.lock`;
}

function draftSessionId(scope, secret) {
  return `w_${createHmac("sha256", secret).update(scope).digest("base64url").slice(0, 32)}`;
}

function assertExtensionStates(enabled) {
  const ids = new Set(WORKBENCH_EXTENSIONS.map((extension) => extension.id));
  if (!enabled || typeof enabled !== "object" || Array.isArray(enabled)
    || Object.keys(enabled).length !== ids.size
    || Object.keys(enabled).some((id) => !ids.has(id))
    || Object.values(enabled).some((value) => typeof value !== "boolean")) {
    throw new SecurityError("Extension states are invalid", 400, "INVALID_EXTENSIONS");
  }
}

export function redactBrowserEvent(value, key = "", depth = 0) {
  if (SENSITIVE_FIELD.test(key)) return "[REDACTED]";
  if (value === null || typeof value !== "object") return value;
  if (depth >= 20) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((entry) => redactBrowserEvent(entry, "", depth + 1));
  return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, redactBrowserEvent(childValue, childKey, depth + 1)]));
}

export function publicBrowserEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
    return { type: "browser_error", error: "Pi sent an invalid event" };
  }
  if (event.type === "extension_ui_request") {
    try { return normalizeExtensionUiRequest(redactBrowserEvent(event)); }
    catch (error) {
      if (error instanceof TypeError) return { type: "browser_error", error: error.message };
      throw error;
    }
  }
  if (PUBLIC_EVENT_TYPES.has(event.type)) return redactBrowserEvent(event);
  const eventType = /^[A-Za-z0-9_.:-]{1,128}$/.test(event.type) ? event.type : "unknown";
  return { type: "pi_custom_event", eventType };
}

function decodeCanonicalBase64(encoded) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new TypeError("Image data must use canonical base64");
  return new Uint8Array(bytes);
}

function normalizeExtensionUiResponse(command) {
  const allowedKeys = new Set(["type", "id", "value", "confirmed", "cancelled"]);
  if (Object.keys(command).some((key) => !allowedKeys.has(key))) {
    throw new SecurityError("Interaction response contains unsupported fields", 400, "INVALID_COMMAND");
  }
  if (typeof command.id !== "string" || !command.id || command.id.length > 256) {
    throw new SecurityError("Interaction response ID is invalid", 400, "INVALID_COMMAND");
  }
  const responses = [typeof command.value === "string", typeof command.confirmed === "boolean", command.cancelled === true];
  if (responses.filter(Boolean).length !== 1 || (typeof command.value === "string" && command.value.length > MAX_MESSAGE_CHARS)) {
    throw new SecurityError("Interaction response value is invalid", 400, "INVALID_COMMAND");
  }
  if (command.cancelled === true) return { type: command.type, id: command.id, cancelled: true };
  if (typeof command.confirmed === "boolean") return { type: command.type, id: command.id, confirmed: command.confirmed };
  return { type: command.type, id: command.id, value: command.value };
}

function validatedPromptAttachments(command) {
  let images;
  let references;
  try {
    images = validateAttachmentList(command.images, decodeCanonicalBase64);
    references = validateTextReferenceList(command.references);
  } catch (error) {
    if (error instanceof TypeError) throw new SecurityError(error.message, 400, "INVALID_ATTACHMENT");
    throw error;
  }
  const count = (images?.length ?? 0) + (references?.length ?? 0);
  const imageBytes = (images ?? []).reduce((sum, image) => sum + decodedBase64Size(image.data), 0);
  const referenceBytes = (references ?? []).reduce((sum, reference) => sum + textReferenceBytes(reference), 0);
  if (count > MAX_ATTACHMENT_COUNT) throw new SecurityError("Too many attachments", 400, "INVALID_ATTACHMENT");
  if (imageBytes + referenceBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new SecurityError("Combined attachments are too large", 400, "INVALID_ATTACHMENT");
  }
  return { images, references };
}

function normalizePromptCommand(command) {
  const allowedKeys = new Set(["type", "message", "images", "references"]);
  if (Object.keys(command).some((key) => !allowedKeys.has(key))) {
    throw new SecurityError("Attachment commands contain unsupported fields", 400, "INVALID_COMMAND");
  }
  if (typeof command.message !== "string" || command.message.length > MAX_MESSAGE_CHARS) {
    throw new SecurityError("Prompt text is invalid or too large", 400, "INVALID_COMMAND");
  }
  if (command.message.trim().startsWith(`/${INTERNAL_COMMAND_PREFIX}`)) {
    throw new SecurityError("Internal browser command is not available", 403, "COMMAND_FORBIDDEN");
  }
  const { images, references } = validatedPromptAttachments(command);
  if (!command.message.trim() && !images && !references) {
    throw new SecurityError("Prompt text or an attachment is required", 400, "INVALID_COMMAND");
  }
  return {
    type: command.type,
    message: formatPromptWithReferences(command.message, references),
    ...(images ? { images } : {}),
  };
}

export function normalizeBrowserCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new SecurityError("Browser command must be an object", 400, "INVALID_COMMAND");
  }
  if (command.type === "extension_ui_response") return normalizeExtensionUiResponse(command);
  if (command.type === "compact") {
    const allowedKeys = new Set(["type", "customInstructions"]);
    if (Object.keys(command).some((key) => !allowedKeys.has(key))
      || (command.customInstructions !== undefined
        && (typeof command.customInstructions !== "string" || command.customInstructions.length > MAX_MESSAGE_CHARS))) {
      throw new SecurityError("Compaction command is invalid", 400, "INVALID_COMMAND");
    }
    return command.customInstructions === undefined
      ? { type: command.type }
      : { type: command.type, customInstructions: command.customInstructions };
  }
  if (command.type === "set_auto_compaction") {
    if (Object.keys(command).length !== 2 || typeof command.enabled !== "boolean") {
      throw new SecurityError("Auto-compaction command is invalid", 400, "INVALID_COMMAND");
    }
    return { type: command.type, enabled: command.enabled };
  }
  if (command.type === "set_session_name") {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (Object.keys(command).length !== 2 || !name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new SecurityError("Session name is invalid", 400, "INVALID_COMMAND");
    }
    return { type: command.type, name };
  }
  if (NO_ARGUMENT_COMMANDS.has(command.type)) {
    if (Object.keys(command).length !== 1) {
      throw new SecurityError("Browser command contains unsupported fields", 400, "INVALID_COMMAND");
    }
    return { type: command.type };
  }
  return IMAGE_COMMANDS.has(command.type) ? normalizePromptCommand(command) : command;
}

async function assertImageCommandSupported(bridge, command) {
  if (!command.images) return;
  const runtimeState = await bridge.request("get_state");
  if (!runtimeState?.data?.model?.input?.includes("image")) {
    throw new SecurityError("The active Pi model does not accept images", 409, "IMAGE_INPUT_UNSUPPORTED");
  }
}

function publicModel(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return model ?? null;
  const { provider, id, name, api, reasoning, input, contextWindow, maxTokens } = model;
  return { provider, id, name, api, reasoning, input, contextWindow, maxTokens };
}

function publicRuntimeState(runtimeState) {
  if (!runtimeState || typeof runtimeState !== "object" || Array.isArray(runtimeState)) return {};
  const { sessionFile: _sessionFile, sessionId: _sessionId, cwd: _cwd, model, ...safe } = runtimeState;
  return { ...safe, model: publicModel(model) };
}

function publicSessionStats(stats) {
  const output = {};
  for (const key of ["userMessages", "assistantMessages", "toolCalls", "toolResults", "totalMessages", "cost"]) {
    if (typeof stats[key] === "number" && Number.isFinite(stats[key]) && stats[key] >= 0) output[key] = stats[key];
  }
  if (stats.tokens && typeof stats.tokens === "object" && !Array.isArray(stats.tokens)) {
    output.tokens = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      if (typeof stats.tokens[key] === "number" && Number.isFinite(stats.tokens[key]) && stats.tokens[key] >= 0) {
        output.tokens[key] = stats.tokens[key];
      }
    }
  }
  const usage = stats.contextUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)
    && [usage.tokens, usage.contextWindow, usage.percent].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    output.contextUsage = { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: Math.min(usage.percent, 100) };
  }
  return output;
}

function publicCommandResult(command, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const output = { ...result };
  if (!output.data || typeof output.data !== "object" || Array.isArray(output.data)) return output;
  if (command.type === "get_available_models") {
    output.data = { models: Array.isArray(output.data.models) ? output.data.models.map(publicModel) : [] };
  } else if (command.type === "get_commands") {
    output.data = {
      commands: Array.isArray(output.data.commands)
        ? output.data.commands
          .filter(({ name }) => !name?.startsWith(INTERNAL_COMMAND_PREFIX))
          .map(({ name, description, source, location }) => ({ name, description, source, location }))
        : [],
    };
  } else if (command.type === "get_messages") {
    output.data = redactBrowserEvent(output.data);
  } else if (command.type === "get_session_stats") {
    output.data = publicSessionStats(output.data);
  } else if (command.type === "set_model") {
    output.data = publicModel(output.data);
  } else if (command.type === "cycle_model" && output.data.model) {
    output.data = { ...output.data, model: publicModel(output.data.model) };
  }
  return output;
}

function boundedEvent(event, maxBytes = 512 * 1024) {
  const encoded = JSON.stringify(event);
  if (Buffer.byteLength(encoded) <= maxBytes) return encoded;
  return JSON.stringify({ type: "browser_error", error: "Pi event exceeded the browser transport limit" });
}

async function existingDirectory(directory) {
  if (typeof directory !== "string" || directory.length === 0 || directory.length > 4096 || directory.includes("\0")) {
    throw new SecurityError("A valid project folder is required", 400, "INVALID_CWD");
  }
  let resolved;
  try {
    resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new SecurityError("Project folder does not exist", 400, "INVALID_CWD");
  }
  return resolved;
}

function piVersionFromManifest(sourceRoot) {
  const manifest = readJson(path.join(sourceRoot, "bootstrap-manifest.json"));
  return packageVersion(manifest.packages.pi);
}

async function openExternalUrl(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("Codex returned an invalid sign-in URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Codex returned an unsafe sign-in URL");
  const command = platform === "win32" ? "rundll32.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["url.dll,FileProtocolHandler", parsed.href] : [parsed.href];
  const child = spawnProcess(command, args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.once?.("error", () => {});
  child.unref?.();
}

function codingAgentRoot(invocation, env = process.env) {
  const candidates = [
    invocation?.kind === "node-cli" ? path.resolve(path.dirname(invocation.args[0]), "..") : undefined,
    env.PI_CLI_PACKAGE_JSON ? path.dirname(env.PI_CLI_PACKAGE_JSON) : undefined,
    env.PI_CODING_AGENT_PACKAGE_JSON ? path.dirname(env.PI_CODING_AGENT_PACKAGE_JSON) : undefined,
    env.APPDATA ? path.join(env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent") : undefined,
    env.npm_config_prefix ? path.join(env.npm_config_prefix, "node_modules", "@earendil-works", "pi-coding-agent") : undefined,
  ];
  return candidates.find(Boolean);
}

export function createPiBrowserServer({
  host = "127.0.0.1",
  port = 3081,
  agentDir = resolveAgentDir(),
  publicDir = DEFAULT_PUBLIC_DIR,
  sourceRoot = SOURCE_ROOT,
  bootstrapToken: suppliedBootstrapToken,
  browserSessionToken: suppliedBrowserSessionToken,
  bridgeFactory = (options) => new PiBridge(options),
  invocationFactory = (options) => resolvePiInvocation(options),
  accountManagerFactory = createAccountManager,
  loadCodexOAuth: injectedLoadCodexOAuth,
  openAccountLoginUrl = openExternalUrl,
  catalog: injectedCatalog,
  directoryPicker = pickDirectory,
  serverFactory = createServer,
} = {}) {
  if (host !== "127.0.0.1" && host !== "::1") throw new TypeError("Pi Harness must bind to a loopback address");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new TypeError("Invalid Pi Harness port");

  const sessionRoot = path.join(agentDir, "sessions");
  const lockRoot = path.join(agentDir, "browser-locks");
  const settingsPath = globalSettingsPath(agentDir);
  const modelsPath = path.join(agentDir, "models.json");
  const authPath = path.join(agentDir, "auth.json");
  const accountVaultPath = path.join(agentDir, "codex-accounts.json");
  const modelDefaultPath = path.join(agentDir, "browser-model-default.json");
  const bootstrapTokenPath = path.join(agentDir, "browser-bootstrap-token");
  const sessionTokenPath = path.join(agentDir, "browser-session-token");
  const catalogSecretPath = path.join(agentDir, "browser-session-id-secret");
  let bootstrapToken = suppliedBootstrapToken;
  let browserSessionToken = suppliedBrowserSessionToken;
  let cookieName;
  let catalog = injectedCatalog;
  let catalogIdSecret;
  const clients = new Set();
  const pendingUiRequests = new Map();
  let bridge;
  let selectorBridge;
  let bridgeUnsubscribe;
  let writerLock;
  let activeSessionId;
  let activeScope;
  let activeWorkspaceCwd;
  let activeSessionFile;
  let sessionWatcher;
  let sessionChangeTimer;
  let lastBridgeEventAt = 0;
  let taskEditCapture;
  let taskEditCompletion = Promise.resolve();
  const taskEditSummaries = new Map();
  let server;
  let stopping;
  let extensionsApplying = false;
  let workspacePickerActive = false;
  let providersApplying = false;
  let mcpApplying = false;
  let accountsApplying = false;
  let accountLoginController;
  let accountLoginPromise = Promise.resolve();
  let accountLoginState = { status: "idle" };
  let approvalMode = "workspace-write";
  let sessionSwitch = Promise.resolve();
  const loadCodexOAuth = injectedLoadCodexOAuth ?? (async () => {
    const invocation = invocationFactory({ expectedVersion: piVersionFromManifest(sourceRoot) });
    const packageRoot = codingAgentRoot(invocation);
    if (!packageRoot) throw new Error("Unable to locate Pi's Codex OAuth implementation");
    const modulePath = path.join(packageRoot, "node_modules", "@earendil-works", "pi-ai", "dist", "auth", "oauth", "openai-codex.js");
    const loaded = await import(pathToFileURL(modulePath).href);
    if (!loaded.openaiCodexOAuth) throw new Error("Pi's Codex OAuth implementation is unavailable");
    return loaded.openaiCodexOAuth;
  });
  const accountManager = accountManagerFactory({
    vaultPath: accountVaultPath,
    authPath,
    loadOAuth: loadCodexOAuth,
    openUrl: openAccountLoginUrl,
  });

  function authenticate(request) {
    const supplied = cookieValue(request, cookieName);
    if (!browserSessionToken || !tokensEqual(supplied, browserSessionToken)) {
      throw new SecurityError("Authentication required", 401, "AUTH_REQUIRED");
    }
  }

  function rememberUiRequest(event) {
    if (event.type === "agent_settled") pendingUiRequests.clear();
    if (event.type !== "extension_ui_request" || !DIALOG_UI_METHODS.has(event.method)) return;
    if (typeof event.id !== "string" || !event.id || pendingUiRequests.has(event.id)) return;
    if (pendingUiRequests.size >= MAX_PENDING_UI_REQUESTS) pendingUiRequests.delete(pendingUiRequests.keys().next().value);
    pendingUiRequests.set(event.id, event);
  }

  function eventRecord(event) {
    return `data: ${boundedEvent(event)}\n\n`;
  }

  function broadcast(event) {
    const safeEvent = publicBrowserEvent(event);
    rememberUiRequest(safeEvent);
    const record = eventRecord(safeEvent);
    for (const response of [...clients]) {
      if (response.destroyed || response.writableEnded) clients.delete(response);
      else response.write(record);
    }
  }

  function stopSessionWatcher() {
    if (sessionChangeTimer) clearTimeout(sessionChangeTimer);
    sessionChangeTimer = undefined;
    sessionWatcher?.close();
    sessionWatcher = undefined;
    activeSessionFile = undefined;
  }

  function watchSessionChanges(sessionFile) {
    stopSessionWatcher();
    if (!sessionFile) return;
    const watchedFile = path.resolve(sessionFile);
    const directory = path.dirname(watchedFile);
    const filename = path.basename(watchedFile).toLowerCase();
    try {
      sessionWatcher = watch(directory, { persistent: false }, (_eventType, changedFile) => {
        if (activeSessionFile !== watchedFile) return;
        if (changedFile && String(changedFile).toLowerCase() !== filename) return;
        if (sessionChangeTimer) clearTimeout(sessionChangeTimer);
        sessionChangeTimer = setTimeout(() => {
          sessionChangeTimer = undefined;
          if (activeSessionFile === watchedFile && Date.now() - lastBridgeEventAt >= 400) {
            broadcast({ type: "session_changed" });
          }
        }, 120);
      });
      activeSessionFile = watchedFile;
      sessionWatcher.on("error", () => stopSessionWatcher());
    } catch {
      stopSessionWatcher();
    }
  }

  async function beginTaskEditTracking() {
    await taskEditCompletion;
    if (!activeWorkspaceCwd || taskEditCapture) return;
    try {
      taskEditCapture = await beginTaskEdits(activeWorkspaceCwd);
      if (taskEditCapture) taskEditCapture.browserSessionId = activeSessionId;
    }
    catch { taskEditCapture = undefined; }
  }

  async function completeTaskEditTracking() {
    const capture = taskEditCapture;
    taskEditCapture = undefined;
    if (!capture) return;
    try {
      const summary = await completeTaskEdits(capture);
      if (!summary) return;
      summary.browserSessionId = capture.browserSessionId;
      taskEditSummaries.set(summary.id, summary);
      while (taskEditSummaries.size > 20) {
        const oldestId = taskEditSummaries.keys().next().value;
        const oldest = taskEditSummaries.get(oldestId);
        taskEditSummaries.delete(oldestId);
        await disposeTaskEdits(oldest);
      }
      broadcast({ type: "workspace_edit_summary", ...publicTaskEditSummary(summary) });
    } catch {
      await disposeTaskEdits(capture).catch(() => {});
      broadcast({ type: "browser_error", error: "Task edit summary could not be created" });
    }
  }

  function taskEditSummary(summaryId) {
    const summary = taskEditSummaries.get(summaryId);
    if (!summary || summary.browserSessionId !== activeSessionId) {
      throw new SecurityError("Task edit summary is unavailable", 404, "TASK_EDIT_NOT_FOUND");
    }
    return summary;
  }

  async function currentModelDefault() {
    try { return await readModelDefault(modelDefaultPath); }
    catch (error) {
      if (error?.code === "INVALID_MODEL_DEFAULT") {
        await unlink(modelDefaultPath).catch(() => {});
        broadcast({ type: "browser_error", error: "Saved model default was invalid and has been reset" });
      } else {
        broadcast({ type: "browser_error", error: "Saved model default could not be read" });
      }
      return null;
    }
  }

  function modelDefaultFromState(runtimeState) {
    const model = runtimeState?.model;
    const thinkingLevel = runtimeState?.thinkingLevel;
    if (!model?.provider || !model?.id || !thinkingLevel) return null;
    return { provider: model.provider, modelId: model.id, ...(model.name ? { name: model.name } : {}), thinkingLevel };
  }

  async function persistModelDefault(targetBridge) {
    const result = await targetBridge.request("get_state");
    const runtimeState = result.data ?? result;
    const preference = modelDefaultFromState(runtimeState);
    if (preference) await writeModelDefault(modelDefaultPath, preference);
    return runtimeState;
  }

  async function applyModelDefault(targetBridge, initialState) {
    const preference = await currentModelDefault();
    if (!preference) return initialState;
    try {
      await targetBridge.command({ type: "set_model", provider: preference.provider, modelId: preference.modelId });
      await targetBridge.command({ type: "set_thinking_level", level: preference.thinkingLevel });
      return await persistModelDefault(targetBridge);
    } catch {
      const fallbackResult = await targetBridge.request("get_state");
      const fallback = fallbackResult.data ?? fallbackResult;
      const repaired = modelDefaultFromState(fallback);
      if (repaired) await writeModelDefault(modelDefaultPath, repaired);
      return fallback;
    }
  }

  async function closeSelectorBridge(expectedBridge) {
    if (expectedBridge && selectorBridge !== expectedBridge) return;
    const closingBridge = selectorBridge;
    selectorBridge = undefined;
    await closingBridge?.dispose();
  }

  async function selectorBridgeUnlocked() {
    if (selectorBridge) return selectorBridge;
    const invocation = invocationFactory({ expectedVersion: piVersionFromManifest(sourceRoot) });
    const nextBridge = bridgeFactory({ invocation, cwd: agentDir, piArgs: ["--no-session"] });
    selectorBridge = nextBridge;
    nextBridge.on?.("bridgeError", (error) => {
      if (selectorBridge === nextBridge) {
        selectorBridge = undefined;
        void nextBridge.dispose().catch(() => {});
      }
      broadcast({ type: "browser_error", error: `Model selector failed: ${error.message}` });
    });
    try {
      nextBridge.start();
      const initial = await nextBridge.request("get_state", {}, { timeoutMs: 30_000 });
      await applyModelDefault(nextBridge, initial.data ?? initial);
      if (selectorBridge !== nextBridge) throw new Error("Model selector stopped during setup");
      return nextBridge;
    } catch (error) {
      if (selectorBridge === nextBridge) selectorBridge = undefined;
      await nextBridge.dispose().catch(() => {});
      throw error;
    }
  }

  async function inactiveRuntimeState() {
    if (selectorBridge) {
      const result = await selectorBridge.request("get_state");
      return publicRuntimeState(result.data ?? result);
    }
    const preference = await currentModelDefault();
    return preference ? {
      model: publicModel({ provider: preference.provider, id: preference.modelId, name: preference.name }),
      thinkingLevel: preference.thinkingLevel,
    } : {};
  }

  async function closeBridge(expectedBridge) {
    if (expectedBridge && bridge !== expectedBridge) return;
    const closingBridge = bridge;
    const closingUnsubscribe = bridgeUnsubscribe;
    const closingLock = writerLock;
    bridge = undefined;
    bridgeUnsubscribe = undefined;
    writerLock = undefined;
    activeSessionId = undefined;
    activeScope = undefined;
    activeWorkspaceCwd = undefined;
    stopSessionWatcher();
    const abandonedTaskCapture = taskEditCapture;
    taskEditCapture = undefined;
    pendingUiRequests.clear();

    let failure;
    try { await disposeTaskEdits(abandonedTaskCapture); }
    catch (error) { failure = error; }
    try {
      closingUnsubscribe?.();
      await closingBridge?.dispose();
    } catch (error) {
      failure ??= error;
    }
    try {
      await closingLock?.release();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }

  async function openSessionUnlocked(selection) {
    let cwd;
    let sessionPath;
    let sessionCwd;
    let scope;
    if (selection.sessionId) {
      await catalog.refresh();
      sessionPath = await catalog.resolve(selection.sessionId);
      if (!sessionPath) throw new SecurityError("Session is unavailable", 404, "SESSION_NOT_FOUND");
      sessionCwd = await catalog.cwdFor?.(selection.sessionId);
      scope = `session:${selection.sessionId}`;
    } else if (selection.cwd) {
      cwd = await existingDirectory(selection.cwd);
      scope = `cwd:${cwd}`;
    } else {
      throw new SecurityError("sessionId or cwd is required", 400, "INVALID_SESSION");
    }

    const browserSessionId = selection.sessionId ?? draftSessionId(scope, catalogIdSecret);
    if (scope === activeScope && bridge) {
      const currentState = await bridge.request("get_state");
      return { ...publicRuntimeState(currentState.data ?? currentState), browserSessionId };
    }

    await closeSelectorBridge();
    const nextLock = await acquireWriterLock(path.join(lockRoot, lockName(scope)));
    let nextBridge;
    let nextBridgeFailure;
    try {
      const invocation = invocationFactory({ expectedVersion: piVersionFromManifest(sourceRoot) });
      nextBridge = bridgeFactory({ invocation, cwd, piArgs: sessionPath ? ["--session", sessionPath] : [] });
      nextBridge.on?.("bridgeError", (error) => {
        nextBridgeFailure ??= error;
        if (bridge === nextBridge) {
          broadcast({ type: "browser_error", error: error.message });
          void closeBridge(nextBridge).catch((cleanupError) => {
            broadcast({ type: "browser_error", error: `Pi session cleanup failed: ${cleanupError.message}` });
          });
        }
      });
      nextBridge.start();
      const nextState = await nextBridge.request("get_state", {}, { timeoutMs: 30_000 });
      const nextRuntimeState = sessionPath
        ? nextState.data ?? nextState
        : await applyModelDefault(nextBridge, nextState.data ?? nextState);
      await setBridgeApprovalMode(nextBridge, approvalMode);
      if (nextBridgeFailure) throw nextBridgeFailure;
      await closeBridge();
      if (nextBridgeFailure) throw nextBridgeFailure;
      bridge = nextBridge;
      writerLock = nextLock;
      activeSessionId = browserSessionId;
      activeScope = scope;
      activeWorkspaceCwd = sessionCwd ?? cwd;
      watchSessionChanges(nextRuntimeState.sessionFile ?? sessionPath);
      bridgeUnsubscribe = bridge.subscribe((event) => {
        lastBridgeEventAt = Date.now();
        broadcast(event);
        if (event?.type === "agent_settled") {
          taskEditCompletion = completeTaskEditTracking();
          void taskEditCompletion;
        }
      });
      return { ...publicRuntimeState(nextRuntimeState), browserSessionId };
    } catch (error) {
      await nextBridge?.dispose().catch(() => {});
      await nextLock.release().catch(() => {});
      throw error;
    }
  }

  function sessionOperation(operation) {
    const pending = sessionSwitch.then(operation);
    sessionSwitch = pending.then(() => undefined, () => undefined);
    return pending;
  }

  function openSession(selection) {
    if (accountsApplying) throw new SecurityError("Wait for the Codex account update to finish", 409, "ACCOUNT_SETTINGS_BUSY");
    return sessionOperation(() => openSessionUnlocked(selection));
  }

  async function refreshActiveSessionUnlocked() {
    if (!bridge) return { active: false, reloaded: false };
    const current = await bridge.request("get_state");
    const runtime = current.data ?? current;
    if (runtime?.isStreaming || runtime?.isCompacting || !runtime?.sessionFile) {
      return { active: true, reloaded: false, state: publicRuntimeState(runtime) };
    }
    await catalog.refresh();
    const sessionId = await catalog.idForFile(runtime.sessionFile);
    if (!sessionId) return { active: true, reloaded: false, state: publicRuntimeState(runtime) };
    await closeBridge();
    return { active: true, reloaded: true, state: await openSessionUnlocked({ sessionId }) };
  }

  function refreshActiveSession() {
    return sessionOperation(async () => {
      if (!accountsApplying) return refreshActiveSessionUnlocked();
      if (!bridge) return { active: false, reloaded: false };
      const current = await bridge.request("get_state");
      return { active: true, reloaded: false, state: publicRuntimeState(current.data ?? current) };
    });
  }

  async function cloneActiveSession() {
    if (accountsApplying) throw new SecurityError("Wait for the Codex account update to finish", 409, "ACCOUNT_SETTINGS_BUSY");
    return sessionOperation(async () => {
      if (!bridge) throw new SecurityError("No active session", 409, "NO_ACTIVE_SESSION");
      const before = await bridge.request("get_state");
      if ((before.data ?? before)?.isStreaming) throw new SecurityError("Wait for Pi to finish before cloning", 409, "SESSION_BUSY");
      const result = await bridge.command({ type: "clone" });
      if (result?.success === false) {
        throw new SecurityError("Session cannot be cloned before it has a message", 409, "SESSION_CLONE_UNAVAILABLE");
      }
      if (result?.data?.cancelled) return { cancelled: true };
      const current = await bridge.request("get_state");
      const sessionFile = (current.data ?? current)?.sessionFile;
      await catalog.refresh();
      const sessionId = await catalog.idForFile(sessionFile);
      await closeBridge();
      if (!sessionId) throw new SecurityError("Cloned session is unavailable", 500, "SESSION_CLONE_FAILED");
      return { cancelled: false, state: await openSessionUnlocked({ sessionId }) };
    });
  }

  async function deleteSession(sessionId) {
    if (accountsApplying) throw new SecurityError("Wait for the Codex account update to finish", 409, "ACCOUNT_SETTINGS_BUSY");
    return sessionOperation(async () => {
      if (typeof sessionId !== "string" || sessionId.length > 64) {
        throw new SecurityError("Session ID is invalid", 400, "INVALID_SESSION");
      }
      const active = sessionId === activeSessionId;
      await catalog.refresh();
      let catalogId = sessionId;
      if (active) {
        const current = await bridge.request("get_state");
        catalogId = await catalog.idForFile((current.data ?? current)?.sessionFile);
        await closeBridge();
      }
      if (!catalogId) throw new SecurityError("Session is unavailable", 404, "SESSION_NOT_FOUND");
      const sessionPath = await catalog.resolve(catalogId);
      if (!sessionPath) throw new SecurityError("Session is unavailable", 404, "SESSION_NOT_FOUND");
      const deletionLock = await acquireWriterLock(path.join(lockRoot, lockName(`session:${catalogId}`)));
      try { await unlink(sessionPath); }
      finally { await deletionLock.release(); }
      await catalog.refresh();
      return { deletedSessionId: sessionId, activeClosed: active };
    });
  }

  function extensionSettingsFailure(error) {
    if (error?.code === "ENOENT") {
      return new SecurityError("Global Pi settings are unavailable", 409, "EXTENSION_SETTINGS_INVALID");
    }
    if (error instanceof TypeError) {
      return new SecurityError(error.message, 409, "EXTENSION_SETTINGS_INVALID");
    }
    if (error?.code === "EEXIST") {
      return new SecurityError("Pi settings are busy; try again", 409, "EXTENSION_SETTINGS_BUSY");
    }
    return error;
  }

  async function currentExtensions() {
    try { return await readExtensionSettings(settingsPath); }
    catch (error) { throw extensionSettingsFailure(error); }
  }

  function setBridgeApprovalMode(targetBridge, mode) {
    return targetBridge.command({ type: "prompt", message: `/${INTERNAL_APPROVAL_COMMAND} ${mode}` });
  }

  async function setApprovalMode(mode) {
    if (!bridge) {
      approvalMode = mode;
      return { mode, applied: false };
    }
    const current = await bridge.request("get_state");
    const runtime = current.data ?? current;
    if (runtime?.isStreaming || runtime?.isCompacting) {
      throw new SecurityError("Wait for Pi to finish before changing tool access", 409, "SESSION_BUSY");
    }
    await setBridgeApprovalMode(bridge, mode);
    approvalMode = mode;
    return { mode, applied: true };
  }

  async function applyExtensionsUnlocked(enabled) {
    if (extensionsApplying) throw new SecurityError("Extensions are already being applied", 409, "EXTENSION_SETTINGS_BUSY");
    extensionsApplying = true;
    try {
      if (bridge) {
        const current = await bridge.request("get_state");
        const runtime = current.data ?? current;
        if (runtime?.isStreaming || runtime?.isCompacting) {
          throw new SecurityError("Wait for Pi to finish before reloading extensions", 409, "SESSION_BUSY");
        }
      }
      let extensions;
      try { extensions = await writeExtensionSettings(settingsPath, enabled); }
      catch (error) { throw extensionSettingsFailure(error); }
      await closeSelectorBridge();
      if (!bridge) return { extensions, reloaded: false };
      try {
        await bridge.command({ type: "prompt", message: `/${INTERNAL_RELOAD_COMMAND}` });
        await setBridgeApprovalMode(bridge, approvalMode);
        return { extensions, reloaded: true };
      } catch {
        throw new SecurityError("Extensions were saved, but Pi could not reload. Run /reload in other open Pi sessions.", 503, "EXTENSION_RELOAD_FAILED");
      }
    } finally {
      extensionsApplying = false;
    }
  }

  function applyExtensions(enabled) {
    return sessionOperation(() => applyExtensionsUnlocked(enabled));
  }

  function providerSettingsFailure(error) {
    if (error instanceof TypeError) {
      const status = error.code === "PROVIDER_NOT_FOUND" ? 404 : 400;
      return new SecurityError(error.message, status, error.code ?? "INVALID_PROVIDER");
    }
    if (error?.code === "ELOCKED") {
      return new SecurityError("Provider settings are busy; try again", 409, "PROVIDER_SETTINGS_BUSY");
    }
    return error;
  }

  function accountSettingsFailure(error) {
    if (error instanceof SecurityError) return error;
    if (error?.code === "ELOCKED") return new SecurityError("Account settings are busy; try again", 409, "ACCOUNT_SETTINGS_BUSY");
    if (error instanceof TypeError) {
      const status = error.code === "ACCOUNT_NOT_FOUND" ? 404
        : error.code === "ACCOUNT_LOGIN_CANCELLED" ? 409
        : error.code === "ACCOUNT_LOGIN_UNAVAILABLE" ? 503
        : 400;
      return new SecurityError(error.message, status, error.code ?? "INVALID_ACCOUNT");
    }
    return new SecurityError("Codex account operation failed", 500, "ACCOUNT_SETTINGS_FAILED");
  }

  async function captureAccountRuntime() {
    if (!bridge) return null;
    const current = await bridge.request("get_state");
    const runtime = current.data ?? current;
    if (runtime?.isStreaming || runtime?.isCompacting) {
      throw new SecurityError("Wait for Pi to finish before switching accounts", 409, "SESSION_BUSY");
    }
    await catalog.refresh();
    return {
      sessionId: runtime.sessionFile ? await catalog.idForFile(runtime.sessionFile) : null,
      cwd: activeWorkspaceCwd,
      model: runtime.model,
      thinkingLevel: runtime.thinkingLevel,
    };
  }

  async function restoreRuntimeSelection(previousRuntime, reopenedState) {
    if (!bridge) return reopenedState;
    if (previousRuntime.model?.provider && previousRuntime.model?.id
      && (reopenedState.model?.provider !== previousRuntime.model.provider || reopenedState.model?.id !== previousRuntime.model.id)) {
      await bridge.command({ type: "set_model", provider: previousRuntime.model.provider, modelId: previousRuntime.model.id });
    }
    if (previousRuntime.thinkingLevel && reopenedState.thinkingLevel !== previousRuntime.thinkingLevel) {
      await bridge.command({ type: "set_thinking_level", level: previousRuntime.thinkingLevel });
    }
    const restored = await bridge.request("get_state");
    return publicRuntimeState(restored.data ?? restored);
  }

  async function restartForAccountChangeUnlocked(previousRuntime) {
    await closeSelectorBridge();
    if (!previousRuntime) return { reloaded: false, state: await inactiveRuntimeState() };
    if (bridge) await closeBridge();
    const reopenedState = previousRuntime.sessionId
      ? await openSessionUnlocked({ sessionId: previousRuntime.sessionId })
      : previousRuntime.cwd ? await openSessionUnlocked({ cwd: previousRuntime.cwd }) : await inactiveRuntimeState();
    return { reloaded: true, state: await restoreRuntimeSelection(previousRuntime, reopenedState) };
  }

  async function listAccounts() {
    try { return { accounts: await accountManager.listAccounts() }; }
    catch (error) { throw accountSettingsFailure(error); }
  }

  async function refreshAccountUsageUnlocked(accountId) {
    if (accountsApplying) throw new SecurityError("Account settings are busy", 409, "ACCOUNT_SETTINGS_BUSY");
    accountsApplying = true;
    try {
      return { accounts: await accountManager.refreshUsage(accountId) };
    } catch (error) {
      throw accountSettingsFailure(error);
    } finally {
      accountsApplying = false;
    }
  }

  async function activateAccountUnlocked(accountId) {
    if (accountsApplying) throw new SecurityError("Account settings are busy", 409, "ACCOUNT_SETTINGS_BUSY");
    accountsApplying = true;
    let previousActiveId;
    let previousRuntime;
    try {
      previousRuntime = await captureAccountRuntime();
      const activation = await accountManager.activateAccount(accountId);
      previousActiveId = activation.previousActiveId;
      const runtime = await restartForAccountChangeUnlocked(previousRuntime);
      return { accounts: activation.accounts, ...runtime };
    } catch (error) {
      if (previousActiveId && previousActiveId !== accountId) {
        try {
          await accountManager.activateAccount(previousActiveId);
          await restartForAccountChangeUnlocked(previousRuntime);
        } catch {
          throw new SecurityError("Account switching failed and could not be rolled back", 500, "ACCOUNT_ROLLBACK_FAILED");
        }
      }
      throw accountSettingsFailure(error);
    } finally {
      accountsApplying = false;
    }
  }

  async function renameAccountUnlocked(accountId, label) {
    if (accountsApplying) throw new SecurityError("Account settings are busy", 409, "ACCOUNT_SETTINGS_BUSY");
    accountsApplying = true;
    try { return { accounts: await accountManager.renameAccount(accountId, label) }; }
    catch (error) { throw accountSettingsFailure(error); }
    finally { accountsApplying = false; }
  }

  async function removeAccountUnlocked(accountId) {
    if (accountsApplying) throw new SecurityError("Account settings are busy", 409, "ACCOUNT_SETTINGS_BUSY");
    accountsApplying = true;
    let removal;
    let previousRuntime;
    try {
      previousRuntime = await captureAccountRuntime();
      removal = await accountManager.removeAccount(accountId);
      const runtime = removal.activeChanged ? await restartForAccountChangeUnlocked(previousRuntime) : { reloaded: false };
      return { accounts: removal.accounts, ...runtime };
    } catch (error) {
      if (removal?.activeChanged && removal.rollback) {
        try {
          await accountManager.restoreRemovedAccount(removal.rollback);
          await restartForAccountChangeUnlocked(previousRuntime);
        } catch {
          throw new SecurityError("Account removal failed and could not be rolled back", 500, "ACCOUNT_ROLLBACK_FAILED");
        }
      }
      throw accountSettingsFailure(error);
    } finally {
      accountsApplying = false;
    }
  }

  function publicAccountLoginState() {
    return {
      status: accountLoginState.status,
      ...(accountLoginState.event ? { event: accountLoginState.event } : {}),
      ...(accountLoginState.error ? { error: accountLoginState.error } : {}),
      ...(accountLoginState.accounts ? { accounts: accountLoginState.accounts } : {}),
    };
  }

  async function startAccountLoginUnlocked() {
    if (accountLoginState.status === "running" || accountsApplying) throw new SecurityError("Codex sign-in is already open", 409, "ACCOUNT_LOGIN_BUSY");
    accountsApplying = true;
    let previousRuntime;
    try {
      previousRuntime = await captureAccountRuntime();
    } catch (error) {
      accountsApplying = false;
      throw error;
    }
    accountLoginController = new AbortController();
    accountLoginState = { status: "running", event: { type: "progress", message: "Opening secure Codex sign-in…" } };
    broadcast({ type: "account_login", ...publicAccountLoginState() });
    accountLoginPromise = (async () => {
      try {
        const addition = await accountManager.addAccount({
          signal: accountLoginController.signal,
          onEvent(event) {
            const safeEvent = event?.type === "device_code"
              ? { type: "device_code", userCode: String(event.userCode ?? "").slice(0, 32), verificationUri: String(event.verificationUri ?? "").slice(0, 2048) }
              : { type: event?.type === "auth_url" ? "auth_url" : "progress", message: String(event?.instructions ?? event?.message ?? "Complete sign-in in your browser.").slice(0, 240) };
            accountLoginState = { status: "running", event: safeEvent };
            broadcast({ type: "account_login", ...publicAccountLoginState() });
          },
        });
        const accounts = addition.accounts;
        let runtime;
        if (addition.activeCredentialChanged) {
          try {
            runtime = await sessionOperation(() => restartForAccountChangeUnlocked(previousRuntime));
          } catch (error) {
            try {
              await accountManager.restoreAddedAccount(addition.rollback);
              await sessionOperation(() => restartForAccountChangeUnlocked(previousRuntime));
            } catch {
              throw new SecurityError("Codex sign-in succeeded, but the account change could not be rolled back", 500, "ACCOUNT_ROLLBACK_FAILED");
            }
            throw error;
          }
        }
        accountLoginState = { status: "success", accounts, ...(runtime ? { runtime } : {}) };
      } catch (error) {
        const safe = accountSettingsFailure(error);
        accountLoginState = { status: safe.code === "ACCOUNT_LOGIN_CANCELLED" ? "cancelled" : "error", error: safe.message };
      } finally {
        accountLoginController = undefined;
        accountsApplying = false;
        broadcast({ type: "account_login", ...publicAccountLoginState() });
      }
    })();
    return publicAccountLoginState();
  }

  function cancelAccountLogin() {
    if (accountLoginState.status !== "running" || !accountLoginController) return { status: accountLoginState.status };
    accountLoginController.abort(new Error("Codex sign-in was cancelled"));
    return { status: "cancelling" };
  }

  async function reloadProvidersIfActive() {
    if (!bridge) return false;
    const current = await bridge.request("get_state");
    const runtime = current.data ?? current;
    if (runtime?.isStreaming || runtime?.isCompacting) {
      throw new SecurityError("Wait for Pi to finish before changing providers", 409, "SESSION_BUSY");
    }
    try {
      await bridge.command({ type: "prompt", message: `/${INTERNAL_RELOAD_COMMAND}` });
      await setBridgeApprovalMode(bridge, approvalMode);
      return true;
    } catch {
      throw new SecurityError("Provider settings were saved, but Pi could not reload. Run /reload in other open Pi sessions.", 503, "PROVIDER_RELOAD_FAILED");
    }
  }

  async function applyProviderUnlocked(request) {
    if (providersApplying) throw new SecurityError("Provider settings are already being applied", 409, "PROVIDER_SETTINGS_BUSY");
    providersApplying = true;
    try {
      if (bridge) {
        const current = await bridge.request("get_state");
        const runtime = current.data ?? current;
        if (runtime?.isStreaming || runtime?.isCompacting) {
          throw new SecurityError("Wait for Pi to finish before changing providers", 409, "SESSION_BUSY");
        }
      }
      let providers;
      try { providers = await writeProviderSettings(modelsPath, authPath, request); }
      catch (error) { throw providerSettingsFailure(error); }
      await closeSelectorBridge();
      const savedDefault = await currentModelDefault();
      const savedProvider = providers.find((provider) => provider.id === savedDefault?.provider);
      if (savedDefault && savedProvider && !savedProvider.models.some((model) => model.id === savedDefault.modelId)) {
        await unlink(modelDefaultPath).catch(() => {});
      }
      return { providers, reloaded: await reloadProvidersIfActive() };
    } finally {
      providersApplying = false;
    }
  }

  async function removeProviderUnlocked(request) {
    if (providersApplying) throw new SecurityError("Provider settings are already being applied", 409, "PROVIDER_SETTINGS_BUSY");
    let normalizedRequest;
    try { normalizedRequest = normalizeProviderRemoval(request); }
    catch (error) { throw providerSettingsFailure(error); }
    providersApplying = true;
    try {
      if (bridge) {
        const current = await bridge.request("get_state");
        const runtime = current.data ?? current;
        if (runtime?.isStreaming || runtime?.isCompacting) {
          throw new SecurityError("Wait for Pi to finish before changing providers", 409, "SESSION_BUSY");
        }
        if (runtime?.model?.provider?.trim().toLowerCase() === normalizedRequest.providerId) {
          throw new SecurityError("Select a model from another provider before removing this provider", 409, "PROVIDER_IN_USE");
        }
      }
      let providers;
      try { providers = await removeProviderSettings(modelsPath, authPath, normalizedRequest); }
      catch (error) { throw providerSettingsFailure(error); }
      await closeSelectorBridge();
      const savedDefault = await currentModelDefault();
      if (savedDefault?.provider === normalizedRequest.providerId) await unlink(modelDefaultPath).catch(() => {});
      return { providers, reloaded: await reloadProvidersIfActive() };
    } finally {
      providersApplying = false;
    }
  }

  function mcpSettingsOptions() {
    return {
      agentDirectory: agentDir,
      cwd: activeWorkspaceCwd ?? agentDir,
      includeProject: Boolean(activeWorkspaceCwd),
    };
  }

  function mcpSettingsFailure(error) {
    if (error instanceof SecurityError) return error;
    if (error?.code === "ELOCKED") return new SecurityError("MCP settings are busy; try again", 409, "MCP_SETTINGS_BUSY");
    if (error instanceof TypeError) {
      const notFound = new Set(["MCP_SERVER_NOT_FOUND", "MCP_SOURCE_NOT_FOUND"]);
      const conflict = new Set(["MCP_SERVER_EXISTS", "MCP_SOURCE_SHADOWED", "MCP_MANAGED_SERVER", "MCP_ROLLBACK_CONFLICT"]);
      const status = notFound.has(error.code) ? 404 : conflict.has(error.code) ? 409 : 400;
      return new SecurityError(error.message, status, error.code ?? "INVALID_MCP_SETTINGS");
    }
    return error;
  }

  async function assertMcpSettingsIdle() {
    if (!bridge) return;
    const current = await bridge.request("get_state");
    const runtime = current.data ?? current;
    if (runtime?.isStreaming || runtime?.isCompacting) {
      throw new SecurityError("Wait for Pi and active MCP work to finish before changing MCP settings", 409, "SESSION_BUSY");
    }
  }

  async function reloadMcpRuntimeIfActive() {
    if (!bridge) return false;
    await bridge.command({ type: "prompt", message: `/${INTERNAL_RELOAD_COMMAND}` });
    await setBridgeApprovalMode(bridge, approvalMode);
    return true;
  }

  async function applyMcpMutationUnlocked(request) {
    if (mcpApplying) throw new SecurityError("MCP settings are already being applied", 409, "MCP_SETTINGS_BUSY");
    mcpApplying = true;
    let transaction;
    try {
      await assertMcpSettingsIdle();
      transaction = await mutateMcpSettings(mcpSettingsOptions(), request);
      let test = null;
      if (transaction.server && !transaction.server.config.disabled) {
        test = await testMcpServerConnection(mcpSettingsOptions(), { name: transaction.server.name, timeoutMs: 8_000 });
        if (!test.ok) {
          await transaction.rollback();
          throw new SecurityError(test.error || "MCP server connection test failed", 422, "MCP_CONNECTION_FAILED");
        }
      }
      try {
        const reloaded = await reloadMcpRuntimeIfActive();
        return { snapshot: transaction.snapshot, revealed: transaction.revealed, test, reloaded };
      } catch {
        await transaction.rollback();
        let runtimeRestored = !bridge;
        if (bridge) {
          try {
            await bridge.command({ type: "prompt", message: `/${INTERNAL_RELOAD_COMMAND}` });
            await setBridgeApprovalMode(bridge, approvalMode);
            runtimeRestored = true;
          } catch { runtimeRestored = false; }
        }
        const message = runtimeRestored
          ? "MCP settings were rolled back because Pi could not reload"
          : "MCP settings were rolled back on disk; run /reload before using MCP again";
        throw new SecurityError(message, 503, "MCP_RELOAD_FAILED");
      }
    } catch (error) {
      throw mcpSettingsFailure(error);
    } finally {
      mcpApplying = false;
    }
  }

  async function testMcpConnectionUnlocked(request) {
    if (mcpApplying) throw new SecurityError("MCP settings are already being applied", 409, "MCP_SETTINGS_BUSY");
    await assertMcpSettingsIdle();
    try { return await testMcpServerConnection(mcpSettingsOptions(), request); }
    catch (error) { throw mcpSettingsFailure(error); }
  }

  async function executeBrowserCommand(targetBridge, command) {
    await assertImageCommandSupported(targetBridge, command);
    if (command.type === "prompt") await beginTaskEditTracking();
    let result;
    try {
      result = command.type === "extension_ui_response"
        ? await targetBridge.send(command).then(() => ({ type: "response", command: command.type, success: true }))
        : await targetBridge.command(command, command.type === "compact" ? { timeoutMs: MANUAL_COMPACTION_TIMEOUT_MS } : undefined);
    } catch (error) {
      if (command.type === "prompt") {
        const failedCapture = taskEditCapture;
        taskEditCapture = undefined;
        await disposeTaskEdits(failedCapture).catch(() => {});
      }
      throw error;
    }
    if (MODEL_PREFERENCE_COMMANDS.has(command.type)) await persistModelDefault(targetBridge);
    if (command.type === "extension_ui_response") pendingUiRequests.delete(command.id);
    return publicCommandResult(command, result);
  }

  async function serveStatic(request, response, pathname) {
    const file = await resolveStaticPath(publicDir, pathname);
    if (!file) {
      sendJson(response, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }
    setSecurityHeaders(response);
    response.statusCode = 200;
    response.setHeader("Content-Type", CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.end(await readFile(file));
  }

  async function handleApi(request, response, pathname) {
    if (pathname === "/api/auth" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request);
      if (!tokensEqual(body.token, bootstrapToken)) throw new SecurityError("Invalid bootstrap token", 401, "AUTH_FAILED");
      setSecurityHeaders(response);
      response.statusCode = 204;
      response.setHeader("Set-Cookie", `${cookieName}=${browserSessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`);
      response.end();
      return;
    }

    authenticate(request);
    if (pathname === "/api/sessions" && request.method === "GET") {
      sendJson(response, 200, { sessions: await catalog.refresh() });
      return;
    }
    if (pathname === "/api/workspaces/pick" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      await readJsonBody(request);
      if (workspacePickerActive) throw new SecurityError("Project picker is already open", 409, "PICKER_BUSY");
      const controller = new AbortController();
      const abortPicker = () => controller.abort();
      request.once("aborted", abortPicker);
      response.once("close", abortPicker);
      workspacePickerActive = true;
      let selection;
      try {
        selection = await directoryPicker({ signal: controller.signal });
      } finally {
        workspacePickerActive = false;
        request.off("aborted", abortPicker);
        response.off("close", abortPicker);
      }
      if (controller.signal.aborted) return;
      if (selection === null) sendJson(response, 200, { cancelled: true });
      else sendJson(response, 200, { cwd: await existingDirectory(selection) });
      return;
    }
    if (pathname === "/api/sessions/open" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const state = await openSession(await readJsonBody(request));
      sendJson(response, 200, { state });
      return;
    }
    if (pathname === "/api/sessions/refresh" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw new SecurityError("Refresh request is invalid", 400, "INVALID_SESSION");
      }
      sendJson(response, 200, await refreshActiveSession());
      return;
    }
    if (pathname === "/api/sessions/clone" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw new SecurityError("Clone request is invalid", 400, "INVALID_SESSION");
      }
      sendJson(response, 200, await cloneActiveSession());
      return;
    }
    if (pathname === "/api/sessions/delete" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) {
        throw new SecurityError("Delete request is invalid", 400, "INVALID_SESSION");
      }
      sendJson(response, 200, await deleteSession(body.sessionId));
      return;
    }
    if (pathname === "/api/approval-mode" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).length !== 1 || !APPROVAL_MODES.has(body.mode)) {
        throw new SecurityError("Tool access mode is invalid", 400, "INVALID_APPROVAL_MODE");
      }
      sendJson(response, 200, await sessionOperation(() => setApprovalMode(body.mode)));
      return;
    }
    if (pathname === "/api/extensions" && request.method === "GET") {
      sendJson(response, 200, { extensions: await currentExtensions() });
      return;
    }
    if (pathname === "/api/extensions/apply" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 8 * 1024 });
      if (Object.keys(body).length !== 1 || !("enabled" in body)) {
        throw new SecurityError("Extension request is invalid", 400, "INVALID_EXTENSIONS");
      }
      assertExtensionStates(body.enabled);
      sendJson(response, 200, await applyExtensions(body.enabled));
      return;
    }
    if (pathname === "/api/accounts" && request.method === "GET") {
      sendJson(response, 200, await listAccounts());
      return;
    }
    if (pathname === "/api/accounts/usage" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).some((key) => key !== "accountId")) throw new SecurityError("Usage request is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 200, await sessionOperation(() => refreshAccountUsageUnlocked(body.accountId)));
      return;
    }
    if (pathname === "/api/accounts/activate" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).length !== 1 || typeof body.accountId !== "string") throw new SecurityError("Account switch request is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 200, await sessionOperation(() => activateAccountUnlocked(body.accountId)));
      return;
    }
    if (pathname === "/api/accounts/rename" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 2048 });
      if (Object.keys(body).length !== 2 || typeof body.accountId !== "string" || typeof body.label !== "string") throw new SecurityError("Account rename request is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 200, await sessionOperation(() => renameAccountUnlocked(body.accountId, body.label)));
      return;
    }
    if (pathname === "/api/accounts/remove" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).length !== 1 || typeof body.accountId !== "string") throw new SecurityError("Account removal request is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 200, await sessionOperation(() => removeAccountUnlocked(body.accountId)));
      return;
    }
    if (pathname === "/api/accounts/login" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).length !== 0) throw new SecurityError("Account login request is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 202, await sessionOperation(startAccountLoginUnlocked));
      return;
    }
    if (pathname === "/api/accounts/login" && request.method === "GET") {
      sendJson(response, 200, publicAccountLoginState());
      return;
    }
    if (pathname === "/api/accounts/login/cancel" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (Object.keys(body).length !== 0) throw new SecurityError("Account login cancellation is invalid", 400, "INVALID_ACCOUNT");
      sendJson(response, 200, cancelAccountLogin());
      return;
    }
    if (pathname === "/api/providers" && request.method === "GET") {
      try { sendJson(response, 200, { providers: await readProviderSettings(modelsPath, authPath) }); }
      catch (error) { throw providerSettingsFailure(error); }
      return;
    }
    if (pathname === "/api/providers/apply" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
      sendJson(response, 200, await sessionOperation(() => applyProviderUnlocked(body)));
      return;
    }
    if (pathname === "/api/providers/remove" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 2 * 1024 });
      sendJson(response, 200, await sessionOperation(() => removeProviderUnlocked(body)));
      return;
    }
    if (pathname === "/api/mcp" && request.method === "GET") {
      try {
        const [snapshot, extensions] = await Promise.all([readMcpSettings(mcpSettingsOptions()), currentExtensions()]);
        sendJson(response, 200, {
          ...snapshot,
          projectAvailable: Boolean(activeWorkspaceCwd),
          extensionEnabled: extensions.find((extension) => extension.id === "mcp")?.enabled === true,
        });
      } catch (error) { throw mcpSettingsFailure(error); }
      return;
    }
    if (pathname === "/api/mcp/mutate" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
      sendJson(response, 200, await sessionOperation(() => applyMcpMutationUnlocked(body)));
      return;
    }
    if (pathname === "/api/mcp/test" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 4 * 1024 });
      sendJson(response, 200, await sessionOperation(() => testMcpConnectionUnlocked(body)));
      return;
    }
    const taskEditMatch = pathname.match(/^\/api\/task-edits\/([0-9a-f-]{36})(?:\/(undo))?$/);
    if (taskEditMatch && request.method === "GET" && !taskEditMatch[2]) {
      const summary = taskEditSummary(taskEditMatch[1]);
      sendJson(response, 200, { summary: publicTaskEditSummary(summary), patch: await taskEditPatch(summary) });
      return;
    }
    if (taskEditMatch && request.method === "POST" && taskEditMatch[2] === "undo") {
      assertLoopbackRequest(request, { requireOrigin: true });
      requireJson(request);
      const body = await readJsonBody(request, { maxBytes: 1024 });
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        throw new SecurityError("Task undo request is invalid", 400, "INVALID_TASK_UNDO");
      }
      try { sendJson(response, 200, { summary: await undoTaskEdits(taskEditSummary(taskEditMatch[1])) }); }
      catch (error) {
        if (error?.code === "TASK_EDIT_CONFLICT") throw new SecurityError(error.message, 409, error.code);
        throw error;
      }
      return;
    }
    if (pathname === "/api/state" && request.method === "GET") {
      if (!bridge) {
        const inactive = await sessionOperation(async () => {
          if (bridge) {
            const activeResult = await bridge.request("get_state");
            return { active: true, ...publicRuntimeState(activeResult.data ?? activeResult), browserSessionId: activeSessionId };
          }
          return { active: false, ...await inactiveRuntimeState(), browserSessionId: null };
        });
        sendJson(response, 200, inactive);
        return;
      }
      const result = await bridge.request("get_state");
      sendJson(response, 200, { active: true, ...publicRuntimeState(result.data ?? result), browserSessionId: activeSessionId });
      return;
    }
    if (pathname === "/api/command" && request.method === "POST") {
      assertLoopbackRequest(request, { requireOrigin: true });
      if (extensionsApplying) throw new SecurityError("Pi is reloading extensions", 409, "EXTENSION_SETTINGS_BUSY");
      if (providersApplying) throw new SecurityError("Pi is reloading providers", 409, "PROVIDER_SETTINGS_BUSY");
      if (mcpApplying) throw new SecurityError("Pi is reloading MCP settings", 409, "MCP_SETTINGS_BUSY");
      if (accountsApplying || accountLoginState.status === "running") throw new SecurityError("Pi is updating accounts", 409, "ACCOUNT_SETTINGS_BUSY");
      requireJson(request);
      const command = normalizeBrowserCommand(await readJsonBody(request, { maxBytes: MAX_BROWSER_COMMAND_BYTES }));
      if (!COMMANDS.has(command.type)) throw new SecurityError("Browser command is not allowed", 403, "COMMAND_FORBIDDEN");
      if (!bridge && !MODEL_SELECTOR_COMMANDS.has(command.type)) {
        throw new SecurityError("No active session", 409, "NO_ACTIVE_SESSION");
      }
      const output = MODEL_SELECTOR_COMMANDS.has(command.type)
        ? await sessionOperation(async () => executeBrowserCommand(bridge ?? await selectorBridgeUnlocked(), command))
        : await executeBrowserCommand(bridge, command);
      sendJson(response, 200, output);
      return;
    }
    if (pathname === "/api/events" && request.method === "GET") {
      if (!bridge) throw new SecurityError("No active session", 409, "NO_ACTIVE_SESSION");
      setSecurityHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders?.();
      clients.add(response);
      response.write(`data: ${JSON.stringify({ type: "browser_connected", activeSessionId })}\n\n`);
      for (const event of pendingUiRequests.values()) response.write(eventRecord(event));
      for (const summary of taskEditSummaries.values()) {
        if (summary.browserSessionId === activeSessionId) {
          response.write(eventRecord({ type: "workspace_edit_summary", ...publicTaskEditSummary(summary) }));
        }
      }
      request.on("close", () => clients.delete(response));
      return;
    }
    sendJson(response, 404, { error: "Not found", code: "NOT_FOUND" });
  }

  async function handle(request, response) {
    try {
      assertLoopbackRequest(request);
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/favicon.ico") {
        setSecurityHeaders(response);
        response.statusCode = 204;
        response.end();
      } else if (url.pathname.startsWith("/api/")) await handleApi(request, response, url.pathname);
      else if (request.method === "GET" || request.method === "HEAD") await serveStatic(request, response, url.pathname);
      else sendJson(response, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
    } catch (error) {
      sendError(response, error);
    }
  }

  return {
    get bootstrapToken() { return bootstrapToken; },
    get address() { return server?.address(); },
    async start() {
      if (stopping) await stopping;
      if (server) return this;
      await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
      await mkdir(lockRoot, { recursive: true, mode: 0o700 });
      bootstrapToken ??= await loadOrCreatePrivateToken(bootstrapTokenPath);
      browserSessionToken ??= await loadOrCreatePrivateToken(sessionTokenPath);
      cookieName ??= `${COOKIE_PREFIX}_${createHash("sha256").update(bootstrapToken).digest("hex").slice(0, 12)}`;
      catalogIdSecret ??= await loadOrCreatePrivateToken(catalogSecretPath);
      catalog ??= new SessionCatalog(sessionRoot, { idSecret: catalogIdSecret });
      server = serverFactory((request, response) => void handle(request, response));
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => { server.off("error", reject); resolve(); });
      });
      return this;
    },
    url() {
      const address = server?.address();
      if (!address || typeof address === "string") throw new Error("Pi Harness is not running");
      const displayHost = address.address === "::1" ? "[::1]" : address.address;
      return `http://${displayHost}:${address.port}/#${encodeURIComponent(bootstrapToken)}`;
    },
    async stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        for (const response of clients) response.end();
        clients.clear();
        accountLoginController?.abort(new Error("Pi Harness is stopping"));
        let failure;
        try { await accountLoginPromise; } catch (error) { failure = error; }
        await sessionSwitch;
        try { await closeBridge(); } catch (error) { failure = error; }
        try { await taskEditCompletion; } catch (error) { failure ??= error; }
        try { await closeSelectorBridge(); } catch (error) { failure ??= error; }
        for (const summary of taskEditSummaries.values()) {
          try { await disposeTaskEdits(summary); } catch (error) { failure ??= error; }
        }
        taskEditSummaries.clear();
        const activeServer = server;
        server = undefined;
        if (activeServer) {
          try { await new Promise((resolve) => activeServer.close(() => resolve())); }
          catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
      })();
      try { await stopping; } finally { stopping = undefined; }
    },
  };
}

export async function runPiBrowser({ port, ...options } = {}) {
  const configuredPort = port ?? (process.env.PI_BROWSER_PORT ? Number(process.env.PI_BROWSER_PORT) : 3081);
  const browserServer = createPiBrowserServer({ ...options, port: configuredPort });
  await browserServer.start();
  console.log(`Pi Harness: ${browserServer.url()}`);
  const stop = async () => {
    await browserServer.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return browserServer;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPiBrowser().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

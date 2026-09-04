import { EventEmitter } from "node:events";
import {
  MAX_BROWSER_COMMAND_BYTES,
  MAX_BROWSER_RPC_LINE_BYTES,
} from "./public/attachment-contract.js";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn } from "node:child_process";

const PACKAGE_NAMES = new Set(["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"]);
const DEFAULT_COMMANDS = new Set([
  "prompt", "steer", "follow_up", "abort", "clear_queue", "get_state", "get_messages",
  "set_model", "cycle_model", "get_available_models", "set_thinking_level", "cycle_thinking_level",
  "get_available_thinking_levels", "get_commands", "set_steering_mode", "set_follow_up_mode", "compact",
  "set_auto_compaction", "set_auto_retry", "abort_retry", "get_session_stats",
  "get_fork_messages", "set_session_name", "clone", "extension_ui_response",
]);
const APPROVAL_EXTENSION_PATH = fileURLToPath(import.meta.url);
const READ_ONLY_TOOLS = new Set(["read", "find", "ls", "web_fetch", "web_search", "web_map", "ctx_search", "ctx_stats"]);
const WORKSPACE_WRITE_TOOLS = new Set(["write", "edit"]);
const APPROVAL_MODES = new Set(["read-only", "workspace-write", "full-access"]);

function fileExists(fsImpl, file) {
  try {
    if (!fsImpl.existsSync(file)) return false;
    return typeof fsImpl.statSync !== "function" || fsImpl.statSync(file).isFile();
  } catch { return false; }
}

function packageCli(packageFile, fsImpl, pathImpl, expectedVersion) {
  try {
    const manifest = JSON.parse(fsImpl.readFileSync(packageFile, "utf8"));
    if (!PACKAGE_NAMES.has(manifest.name) || typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version)) return null;
    if (expectedVersion && manifest.version !== expectedVersion) return null;
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
    if (typeof bin !== "string" || !bin || pathImpl.isAbsolute(bin)) return null;
    const packageDir = pathImpl.dirname(packageFile);
    const cli = pathImpl.resolve(packageDir, bin);
    const relative = pathImpl.relative(packageDir, cli);
    if (relative === ".." || relative.startsWith(`..${pathImpl.sep}`) || pathImpl.isAbsolute(relative) || !fileExists(fsImpl, cli)) return null;
    return cli;
  } catch { return null; }
}

/** Resolve Pi without shell lookup on Windows. Returned args always start Pi in RPC mode. */
export function resolvePiInvocation({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  fs: fsImpl = { existsSync, readFileSync, statSync },
  path: injectedPath,
  expectedVersion,
} = {}) {
  if (platform !== "win32") return { command: "pi", args: ["--mode", "rpc"], shell: false, kind: "direct" };
  const pathImpl = injectedPath?.win32 ?? injectedPath ?? path.win32;
  const packageFiles = [
    env.PI_CLI_PACKAGE_JSON,
    env.PI_CODING_AGENT_PACKAGE_JSON,
    env.APPDATA && pathImpl.join(env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    env.npm_config_prefix && pathImpl.join(env.npm_config_prefix, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
  ].filter(Boolean);
  for (const packageFile of [...new Set(packageFiles)]) {
    if (!fileExists(fsImpl, packageFile)) continue;
    const cli = packageCli(packageFile, fsImpl, pathImpl, expectedVersion);
    if (cli) return { command: execPath, args: [cli, "--mode", "rpc"], shell: false, kind: "node-cli" };
  }

  const pathEntries = String(env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  for (const directory of pathEntries) {
    for (const extension of [".cmd", ".bat"]) {
      const shim = pathImpl.join(directory, `pi${extension}`);
      if (!fileExists(fsImpl, shim)) continue;
      if (/[\r\n"&|<>^%!()]/.test(shim)) continue;
      const command = env.ComSpec && /(?:^|[\\/])cmd\.exe$/i.test(env.ComSpec)
        ? env.ComSpec
        : env.SystemRoot ? pathImpl.join(env.SystemRoot, "System32", "cmd.exe") : "cmd.exe";
      return {
        command,
        args: ["/d", "/s", "/c"],
        shim,
        baseArgs: ["--mode", "rpc"],
        shell: false,
        windowsVerbatimArguments: false,
        kind: "cmd-shim",
      };
    }
  }
  throw new Error("Unable to locate a trusted Pi CLI installation");
}

function quoteCmdArgument(value) {
  const argument = String(value);
  if (!argument || /[\0\r\n"&|<>^%!()]/.test(argument)) {
    throw new Error("Pi cmd fallback cannot safely represent an argument");
  }
  return `"${argument}"`;
}

export function materializePiInvocation(invocation, extraArgs = []) {
  if (invocation.kind !== "cmd-shim") {
    return { ...invocation, args: [...invocation.args, ...extraArgs] };
  }
  const commandLine = [
    "call",
    quoteCmdArgument(invocation.shim),
    ...(invocation.baseArgs ?? []).map(quoteCmdArgument),
    ...extraArgs.map(quoteCmdArgument),
  ].join(" ");
  return { ...invocation, args: [...invocation.args, commandLine] };
}

export class PiBridge extends EventEmitter {
  #child;
  #disposed = false;
  #failed = false;
  #nextId = 1;
  #pending = new Map();
  #stdout = "";
  #stderr = Buffer.alloc(0);

  constructor({
    invocation,
    spawn = nodeSpawn,
    cwd,
    env = process.env,
    requestTimeoutMs = 15_000,
    maxLineBytes = MAX_BROWSER_RPC_LINE_BYTES,
    maxStderrBytes = 32 * 1024,
    maxCommandBytes = MAX_BROWSER_COMMAND_BYTES,
    allowedCommands = DEFAULT_COMMANDS,
    approvalExtensionPath = APPROVAL_EXTENSION_PATH,
    piArgs = [],
  } = {}) {
    super();
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new TypeError("Invalid request timeout");
    for (const [name, value] of Object.entries({ maxLineBytes, maxStderrBytes, maxCommandBytes })) {
      if (!Number.isSafeInteger(value) || value < 256) throw new TypeError(`Invalid ${name}`);
    }
    if (!Array.isArray(piArgs) || piArgs.some((argument) => typeof argument !== "string")) throw new TypeError("piArgs must be strings");
    this.options = { invocation: invocation ?? resolvePiInvocation(), spawn, cwd, env, requestTimeoutMs, maxLineBytes, maxStderrBytes, maxCommandBytes, allowedCommands: new Set(allowedCommands), approvalExtensionPath, piArgs: [...piArgs] };
  }

  get running() { return Boolean(this.#child && !this.#disposed && !this.#failed); }
  get stderr() { return this.#stderr.toString("utf8"); }

  start() {
    if (this.#disposed) throw new Error("Pi bridge is disposed");
    if (this.#failed) throw new Error("Pi bridge has failed");
    if (this.#child) return this;
    const extraArgs = [...this.options.piArgs];
    if (this.options.approvalExtensionPath) extraArgs.push("--extension", this.options.approvalExtensionPath);
    const invocation = materializePiInvocation(this.options.invocation, extraArgs);
    const child = this.options.spawn(invocation.command, invocation.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
    });
    this.#child = child;
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => this.#consumeStdout(chunk));
    child.stderr?.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      this.#stderr = Buffer.concat([this.#stderr, bytes]).subarray(-this.options.maxStderrBytes);
    });
    child.on("error", (error) => this.#fail(error));
    child.on("exit", (code, signal) => {
      if (!this.#disposed) this.#fail(new Error(`Pi RPC exited (${signal ?? code ?? "unknown"})`));
      this.emit("exit", { code, signal });
    });
    return this;
  }

  subscribe(listener) {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  request(type, payload = {}, { timeoutMs = this.options.requestTimeoutMs, signal } = {}) {
    if (!this.options.allowedCommands.has(type)) return Promise.reject(new Error(`RPC command not allowed: ${type}`));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new TypeError("Invalid request timeout"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return Promise.reject(new TypeError("RPC payload must be an object"));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
    this.start();
    const id = `browser-${this.#nextId++}`;
    let line;
    try {
      line = `${JSON.stringify({ ...payload, type, id })}\n`;
      if (Buffer.byteLength(line) > this.options.maxCommandBytes) throw new Error("RPC command is too large");
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#pending.delete(id);
      };
      const onAbort = () => { cleanup(); reject(signal.reason ?? new Error("Aborted")); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`RPC request timed out: ${type}`)); }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#child.stdin.write(line, "utf8", (error) => {
        if (error) { cleanup(); reject(error); }
      });
    });
  }

  command(message, options) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return Promise.reject(new TypeError("RPC command must be an object"));
    const { type, ...payload } = message;
    return this.request(type, payload, options);
  }

  send(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return Promise.reject(new TypeError("RPC command must be an object"));
    if (!this.options.allowedCommands.has(message.type)) return Promise.reject(new Error(`RPC command not allowed: ${message.type}`));
    this.start();
    let line;
    try {
      line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) > this.options.maxCommandBytes) throw new Error("RPC command is too large");
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      this.#child.stdin.write(line, "utf8", (error) => error ? reject(error) : resolve());
    });
  }

  abort() {
    return this.request("abort");
  }

  async dispose({ graceMs = 1_000 } = {}) {
    if (this.#disposed) return;
    this.#disposed = true;
    const child = this.#child;
    this.#child = undefined;
    this.#rejectPending(new Error("Pi bridge disposed"));
    if (!child) return;
    if (child.exitCode !== null || child.signalCode) return;
    await new Promise((resolve) => {
      let settled = false;
      let timer;
      const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
      child.once("exit", done);
      timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch {} done(); }, graceMs);
      timer.unref?.();
      try { child.stdin?.end(); } catch { done(); }
    });
  }

  #consumeStdout(chunk) {
    this.#stdout += String(chunk);
    if (Buffer.byteLength(this.#stdout) > this.options.maxLineBytes && !this.#stdout.includes("\n")) {
      this.#fail(new Error("Pi RPC output line exceeded limit"));
      return;
    }
    let newline;
    while ((newline = this.#stdout.indexOf("\n")) >= 0) {
      const line = this.#stdout.slice(0, newline).replace(/\r$/, "");
      this.#stdout = this.#stdout.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > this.options.maxLineBytes) { this.#fail(new Error("Pi RPC output line exceeded limit")); return; }
      let message;
      try { message = JSON.parse(line); } catch { this.#fail(new Error("Pi RPC emitted invalid JSONL")); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { this.#fail(new Error("Pi RPC emitted an invalid message")); return; }
      const id = typeof message.id === "string" ? message.id : typeof message.requestId === "string" ? message.requestId : undefined;
      const pending = id && this.#pending.get(id);
      if (pending) {
        pending.cleanup();
        if (message.success === false || message.error) pending.reject(new Error(typeof message.error === "string" ? message.error : message.error?.message ?? "RPC request failed"));
        else pending.resolve(message);
      } else {
        this.emit("event", message);
      }
    }
  }

  #rejectPending(error) {
    for (const pending of [...this.#pending.values()]) { pending.cleanup(); pending.reject(error); }
  }

  #fail(error) {
    if (this.#failed || this.#disposed) return;
    this.#failed = true;
    this.#rejectPending(error);
    this.emit("bridgeError", error);
    try { this.#child?.kill("SIGTERM"); } catch {}
  }
}

export const PiRpcClient = PiBridge;

const SENSITIVE_ARGUMENT = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i;

function sanitizeApprovalValue(value, key = "", depth = 0) {
  if (SENSITIVE_ARGUMENT.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.slice(0, 240);
  if (depth >= 2 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((entry) => sanitizeApprovalValue(entry, "", depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 12)
    .map(([childKey, childValue]) => [childKey, sanitizeApprovalValue(childValue, childKey, depth + 1)]));
}

function workspaceWriteAllowed(event, ctx) {
  if (!WORKSPACE_WRITE_TOOLS.has(event.toolName) || typeof event.input?.path !== "string") return false;
  try {
    const workspace = realpathSync(ctx.cwd);
    const requested = path.resolve(workspace, event.input.path);
    const target = existsSync(requested)
      ? realpathSync(requested)
      : path.join(realpathSync(path.dirname(requested)), path.basename(requested));
    const relative = path.relative(workspace, target);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function approvalDetails(event) {
  const input = event.input ?? event.args;
  if (!input || typeof input !== "object") return `Allow ${event.toolName} to run?`;
  let details;
  try { details = JSON.stringify(sanitizeApprovalValue(input), null, 2); }
  catch { details = "Arguments could not be displayed."; }
  return `Allow ${event.toolName} to run?\n\n${details.slice(0, 1_200)}`;
}

export default function browserApprovalExtension(pi) {
  let approvalMode = "workspace-write";
  pi.registerCommand("pi-browser-reload-runtime", {
    description: "Reload Pi resources after browser settings changes",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });
  pi.registerCommand("pi-browser-set-approval-mode", {
    description: "Set the browser tool access mode",
    handler: async (args) => {
      if (!APPROVAL_MODES.has(args)) throw new Error("Invalid browser approval mode");
      approvalMode = args;
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (READ_ONLY_TOOLS.has(event.toolName) || approvalMode === "full-access") return undefined;
    if (approvalMode === "read-only") {
      return { block: true, reason: "Read Only mode blocks tools that can change state", terminate: true };
    }
    if (workspaceWriteAllowed(event, ctx)) return undefined;
    if (!ctx?.hasUI || typeof ctx.ui?.confirm !== "function") {
      return { block: true, reason: "Browser approval is unavailable; action blocked", terminate: true };
    }
    try {
      const allowed = await ctx.ui.confirm("Allow tool action?", approvalDetails(event));
      if (!allowed) return { block: true, reason: "Action denied by user", terminate: true };
      return undefined;
    } catch {
      return { block: true, reason: "Approval failed; action blocked", terminate: true };
    }
  });
}

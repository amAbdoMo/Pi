import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, appendFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createPiBrowserServer, normalizeBrowserCommand, publicBrowserEvent, redactBrowserEvent } from "../browser/server.mjs";
import { WORKBENCH_EXTENSIONS } from "../browser/extension-settings.mjs";
import { parseReferencePrompt } from "../browser/public/reference-contract.js";

const execFileAsync = promisify(execFile);

class FakeBridge extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.commands = [];
    this.commandOptions = [];
  }

  start() { return this; }
  subscribe(listener) { this.on("event", listener); return () => this.off("event", listener); }
  async request(type) {
    if (this.requestDelayMs) await new Promise((resolve) => setTimeout(resolve, this.requestDelayMs));
    if (type === "get_state" && this.emitBridgeErrorOnState) {
      this.emitBridgeErrorOnState = false;
      this.emit("bridgeError", new Error("Bridge failed during setup"));
    }
    if (type === "get_state") return {
      data: {
        sessionId: "fixture",
        sessionFile: this.sessionFile ?? "R:/Private/session.jsonl",
        cwd: this.options.cwd,
        thinkingLevel: this.thinkingLevel ?? "high",
        model: { provider: this.modelProvider ?? "fixture", id: this.modelId ?? "model", name: this.modelName ?? "Model", input: this.modelInput ?? ["text"] },
        isStreaming: this.isStreaming ?? false,
        isCompacting: this.isCompacting ?? false,
      },
    };
    throw new Error(`Unexpected request: ${type}`);
  }
  async send(command) {
    this.commands.push(command);
  }
  async command(command, options) {
    this.commands.push(command);
    if (this.failNextApproval && command.type === "prompt" && command.message?.startsWith("/pi-browser-set-approval-mode")) {
      this.failNextApproval = false;
      throw new Error("fixture approval failure");
    }
    const commandDelay = command.type === "set_model" ? this.setModelDelays?.[command.modelId] : 0;
    if (commandDelay) await new Promise((resolve) => setTimeout(resolve, commandDelay));
    if (command.type === "set_model") {
      this.modelProvider = command.provider;
      this.modelId = command.modelId;
    }
    if (command.type === "set_thinking_level") this.thinkingLevel = command.level;
    if (command.type === "clone" && this.clonePath) {
      await writeFile(this.clonePath, '{"type":"session","version":3,"id":"clone","cwd":"R:/Project"}\n');
      this.sessionFile = this.clonePath;
    }
    this.commandOptions.push(options);
    if (command.type === "get_commands") return {
      type: "response",
      command: command.type,
      success: true,
      data: { commands: [
        { name: "fixture", description: "Fixture command", source: "extension", location: "user", path: "R:/Private/command.ts" },
        { name: "pi-browser-reload-runtime", description: "Internal", source: "extension", location: "temporary" },
        { name: "pi-browser-set-approval-mode", description: "Internal", source: "extension", location: "temporary" },
      ] },
    };
    if (command.type === "get_available_models") return {
      type: "response",
      command: command.type,
      success: true,
      data: { models: [{ provider: "fixture", id: "model", name: "Model", api: "test", apiKey: "secret", headers: { Authorization: "secret" }, reasoning: true, input: ["text"] }] },
    };
    if (command.type === "get_available_thinking_levels") return {
      type: "response",
      command: command.type,
      success: true,
      data: { levels: ["off", "medium", "high"] },
    };
    if (command.type === "set_model") return {
      type: "response",
      command: command.type,
      success: true,
      data: { provider: this.modelProvider, id: this.modelId, input: this.modelInput ?? ["text"] },
    };
    if (command.type === "clear_queue") return {
      type: "response",
      command: command.type,
      success: true,
      data: { steering: ["queued steering"], followUp: ["queued follow-up"] },
    };
    if (command.type === "get_session_stats") return {
      type: "response",
      command: command.type,
      success: true,
      data: {
        sessionId: "private-session-id",
        sessionFile: "R:/Private/session.jsonl",
        totalMessages: 4,
        cost: 0.125,
        contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
      },
    };
    return { type: "response", command: command.type, success: true };
  }
  async dispose() {
    this.disposed = true;
    if (this.disposeError) throw this.disposeError;
  }
}

async function responseJson(response) {
  const body = await response.json();
  return { status: response.status, body };
}

function collectSseEvents(url, options, expectedCount = 2, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buffer = "";
    let settled = false;
    let timer;
    const finish = (request) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(events);
    };
    const request = httpGet(url, { headers: options.headers }, (response) => {
      response.on("data", (chunk) => {
        buffer += String(chunk);
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const record = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = record.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (data) events.push(JSON.parse(data));
        }
        if (events.length >= expectedCount) finish(request);
      });
    });
    request.on("error", (error) => { if (!settled) reject(error); });
    timer = setTimeout(() => finish(request), timeoutMs);
  });
}

function createAuthenticationServer(agentDir) {
  return createPiBrowserServer({
    port: 0,
    agentDir,
    catalog: { async refresh() { return []; } },
  });
}

async function startFixture(t, {
  bridgeDelayMs = 0,
  modelInput = ["text"],
  failFirstBridgeDuringSetup = false,
  failBridgeDuringSetupAt = [],
  gitRepository = false,
  directoryPicker,
  accountManager,
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-browser-server-"));
  const agentDir = path.join(root, "agent");
  const sessionPath = path.join(agentDir, "sessions", "fixture.jsonl");
  const clonePath = path.join(agentDir, "sessions", "clone.jsonl");
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, '{"type":"session","version":3,"id":"fixture","cwd":"R:/Project"}\n');
  await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({
    packages: ["git:github.com/amAbdoMo/Pi", "npm:context-mode@1.0.169"],
  }, null, 2));
  if (gitRepository) {
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await writeFile(path.join(root, "task-file.txt"), "baseline\n", "utf8");
    await execFileAsync("git", ["add", "task-file.txt"], { cwd: root });
    await execFileAsync("git", ["-c", "user.name=Pi Test", "-c", "user.email=pi@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: root });
  }
  const bridges = [];
  const catalog = {
    async refresh() { return [{ id: "s_fixture", name: "Fixture", cwd: "Project", updatedAt: "2026-01-01T00:00:00.000Z" }]; },
    async resolve(id) { return id === "s_fixture" ? sessionPath : id === "s_clone" ? clonePath : null; },
    async cwdFor(id) { return id === "s_fixture" || id === "s_clone" ? root : null; },
    async idForFile(file) { return file === sessionPath ? "s_fixture" : file === clonePath ? "s_clone" : null; },
  };
  const server = createPiBrowserServer({
    port: 0,
    agentDir,
    catalog,
    invocationFactory: () => ({ command: "pi", args: ["--mode", "rpc"], kind: "direct", shell: false }),
    directoryPicker,
    ...(accountManager ? { accountManagerFactory: () => accountManager } : {}),
    bridgeFactory: (options) => {
      const bridge = new FakeBridge(options);
      bridge.requestDelayMs = bridgeDelayMs;
      bridge.modelInput = modelInput;
      bridge.sessionFile = options.piArgs[1] ?? sessionPath;
      bridge.clonePath = clonePath;
      bridge.emitBridgeErrorOnState = (failFirstBridgeDuringSetup && bridges.length === 0) || failBridgeDuringSetupAt.includes(bridges.length);
      bridges.push(bridge);
      return bridge;
    },
  });
  await server.start();
  t.after(async () => { await server.stop(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  const launchUrl = new URL(server.url());
  const token = decodeURIComponent(launchUrl.hash.slice(1));
  launchUrl.hash = "";
  return { server, baseUrl: launchUrl.href.replace(/\/$/, ""), token, bridges, sessionPath, clonePath, root };
}

test("active session file changes notify connected browser viewers", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  const eventsPromise = collectSseEvents(`${fixture.baseUrl}/api/events`, { headers: { Cookie: cookie } }, 2, 2_000);
  await new Promise((resolve) => setTimeout(resolve, 25));

  await appendFile(fixture.sessionPath, '{"type":"message","message":{"role":"user","content":"external"}}\n');
  const events = await eventsPromise;

  assert.equal(events[0].type, "browser_connected");
  assert.equal(events.some((event) => event.type === "session_changed"), true);

  const refreshed = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/refresh`, {
    method: "POST", headers, body: "{}",
  }));
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.reloaded, true);
  assert.equal(refreshed.body.state.browserSessionId, "s_fixture");
  assert.equal(fixture.bridges.length, 2);
});

test("native workspace picker returns a validated existing directory", async (t) => {
  let fixture;
  fixture = await startFixture(t, { directoryPicker: async () => fixture.root });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const response = await responseJson(await fetch(`${fixture.baseUrl}/api/workspaces/pick`, {
    method: "POST",
    headers: { Cookie: auth.headers.get("set-cookie").split(";", 1)[0], Origin: fixture.baseUrl, "Content-Type": "application/json" },
    body: "{}",
  }));

  assert.equal(response.status, 200);
  assert.equal(response.body.cwd, await realpath(fixture.root));
});

test("concurrent project picker requests cannot open duplicate Windows dialogs", async (t) => {
  let finishPicker;
  const fixture = await startFixture(t, {
    directoryPicker: () => new Promise((resolve) => { finishPicker = resolve; }),
  });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const headers = {
    Cookie: auth.headers.get("set-cookie").split(";", 1)[0],
    Origin: fixture.baseUrl,
    "Content-Type": "application/json",
  };
  const firstPicker = fetch(`${fixture.baseUrl}/api/workspaces/pick`, { method: "POST", headers, body: "{}" });
  while (!finishPicker) await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await responseJson(await fetch(`${fixture.baseUrl}/api/workspaces/pick`, {
    method: "POST", headers, body: "{}",
  }));
  finishPicker(null);

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "PICKER_BUSY");
  assert.deepEqual(await responseJson(await firstPicker), { status: 200, body: { cancelled: true } });
});

test("cancelling the native workspace picker leaves the active session unchanged", async (t) => {
  const fixture = await startFixture(t, { directoryPicker: async () => null });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const response = await responseJson(await fetch(`${fixture.baseUrl}/api/workspaces/pick`, {
    method: "POST",
    headers: { Cookie: auth.headers.get("set-cookie").split(";", 1)[0], Origin: fixture.baseUrl, "Content-Type": "application/json" },
    body: "{}",
  }));

  assert.deepEqual(response, { status: 200, body: { cancelled: true } });
  assert.equal(fixture.bridges.length, 0);
});

test("manual compaction allows a bounded long-running RPC response", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const headers = {
    Cookie: auth.headers.get("set-cookie").split(";", 1)[0],
    Origin: fixture.baseUrl,
    "Content-Type": "application/json",
  };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });

  const compacted = await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "compact" }),
  });

  assert.equal(compacted.status, 200);
  const compactCall = fixture.bridges[0].commands.findIndex((command) => command.type === "compact");
  assert.equal(fixture.bridges[0].commandOptions[compactCall].timeoutMs, 5 * 60 * 1000);
});

test("no-session model picker persists the last model and applies it only to new sessions", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };

  const initial = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.deepEqual(initial.body, { active: false, browserSessionId: null });
  assert.equal(fixture.bridges.length, 0);

  const models = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "get_available_models" }),
  }));
  assert.equal(models.status, 200);
  assert.deepEqual(fixture.bridges[0].options.piArgs, ["--no-session"]);

  await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "set_model", provider: "fixture", modelId: "model" }),
  });
  await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "set_thinking_level", level: "medium" }),
  });
  const inactive = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.equal(inactive.body.active, false);
  assert.equal(inactive.body.model.provider, "fixture");
  assert.equal(inactive.body.model.id, "model");
  assert.equal(inactive.body.thinkingLevel, "medium");
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, "agent", "browser-model-default.json"), "utf8")), {
    provider: "fixture", modelId: "model", name: "Model", thinkingLevel: "medium",
  });

  const rejectedPrompt = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "prompt", message: "Do not create a session" }),
  }));
  assert.equal(rejectedPrompt.status, 409);
  assert.equal(rejectedPrompt.body.code, "NO_ACTIVE_SESSION");

  const opened = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST", headers, body: JSON.stringify({ cwd: fixture.root }),
  }));
  assert.equal(opened.status, 200);
  assert.equal(fixture.bridges[0].disposed, true);
  assert.deepEqual(fixture.bridges[1].commands.slice(0, 3), [
    { type: "set_model", provider: "fixture", modelId: "model" },
    { type: "set_thinking_level", level: "medium" },
    { type: "prompt", message: "/pi-browser-set-approval-mode workspace-write" },
  ]);
  assert.equal(opened.body.state.thinkingLevel, "medium");

  fixture.bridges[1].setModelDelays = { "model-a": 50 };
  const firstSelection = fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "set_model", provider: "fixture", modelId: "model-a" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const secondSelection = fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "set_model", provider: "fixture", modelId: "model-b" }),
  });
  await Promise.all([firstSelection, secondSelection]);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, "agent", "browser-model-default.json"), "utf8")).modelId, "model-b");

  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  assert.deepEqual(fixture.bridges[2].commands, [
    { type: "prompt", message: "/pi-browser-set-approval-mode workspace-write" },
  ]);
});

test("completed agent tasks expose an exact review diff and conflict-safe undo", async (t) => {
  const fixture = await startFixture(t, { gitRepository: true });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST", headers, body: JSON.stringify({ cwd: fixture.root }),
  });
  const eventsPromise = collectSseEvents(`${fixture.baseUrl}/api/events`, { headers: { Cookie: cookie } }, 3, 4_000);
  await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST", headers, body: JSON.stringify({ type: "prompt", message: "Change the fixture" }),
  });
  await writeFile(path.join(fixture.root, "task-file.txt"), "baseline\ntask line\n", "utf8");
  fixture.bridges[0].emit("event", { type: "agent_settled" });
  const events = await eventsPromise;
  const summaryEvent = events.find((event) => event.type === "workspace_edit_summary");
  assert.deepEqual(summaryEvent.files, [{ path: "task-file.txt", additions: 1, deletions: 0, binary: false }]);

  const review = await responseJson(await fetch(`${fixture.baseUrl}/api/task-edits/${summaryEvent.id}`, {
    headers: { Cookie: cookie },
  }));
  assert.equal(review.status, 200);
  assert.match(review.body.patch, /\+task line/);
  const undo = await responseJson(await fetch(`${fixture.baseUrl}/api/task-edits/${summaryEvent.id}/undo`, {
    method: "POST", headers, body: "{}",
  }));
  assert.equal(undo.status, 200);
  assert.equal(undo.body.summary.undone, true);
  assert.equal(await readFile(path.join(fixture.root, "task-file.txt"), "utf8"), "baseline\n");
});

test("MCP settings API manages disabled servers without exposing private configuration paths", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };

  const initial = await responseJson(await fetch(`${fixture.baseUrl}/api/mcp`, { headers: { Cookie: cookie } }));
  assert.equal(initial.status, 200);
  assert.equal(initial.body.projectAvailable, false);
  assert.equal(JSON.stringify(initial.body).includes(fixture.root), false);

  const added = await responseJson(await fetch(`${fixture.baseUrl}/api/mcp/mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "add",
      name: "offline-tools",
      target: "global",
      config: { transport: "stdio", command: "offline-command", disabled: true },
      credentials: [],
    }),
  }));
  assert.equal(added.status, 200);
  assert.equal(added.body.reloaded, false);
  assert.equal(added.body.snapshot.servers[0].name, "offline-tools");
  assert.equal(added.body.snapshot.servers[0].config.disabled, true);

  const removed = await responseJson(await fetch(`${fixture.baseUrl}/api/mcp/mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "remove", name: "offline-tools", deleteCredentials: true }),
  }));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.snapshot.servers, []);
});

test("MCP mutation rollback reloads the restored runtime after a partial reload failure", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST", headers, body: JSON.stringify({ cwd: fixture.root }),
  });
  fixture.bridges[0].failNextApproval = true;

  const failed = await responseJson(await fetch(`${fixture.baseUrl}/api/mcp/mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "add",
      name: "rolled-back",
      target: "project",
      config: { transport: "stdio", command: "offline-command", disabled: true },
      credentials: [],
    }),
  }));
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, "MCP_RELOAD_FAILED");
  assert.equal((await responseJson(await fetch(`${fixture.baseUrl}/api/mcp`, { headers: { Cookie: cookie } }))).body.servers.length, 0);
  assert.deepEqual(fixture.bridges[0].commands.slice(-4), [
    { type: "prompt", message: "/pi-browser-reload-runtime" },
    { type: "prompt", message: "/pi-browser-set-approval-mode workspace-write" },
    { type: "prompt", message: "/pi-browser-reload-runtime" },
    { type: "prompt", message: "/pi-browser-set-approval-mode workspace-write" },
  ]);
});

test("extension API stages global Workbench filters and reloads the active Pi runtime", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  const listed = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions`, { headers: { Cookie: cookie } }));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.extensions.length, 16);
  assert.ok(listed.body.extensions.every((extension) => extension.enabled));

  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  const enabled = Object.fromEntries(WORKBENCH_EXTENSIONS.map((extension) => [extension.id, extension.id !== "memory"]));
  const wrongOrigin = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions/apply`, {
    method: "POST",
    headers: { ...headers, Origin: "http://localhost.invalid" },
    body: JSON.stringify({ enabled }),
  }));
  assert.equal(wrongOrigin.status, 403);

  const applied = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled }),
  }));

  assert.equal(applied.status, 200);
  assert.equal(applied.body.reloaded, true);
  assert.equal(applied.body.extensions.find((extension) => extension.id === "memory").enabled, false);
  assert.deepEqual(fixture.bridges[0].commands.slice(-2), [
    { type: "prompt", message: "/pi-browser-reload-runtime" },
    { type: "prompt", message: "/pi-browser-set-approval-mode workspace-write" },
  ]);
  const settings = JSON.parse(await readFile(path.join(fixture.root, "agent", "settings.json"), "utf8"));
  assert.equal(settings.packages[1], "npm:context-mode@1.0.169");
  assert.ok(settings.packages[0].extensions.includes("-extensions/memory/index.ts"));

  fixture.bridges[0].isStreaming = true;
  const busy = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled: Object.fromEntries(WORKBENCH_EXTENSIONS.map((extension) => [extension.id, true])) }),
  }));
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "SESSION_BUSY");
  fixture.bridges[0].isStreaming = false;
  fixture.bridges[0].isCompacting = true;
  const compacting = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled }),
  }));
  assert.equal(compacting.status, 409);
  assert.equal(compacting.body.code, "SESSION_BUSY");
  fixture.bridges[0].isCompacting = false;

  const rejected = await responseJson(await fetch(`${fixture.baseUrl}/api/extensions/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ enabled: { memory: true } }),
  }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, "INVALID_EXTENSIONS");
});

test("provider API saves redacted custom providers and requires an explicit credential removal choice", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  const provider = {
    id: "local-ai",
    baseUrl: "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    models: [{ id: "qwen-coder", reasoning: true, input: ["text"] }],
  };

  const wrongOrigin = await responseJson(await fetch(`${fixture.baseUrl}/api/providers/apply`, {
    method: "POST",
    headers: { ...headers, Origin: "http://localhost.invalid" },
    body: JSON.stringify({ provider, credentialAction: "replace", apiKey: "secret" }),
  }));
  assert.equal(wrongOrigin.status, 403);

  const applied = await responseJson(await fetch(`${fixture.baseUrl}/api/providers/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider, credentialAction: "replace", apiKey: "secret" }),
  }));
  assert.equal(applied.status, 200);
  assert.equal(applied.body.reloaded, true);
  assert.equal(applied.body.providers[0].credentialConfigured, true);
  assert.doesNotMatch(JSON.stringify(applied.body), /secret/);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, "agent", "auth.json"), "utf8"))["local-ai"].key, "secret");

  fixture.bridges[0].modelProvider = "local-ai";
  const inUse = await responseJson(await fetch(`${fixture.baseUrl}/api/providers/remove`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providerId: " LOCAL-AI ", deleteCredential: false }),
  }));
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.code, "PROVIDER_IN_USE");

  fixture.bridges[0].modelProvider = "fixture";
  const removed = await responseJson(await fetch(`${fixture.baseUrl}/api/providers/remove`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providerId: "local-ai", deleteCredential: false }),
  }));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.providers.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, "agent", "auth.json"), "utf8"))["local-ai"].key, "secret");
});

test("approval mode API applies only validated modes to an idle browser runtime", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const headers = {
    Cookie: auth.headers.get("set-cookie").split(";", 1)[0],
    Origin: fixture.baseUrl,
    "Content-Type": "application/json",
  };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  const applied = await responseJson(await fetch(`${fixture.baseUrl}/api/approval-mode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "full-access" }),
  }));
  assert.deepEqual(applied, { status: 200, body: { mode: "full-access", applied: true } });
  assert.deepEqual(fixture.bridges[0].commands.at(-1), {
    type: "prompt",
    message: "/pi-browser-set-approval-mode full-access",
  });

  fixture.bridges[0].isStreaming = true;
  const busy = await responseJson(await fetch(`${fixture.baseUrl}/api/approval-mode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "read-only" }),
  }));
  assert.equal(busy.status, 409);
  fixture.bridges[0].isStreaming = false;
  const invalid = await responseJson(await fetch(`${fixture.baseUrl}/api/approval-mode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "unlimited" }),
  }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_APPROVAL_MODE");
});

test("browser image commands preserve only bounded Pi RPC image content", () => {
  const data = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  assert.deepEqual(normalizeBrowserCommand({
    type: "prompt",
    message: "Review this",
    images: [{ type: "image", data, mimeType: "image/gif" }],
  }), {
    type: "prompt",
    message: "Review this",
    images: [{ type: "image", data, mimeType: "image/gif" }],
  });
  assert.throws(() => normalizeBrowserCommand({
    type: "prompt",
    message: "Review this",
    images: [{ type: "image", data, mimeType: "image/gif", path: "R:/Private/photo.gif" }],
  }), (error) => error.code === "INVALID_ATTACHMENT");
  assert.throws(() => normalizeBrowserCommand({ type: "prompt", message: "", images: [] }),
    (error) => error.code === "INVALID_ATTACHMENT");
  const nonCanonicalData = `${data.slice(0, -4)}Ox==`;
  assert.throws(() => normalizeBrowserCommand({
    type: "prompt",
    message: "Review this",
    images: [{ type: "image", data: nonCanonicalData, mimeType: "image/gif" }],
  }), (error) => error.code === "INVALID_ATTACHMENT");
});

test("argument-free browser commands reject unsupported fields", () => {
  assert.deepEqual(normalizeBrowserCommand({ type: "clear_queue" }), { type: "clear_queue" });
  assert.deepEqual(normalizeBrowserCommand({ type: "abort" }), { type: "abort" });
  assert.throws(() => normalizeBrowserCommand({ type: "abort", sessionPath: "R:/Private/session.jsonl" }),
    (error) => error.code === "INVALID_COMMAND");
  assert.throws(() => normalizeBrowserCommand({ type: "prompt", message: "/pi-browser-reload-runtime" }),
    (error) => error.code === "COMMAND_FORBIDDEN");
  assert.throws(() => normalizeBrowserCommand({ type: "steer", message: " /pi-browser-reload-runtime:1 now" }),
    (error) => error.code === "COMMAND_FORBIDDEN");
});

test("browser text references become framed Pi text without path authority", () => {
  const normalized = normalizeBrowserCommand({
    type: "prompt",
    message: "Review this",
    references: [{ type: "text", name: "notes.md", mimeType: "text/markdown", text: "Hello" }],
  });

  assert.deepEqual(parseReferencePrompt(normalized.message), {
    message: "Review this",
    references: [{ type: "text", name: "notes.md", mimeType: "text/markdown", text: "Hello" }],
  });
  assert.equal("references" in normalized, false);
  assert.throws(() => normalizeBrowserCommand({
    type: "prompt",
    message: "Review",
    references: [{ type: "text", name: "notes.md", mimeType: "text/markdown", text: "Hello", path: "C:/private/notes.md" }],
  }), (error) => error.code === "INVALID_ATTACHMENT");
  assert.throws(() => normalizeBrowserCommand({
    type: "prompt",
    message: "Review",
    references: [{ type: "text", name: "report.pdf", mimeType: "application/pdf", text: "%PDF" }],
  }), (error) => error.code === "INVALID_ATTACHMENT");

  const image = { type: "image", data: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", mimeType: "image/gif" };
  const references = Array.from({ length: 8 }, (_, index) => ({
    type: "text",
    name: `notes-${index}.txt`,
    mimeType: "text/plain",
    text: "x",
  }));
  assert.throws(() => normalizeBrowserCommand({
    type: "prompt",
    message: "Review",
    images: [image, image, image],
    references,
  }), (error) => error.code === "INVALID_ATTACHMENT");
});

test("browser compaction commands reject unsupported or malformed fields", () => {
  assert.deepEqual(normalizeBrowserCommand({ type: "compact" }), { type: "compact" });
  assert.deepEqual(normalizeBrowserCommand({ type: "compact", customInstructions: "Keep decisions" }),
    { type: "compact", customInstructions: "Keep decisions" });
  assert.deepEqual(normalizeBrowserCommand({ type: "set_auto_compaction", enabled: false }),
    { type: "set_auto_compaction", enabled: false });
  assert.throws(() => normalizeBrowserCommand({ type: "compact", sessionFile: "R:/Private/session.jsonl" }),
    (error) => error.code === "INVALID_COMMAND");
  assert.throws(() => normalizeBrowserCommand({ type: "set_auto_compaction", enabled: "false" }),
    (error) => error.code === "INVALID_COMMAND");
});

test("browser session names are trimmed and strictly bounded", () => {
  assert.deepEqual(normalizeBrowserCommand({ type: "set_session_name", name: "  Release work  " }),
    { type: "set_session_name", name: "Release work" });
  assert.throws(() => normalizeBrowserCommand({ type: "set_session_name", name: "bad\nname" }),
    (error) => error.code === "INVALID_COMMAND");
  assert.throws(() => normalizeBrowserCommand({ type: "set_session_name", name: "x".repeat(121) }),
    (error) => error.code === "INVALID_COMMAND");
});

test("browser interaction responses preserve only one bounded response value", () => {
  assert.deepEqual(normalizeBrowserCommand({ type: "extension_ui_response", id: "request-1", confirmed: false }),
    { type: "extension_ui_response", id: "request-1", confirmed: false });
  assert.deepEqual(normalizeBrowserCommand({ type: "extension_ui_response", id: "request-2", cancelled: true }),
    { type: "extension_ui_response", id: "request-2", cancelled: true });
  assert.throws(() => normalizeBrowserCommand({
    type: "extension_ui_response",
    id: "request-3",
    value: "Allow",
    sessionPath: "R:/Private/session.jsonl",
  }), (error) => error.code === "INVALID_COMMAND");
  assert.throws(() => normalizeBrowserCommand({ type: "extension_ui_response", id: "request-4" }),
    (error) => error.code === "INVALID_COMMAND");
});

test("browser events redact nested credential-like fields without changing ordinary content", () => {
  assert.deepEqual(redactBrowserEvent({
    type: "tool_execution_start",
    args: {
      path: "R:/Project/file.txt",
      headers: { Authorization: "Bearer private", "x-api-key": "private" },
      nested: [{ password: "private", message: "keep me" }],
      usage: { totalTokens: 123, accessToken: "private" },
      details: {
        fullOutputPath: "R:/Private/tool-output.txt",
        sessionFile: "R:/Private/session.jsonl",
        extensionPath: "R:/Private/extension.ts",
        cwd: "R:/Private",
        processId: 1234,
      },
    },
  }), {
    type: "tool_execution_start",
    args: {
      path: "R:/Project/file.txt",
      headers: { Authorization: "[REDACTED]", "x-api-key": "[REDACTED]" },
      nested: [{ password: "[REDACTED]", message: "keep me" }],
      usage: { totalTokens: 123, accessToken: "[REDACTED]" },
      details: {
        fullOutputPath: "[REDACTED]",
        sessionFile: "[REDACTED]",
        extensionPath: "[REDACTED]",
        cwd: "[REDACTED]",
        processId: "[REDACTED]",
      },
    },
  });
});

test("unknown custom events expose only a bounded public event name", () => {
  assert.deepEqual(publicBrowserEvent({
    type: "private_extension_event",
    secret: "private",
    cwd: "R:/Private",
    payload: { message: "must not cross the browser boundary" },
  }), { type: "pi_custom_event", eventType: "private_extension_event" });
  assert.deepEqual(publicBrowserEvent({ type: "invalid event\n", secret: "private" }),
    { type: "pi_custom_event", eventType: "unknown" });
});

test("server serves a hardened client and requires fragment-token authentication", async (t) => {
  const fixture = await startFixture(t);
  const page = await fetch(`${fixture.baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await page.text(), new RegExp(fixture.token));

  const denied = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions`));
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, "AUTH_REQUIRED");

  const wrongOrigin = await responseJson(await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost.invalid" },
    body: JSON.stringify({ token: fixture.token }),
  }));
  assert.equal(wrongOrigin.status, 403);

  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  assert.equal(auth.status, 204);
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  assert.match(auth.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000/);

  const sessions = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions`, { headers: { Cookie: cookie } }));
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.sessions[0].id, "s_fixture");

  const inactiveState = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.equal(inactiveState.status, 200);
  assert.deepEqual(inactiveState.body, { active: false, browserSessionId: null });
});

test("concurrent loopback servers use distinct authentication cookie names", async (t) => {
  const first = await startFixture(t);
  const second = await startFixture(t);
  const authenticate = (fixture) => fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const [firstAuth, secondAuth] = await Promise.all([authenticate(first), authenticate(second)]);
  const firstCookieName = firstAuth.headers.get("set-cookie").split("=", 1)[0];
  const secondCookieName = secondAuth.headers.get("set-cookie").split("=", 1)[0];
  assert.match(firstCookieName, /^pi_harness_[a-f0-9]{12}$/);
  assert.notEqual(firstCookieName, secondCookieName);
});

test("authentication cookie and bootstrap URL remain valid across server restarts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-browser-auth-restart-"));
  const agentDir = path.join(root, "agent");
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  const first = createAuthenticationServer(agentDir);
  servers.push(first);
  await first.start();
  const firstUrl = new URL(first.url());
  const bootstrapToken = decodeURIComponent(firstUrl.hash.slice(1));
  firstUrl.hash = "";
  const origin = firstUrl.href.replace(/\/$/, "");
  const auth = await fetch(`${origin}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token: bootstrapToken }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  await first.stop();

  const second = createAuthenticationServer(agentDir);
  servers.push(second);
  await second.start();
  const secondUrl = new URL(second.url());
  assert.equal(decodeURIComponent(secondUrl.hash.slice(1)), bootstrapToken);
  secondUrl.hash = "";
  const sessions = await fetch(`${secondUrl.href.replace(/\/$/, "")}/api/sessions`, {
    headers: { Cookie: cookie },
  });
  assert.equal(sessions.status, 200);
});

test("server owns session switching and forwards only browser-safe RPC commands", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const commonHeaders = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };

  const opened = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  }));
  assert.equal(opened.status, 200);
  assert.equal(opened.body.state.sessionId, undefined);
  assert.equal(opened.body.state.sessionFile, undefined);
  assert.equal(opened.body.state.cwd, undefined);
  assert.deepEqual(fixture.bridges[0].options.piArgs, ["--session", fixture.sessionPath]);

  const prompt = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "prompt", message: "hello" }),
  }));
  assert.equal(prompt.status, 200);
  assert.equal(prompt.body.command, "prompt");

  const cleared = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "clear_queue" }),
  }));
  const aborted = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "abort" }),
  }));
  assert.deepEqual(cleared.body.data, { steering: ["queued steering"], followUp: ["queued follow-up"] });
  assert.equal(aborted.body.success, true);
  assert.deepEqual(fixture.bridges[0].commands.slice(-2).map((command) => command.type), ["clear_queue", "abort"]);

  const stats = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "get_session_stats" }),
  }));
  assert.deepEqual(stats.body.data, {
    totalMessages: 4,
    cost: 0.125,
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
  });

  const state = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.equal(state.status, 200);
  assert.equal(state.body.active, true);
  assert.equal("sessionFile" in state.body, false);

  const commands = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "get_commands" }),
  }));
  assert.equal(commands.status, 200);
  assert.equal(commands.body.data.commands.length, 1);
  assert.deepEqual(commands.body.data.commands[0], {
    name: "fixture",
    description: "Fixture command",
    source: "extension",
    location: "user",
  });

  const models = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "get_available_models" }),
  }));
  assert.equal(models.status, 200);
  assert.deepEqual(models.body.data.models[0], {
    provider: "fixture",
    id: "model",
    name: "Model",
    api: "test",
    reasoning: true,
    input: ["text"],
  });

  const forbidden = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ type: "switch_session", sessionPath: "elsewhere" }),
  }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "COMMAND_FORBIDDEN");
});

test("pending extension dialogs replay after reconnect until answered", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  fixture.bridges[0].emit("event", {
    type: "extension_ui_request",
    id: "approval-1",
    method: "confirm",
    title: "Allow tool action?",
    message: "Allow bash to run?",
  });

  const replayed = await collectSseEvents(`${fixture.baseUrl}/api/events`, { headers: { Cookie: cookie } });
  assert.equal(replayed[0].type, "browser_connected");
  assert.deepEqual(replayed[1], {
    type: "extension_ui_request",
    id: "approval-1",
    method: "confirm",
    title: "Allow tool action?",
    message: "Allow bash to run?",
  });

  const answered = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "extension_ui_response", id: "approval-1", confirmed: false }),
  }));
  assert.equal(answered.status, 200);
  const afterAnswer = await collectSseEvents(`${fixture.baseUrl}/api/events`, { headers: { Cookie: cookie } });
  assert.deepEqual(afterAnswer.map((event) => event.type), ["browser_connected"]);
});

test("server enforces active Pi model image capability before forwarding", async (t) => {
  const authenticateAndOpen = async (fixture) => {
    const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
      body: JSON.stringify({ token: fixture.token }),
    });
    const headers = {
      Cookie: auth.headers.get("set-cookie").split(";", 1)[0],
      Origin: fixture.baseUrl,
      "Content-Type": "application/json",
    };
    await fetch(`${fixture.baseUrl}/api/sessions/open`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "s_fixture" }),
    });
    return headers;
  };
  const image = {
    type: "image",
    data: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    mimeType: "image/gif",
  };
  const textFixture = await startFixture(t);
  const textHeaders = await authenticateAndOpen(textFixture);
  const rejected = await responseJson(await fetch(`${textFixture.baseUrl}/api/command`, {
    method: "POST",
    headers: textHeaders,
    body: JSON.stringify({ type: "prompt", message: "", images: [image] }),
  }));
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "IMAGE_INPUT_UNSUPPORTED");
  assert.deepEqual(textFixture.bridges[0].commands, [{
    type: "prompt",
    message: "/pi-browser-set-approval-mode workspace-write",
  }]);

  const imageFixture = await startFixture(t, { modelInput: ["text", "image"] });
  const imageHeaders = await authenticateAndOpen(imageFixture);
  const accepted = await responseJson(await fetch(`${imageFixture.baseUrl}/api/command`, {
    method: "POST",
    headers: imageHeaders,
    body: JSON.stringify({ type: "prompt", message: "", images: [image] }),
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(imageFixture.bridges[0].commands.at(-1), { type: "prompt", message: "", images: [image] });
});

test("active sessions rename, clone, adopt a new opaque lock, and delete safely", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  });
  const renamed = await responseJson(await fetch(`${fixture.baseUrl}/api/command`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "set_session_name", name: "Cloned work" }),
  }));
  assert.equal(renamed.status, 200);
  assert.deepEqual(fixture.bridges[0].commands.at(-1), { type: "set_session_name", name: "Cloned work" });

  const cloned = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/clone`, {
    method: "POST",
    headers,
    body: "{}",
  }));
  assert.equal(cloned.status, 200);
  assert.equal(cloned.body.state.browserSessionId, "s_clone");
  assert.equal(fixture.bridges[0].disposed, true);
  assert.equal(fixture.bridges.length, 2);

  const deleted = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_clone" }),
  }));
  assert.deepEqual(deleted, { status: 200, body: { deletedSessionId: "s_clone", activeClosed: true } });
  await assert.rejects(access(fixture.clonePath));
  const state = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.deepEqual(state, { status: 200, body: { active: false, browserSessionId: null } });
});

test("concurrent workspace opens are idempotent and state is reload-resumable", async (t) => {
  const fixture = await startFixture(t, { bridgeDelayMs: 20 });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  const openWorkspace = async () => responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cwd: fixture.root }),
  }));

  const [first, second] = await Promise.all([openWorkspace(), openWorkspace()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.match(first.body.state.browserSessionId, /^w_[A-Za-z0-9_-]{32}$/);
  assert.equal(second.body.state.browserSessionId, first.body.state.browserSessionId);
  assert.equal(fixture.bridges.length, 1);

  const state = await responseJson(await fetch(`${fixture.baseUrl}/api/state`, { headers: { Cookie: cookie } }));
  assert.equal(state.status, 200);
  assert.equal(state.body.active, true);
  assert.equal(state.body.browserSessionId, first.body.state.browserSessionId);
});

test("bridge failure during setup rejects the open and releases its writer lock", async (t) => {
  const fixture = await startFixture(t, { failFirstBridgeDuringSetup: true });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  const openSaved = async () => responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  }));

  const failed = await openSaved();
  assert.equal(failed.status, 500);
  assert.equal(fixture.bridges[0].disposed, true);
  const reopened = await openSaved();
  assert.equal(reopened.status, 200);
  assert.equal(fixture.bridges.length, 2);
});

test("fatal bridge errors release the writer lock even when disposal fails", async (t) => {
  const fixture = await startFixture(t);
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };
  const openSaved = async () => responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId: "s_fixture" }),
  }));

  assert.equal((await openSaved()).status, 200);
  fixture.bridges[0].disposeError = new Error("fixture dispose failure");
  fixture.bridges[0].emit("bridgeError", new Error("fixture RPC exit"));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const reopened = await openSaved();
  assert.equal(reopened.status, 200);
  assert.equal(fixture.bridges.length, 2);
});

test("Codex account API stays secret-free, blocks busy switches, and restarts the active bridge", async (t) => {
  let accounts = [
    { id: "acc_a", name: "Primary", email: "one@example.test", initials: "P", plan: "plus", active: true, usage: null, updatedAt: 1 },
    { id: "acc_b", name: "Work", email: "two@example.test", initials: "W", plan: "pro", active: false, usage: null, updatedAt: 2 },
  ];
  let activations = 0;
  const accountManager = {
    async listAccounts() { return structuredClone(accounts); },
    async refreshUsage() { return structuredClone(accounts); },
    async activateAccount(accountId) {
      activations += 1;
      accounts = accounts.map((account) => ({ ...account, active: account.id === accountId }));
      return { previousActiveId: "acc_a", accounts: structuredClone(accounts) };
    },
    async renameAccount() { return structuredClone(accounts); },
    async removeAccount() { return { accounts: structuredClone(accounts), activeChanged: false }; },
    async addAccount({ onEvent }) {
      onEvent({ type: "auth_url", url: "https://auth.openai.com/authorize?token=private" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { accounts: structuredClone(accounts), activeCredentialChanged: false };
    },
  };
  const fixture = await startFixture(t, { accountManager });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const cookie = auth.headers.get("set-cookie").split(";", 1)[0];
  const headers = { Cookie: cookie, Origin: fixture.baseUrl, "Content-Type": "application/json" };

  const listed = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts`, { headers }));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.accounts.length, 2);
  assert.doesNotMatch(JSON.stringify(listed.body), /private|access|refresh/);

  await fetch(`${fixture.baseUrl}/api/sessions/open`, { method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }) });
  fixture.bridges[0].modelProvider = "openai-codex";
  fixture.bridges[0].modelId = "gpt-5.4";
  fixture.bridges[0].modelName = "GPT-5.4";
  fixture.bridges[0].thinkingLevel = "medium";
  fixture.bridges[0].isStreaming = true;
  const busy = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/activate`, { method: "POST", headers, body: JSON.stringify({ accountId: "acc_b" }) }));
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "SESSION_BUSY");
  assert.equal(activations, 0);

  fixture.bridges[0].isStreaming = false;
  const switched = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/activate`, { method: "POST", headers, body: JSON.stringify({ accountId: "acc_b" }) }));
  assert.equal(switched.status, 200);
  assert.equal(switched.body.accounts.find((account) => account.active).id, "acc_b");
  assert.equal(fixture.bridges[0].disposed, true);
  assert.equal(fixture.bridges.length, 2);
  assert.equal(switched.body.state.thinkingLevel, "medium");
  assert.equal(switched.body.state.model.id, "gpt-5.4");
  assert.deepEqual(fixture.bridges[1].commands.slice(-2), [
    { type: "set_model", provider: "openai-codex", modelId: "gpt-5.4" },
    { type: "set_thinking_level", level: "medium" },
  ]);

  const loginStart = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/login`, { method: "POST", headers, body: "{}" }));
  assert.equal(loginStart.status, 202);
  assert.equal(loginStart.body.status, "running");
  assert.doesNotMatch(JSON.stringify(loginStart.body), /token=private/);
  const refreshWhileLogin = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/refresh`, { method: "POST", headers, body: "{}" }));
  assert.equal(refreshWhileLogin.status, 200);
  assert.equal(refreshWhileLogin.body.reloaded, false);
  const openWhileLogin = await responseJson(await fetch(`${fixture.baseUrl}/api/sessions/open`, { method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }) }));
  assert.equal(openWhileLogin.status, 409);
  assert.equal(openWhileLogin.body.code, "ACCOUNT_SETTINGS_BUSY");
  await new Promise((resolve) => setTimeout(resolve, 70));
  const loginDone = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/login`, { headers }));
  assert.equal(loginDone.body.status, "success");
  assert.doesNotMatch(JSON.stringify(loginDone.body), /token=private/);
});

test("failed account switch restores the previous account and active session", async (t) => {
  let activeId = "acc_a";
  const activations = [];
  const publicAccounts = () => ["acc_a", "acc_b"].map((id) => ({ id, name: id, initials: "A", active: id === activeId }));
  const accountManager = {
    async listAccounts() { return publicAccounts(); },
    async activateAccount(accountId) {
      const previousActiveId = activeId;
      activeId = accountId;
      activations.push(accountId);
      return { previousActiveId, accounts: publicAccounts() };
    },
  };
  const fixture = await startFixture(t, { accountManager, failBridgeDuringSetupAt: [1] });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const headers = { Cookie: auth.headers.get("set-cookie").split(";", 1)[0], Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, { method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }) });

  const switched = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/activate`, {
    method: "POST", headers, body: JSON.stringify({ accountId: "acc_b" }),
  }));

  assert.equal(switched.status, 500);
  assert.equal(activeId, "acc_a");
  assert.deepEqual(activations, ["acc_b", "acc_a"]);
  assert.equal(fixture.bridges.length, 3);
  assert.equal(fixture.bridges[2].disposed, undefined);
});

test("failed restart after active-account removal restores the account", async (t) => {
  let activeId = "acc_a";
  let restored = false;
  const publicAccounts = () => ["acc_a", "acc_b"].map((id) => ({ id, name: id, initials: "A", active: id === activeId }));
  const accountManager = {
    async listAccounts() { return publicAccounts(); },
    async removeAccount(accountId) {
      assert.equal(accountId, "acc_a");
      activeId = "acc_b";
      return { accounts: publicAccounts().filter((account) => account.id !== "acc_a"), activeChanged: true, rollback: { token: "opaque" } };
    },
    async restoreRemovedAccount(rollback) {
      assert.deepEqual(rollback, { token: "opaque" });
      restored = true;
      activeId = "acc_a";
      return publicAccounts();
    },
  };
  const fixture = await startFixture(t, { accountManager, failBridgeDuringSetupAt: [1] });
  const auth = await fetch(`${fixture.baseUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: fixture.baseUrl },
    body: JSON.stringify({ token: fixture.token }),
  });
  const headers = { Cookie: auth.headers.get("set-cookie").split(";", 1)[0], Origin: fixture.baseUrl, "Content-Type": "application/json" };
  await fetch(`${fixture.baseUrl}/api/sessions/open`, { method: "POST", headers, body: JSON.stringify({ sessionId: "s_fixture" }) });

  const removed = await responseJson(await fetch(`${fixture.baseUrl}/api/accounts/remove`, {
    method: "POST", headers, body: JSON.stringify({ accountId: "acc_a" }),
  }));

  assert.equal(removed.status, 500);
  assert.equal(restored, true);
  assert.equal(activeId, "acc_a");
  assert.equal(fixture.bridges.length, 3);
  assert.equal(fixture.bridges[2].disposed, undefined);
});

test("server can stop, restart, and stop again without retaining lifecycle state", async (t) => {
  const fixture = await startFixture(t);
  await fixture.server.stop();
  await fixture.server.start();
  assert.ok(fixture.server.address);
  await fixture.server.stop();
  assert.equal(fixture.server.address, undefined);
});

test("server refuses non-loopback bind targets", () => {
  assert.throws(() => createPiBrowserServer({ host: "0.0.0.0" }), /loopback/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import browserApprovalExtension, { materializePiInvocation, PiBridge, resolvePiInvocation } from "../browser/pi-bridge.mjs";
import {
  MAX_BROWSER_COMMAND_BYTES,
  MAX_BROWSER_RPC_LINE_BYTES,
} from "../browser/public/attachment-contract.js";

function fakeWindowsFs(files) {
  const map = new Map(Object.entries(files));
  return {
    existsSync: (file) => map.has(file),
    readFileSync: (file) => map.get(file),
    statSync: (file) => ({ isFile: () => map.has(file) }),
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { child.signalCode = "SIGTERM"; queueMicrotask(() => child.emit("exit", null, "SIGTERM")); return true; };
  return child;
}

test("launcher uses direct pi execution on POSIX without a shell", () => {
  assert.deepEqual(resolvePiInvocation({ platform: "linux", env: {} }), {
    command: "pi", args: ["--mode", "rpc"], shell: false, kind: "direct",
  });
});

test("launcher finds the pinned Windows JavaScript CLI from its package manifest", () => {
  const packageFile = "R:\\Runtime\\node_modules\\@earendil-works\\pi-coding-agent\\package.json";
  const cliFile = "R:\\Runtime\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js";
  const fs = fakeWindowsFs({
    [packageFile]: JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.2.3", bin: { pi: "dist/cli.js" } }),
    [cliFile]: "#!/usr/bin/env node",
  });
  assert.deepEqual(resolvePiInvocation({ platform: "win32", env: { PI_CLI_PACKAGE_JSON: packageFile }, execPath: "R:\\Node\\node.exe", fs }), {
    command: "R:\\Node\\node.exe",
    args: [cliFile, "--mode", "rpc"],
    shell: false,
    kind: "node-cli",
  });
});

test("launcher securely falls back to a Windows cmd shim", () => {
  const shim = "R:\\Commands\\pi.cmd";
  const fs = fakeWindowsFs({ [shim]: "@node cli.js" });
  const invocation = resolvePiInvocation({
    platform: "win32",
    env: { PATH: "R:\\Commands", SystemRoot: "R:\\Windows" },
    execPath: "R:\\Node\\node.exe",
    fs,
    path: path.win32,
  });
  assert.deepEqual(invocation, {
    command: "R:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c"],
    shim,
    baseArgs: ["--mode", "rpc"],
    shell: false,
    windowsVerbatimArguments: false,
    kind: "cmd-shim",
  });
  assert.deepEqual(materializePiInvocation(invocation, ["--extension", "R:\\Safe\\approval.mjs"]).args, [
    "/d", "/s", "/c",
    'call "R:\\Commands\\pi.cmd" "--mode" "rpc" "--extension" "R:\\Safe\\approval.mjs"',
  ]);
});

test("bridge correlates bounded JSONL requests and publishes events", async () => {
  const child = fakeChild();
  const spawnCalls = [];
  const bridge = new PiBridge({
    invocation: { command: "pi", args: ["--mode", "rpc"], shell: false },
    spawn: (...args) => { spawnCalls.push(args); return child; },
    requestTimeoutMs: 500,
  });
  const events = [];
  bridge.subscribe((event) => events.push(event));
  child.stdin.on("data", (chunk) => {
    const request = JSON.parse(String(chunk));
    child.stdout.write(`${JSON.stringify({ type: "response", id: request.id, success: true, data: { active: true } })}\n`);
    child.stdout.write(`${JSON.stringify({ type: "agent_state", state: "running" })}\n`);
  });
  const response = await bridge.request("get_state");
  assert.equal(response.data.active, true);
  const commands = await bridge.request("get_commands");
  assert.equal(commands.data.active, true);
  assert.equal((await bridge.command({ type: "set_session_name", name: "Browser work" })).success, true);
  assert.equal((await bridge.command({ type: "clone" })).success, true);
  assert.deepEqual(events, Array.from({ length: 4 }, () => ({ type: "agent_state", state: "running" })));
  assert.equal(spawnCalls[0][2].shell, false);
  assert.equal(bridge.options.maxCommandBytes, MAX_BROWSER_COMMAND_BYTES);
  assert.equal(bridge.options.maxLineBytes, MAX_BROWSER_RPC_LINE_BYTES);
  await assert.rejects(bridge.request("run_arbitrary", {}), /not allowed/);
  await bridge.dispose({ graceMs: 10 });
});

test("bridge sends extension UI responses without waiting for a Pi response", async () => {
  const child = fakeChild();
  const bridge = new PiBridge({
    invocation: { command: "pi", args: [] },
    spawn: () => child,
    requestTimeoutMs: 20,
  });
  const written = new Promise((resolve) => child.stdin.once("data", (chunk) => resolve(JSON.parse(String(chunk)))));
  await bridge.send({ type: "extension_ui_response", id: "approval-1", confirmed: true });
  assert.deepEqual(await written, { type: "extension_ui_response", id: "approval-1", confirmed: true });
  await assert.rejects(bridge.send({ type: "switch_session", sessionPath: "private" }), /not allowed/);
  await bridge.dispose({ graceMs: 10 });
});

test("bridge accepts bounded RPC responses containing base64 image history", async () => {
  const child = fakeChild();
  const bridge = new PiBridge({
    invocation: { command: "pi", args: [] },
    spawn: () => child,
    requestTimeoutMs: 1_000,
  });
  child.stdin.once("data", (chunk) => {
    const request = JSON.parse(String(chunk));
    const imageData = Buffer.alloc(1024 * 1024).toString("base64");
    child.stdout.write(`${JSON.stringify({ type: "response", id: request.id, success: true, data: { imageData } })}\n`);
  });
  const response = await bridge.request("get_messages");
  assert.equal(response.data.imageData.length, 1_398_104);
  await bridge.dispose({ graceMs: 10 });
});

test("bridge fails closed on malformed or oversized RPC output", async () => {
  for (const output of ["not-json\n", `${"x".repeat(300)}\n`]) {
    const child = fakeChild();
    const bridge = new PiBridge({ invocation: { command: "pi", args: [] }, spawn: () => child, maxLineBytes: 256, requestTimeoutMs: 500 });
    const failure = new Promise((resolve) => bridge.once("bridgeError", resolve));
    const pending = bridge.request("get_state");
    child.stdout.write(output);
    assert.ok(await failure instanceof Error);
    await assert.rejects(pending);
    await bridge.dispose({ graceMs: 10 });
  }
});

test("browser extension reloads Pi resources and enforces all tool access modes", async () => {
  let toolHandler;
  const commands = new Map();
  browserApprovalExtension({
    registerCommand: (name, command) => commands.set(name, command),
    on: (event, callback) => { assert.equal(event, "tool_call"); toolHandler = callback; },
  });
  let reloadCount = 0;
  await commands.get("pi-browser-reload-runtime").handler("", { reload: async () => { reloadCount += 1; } });
  assert.equal(reloadCount, 1);
  assert.equal(await toolHandler({ toolName: "read" }, {}), undefined);
  assert.equal(await toolHandler(
    { toolName: "write", input: { path: path.join(process.cwd(), "package.json") } },
    { cwd: process.cwd() },
  ), undefined);
  let approvalMessage;
  assert.deepEqual(await toolHandler(
    { toolName: "write", input: { path: "R:/Project/file.txt", credentials: { token: "private-fixture" } } },
    { hasUI: true, ui: { confirm: async (_title, message) => { approvalMessage = message; return false; } } },
  ), {
    block: true, reason: "Action denied by user", terminate: true,
  });
  assert.match(approvalMessage, /R:\/Project\/file\.txt/);
  assert.match(approvalMessage, /\[REDACTED\]/);
  assert.doesNotMatch(approvalMessage, /private-fixture/);
  assert.equal(await toolHandler({ toolName: "write" }, { hasUI: true, ui: { confirm: async () => true } }), undefined);
  assert.equal((await toolHandler({ toolName: "bash" }, { hasUI: false })).block, true);

  await commands.get("pi-browser-set-approval-mode").handler("read-only");
  assert.match((await toolHandler({ toolName: "write" }, { cwd: process.cwd() })).reason, /Read Only/);
  await commands.get("pi-browser-set-approval-mode").handler("full-access");
  assert.equal(await toolHandler({ toolName: "bash" }, { hasUI: false }), undefined);
  await assert.rejects(commands.get("pi-browser-set-approval-mode").handler("invalid"), /Invalid browser approval mode/);
});

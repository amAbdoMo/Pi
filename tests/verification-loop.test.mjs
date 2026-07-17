import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  browserIssueFromResult,
  browserToolFromCall,
  isMutatingShellCommand,
  mutationFromTool,
  verificationCommandFromTool,
} from "../extensions/verification-loop/detection.ts";
import {
  MAX_REPAIR_ATTEMPTS,
  VerificationTracker,
  isUiPath,
  isVerifiablePath,
} from "../extensions/verification-loop/state.ts";
import {
  captureWorkspaceSnapshot,
  parsePorcelainStatus,
} from "../extensions/verification-loop/workspace.ts";

const functionalPass = {
  kind: "functional",
  status: "passed",
  summary: "The changed behavior works",
  checks: ["npm test"],
};

const completeBrowserJourney = [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_console_messages",
  "browser_network_requests",
  "browser_take_screenshot",
];

test("a functional change cannot pass until a successful check runs after the change", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation();

  assert.deepEqual(tracker.submitReport(functionalPass), {
    accepted: false,
    message: "Cannot mark verification passed. Missing: a successful automated or command-level check.",
  });

  assert.equal(tracker.recordSuccessfulCheck("npm test"), true);
  assert.equal(tracker.submitReport(functionalPass).accepted, true);
  assert.equal(tracker.snapshot().phase, "passed");

  tracker.recordMutation();
  assert.equal(tracker.snapshot().phase, "pending");
  assert.deepEqual(tracker.snapshot().successfulChecks, []);
  assert.match(tracker.submitReport(functionalPass).message, /successful automated or command-level check/);
});

test("a UI change requires a complete browser user journey as well as automated checks", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation({ ui: true });
  tracker.recordSuccessfulCheck("npm run test");

  for (const toolName of completeBrowserJourney.slice(0, -1)) tracker.recordBrowserTool(toolName);

  const report = {
    kind: "both",
    status: "passed",
    summary: "Desktop interaction and responsive layout work",
    checks: ["npm run test", "Completed the browser journey"],
  };
  const incomplete = tracker.submitReport(report);
  assert.equal(incomplete.accepted, false);
  assert.match(incomplete.message, /final screenshot/);

  tracker.recordBrowserTool("browser_take_screenshot");
  assert.equal(tracker.submitReport(report).accepted, true);
  assert.equal(tracker.snapshot().phase, "passed");
});

test("failed verification triggers a bounded repair loop and allows a fresh user retry", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation();
  tracker.recordFailedCheck("npm test");
  tracker.submitReport({
    kind: "functional",
    status: "failed",
    summary: "Checkout total is incorrect",
    checks: ["npm test"],
    issues: ["Expected 20 but received 10"],
  });

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const prompt = tracker.takeFollowUpPrompt();
    assert.match(prompt, new RegExp(`attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`));
  }
  assert.equal(tracker.takeFollowUpPrompt(), undefined);
  assert.equal(tracker.shouldNotifyExhausted(), true);
  tracker.markExhaustionNotified();
  assert.equal(tracker.shouldNotifyExhausted(), false);

  tracker.beginUserTask();
  assert.equal(tracker.canRequestFollowUp(), false);
  assert.equal(tracker.snapshot().attempts, MAX_REPAIR_ATTEMPTS);
  tracker.retryVerification();
  assert.equal(tracker.canRequestFollowUp(), true);
  assert.equal(tracker.snapshot().attempts, 0);
});

test("retry clears stale evidence but preserves the pending feature requirement", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation({ ui: true });
  tracker.recordSuccessfulCheck("npm test");
  tracker.recordBrowserTool("browser_navigate");
  tracker.takeFollowUpPrompt();

  tracker.retryVerification();

  const state = tracker.snapshot();
  assert.equal(state.phase, "pending");
  assert.equal(state.functionalChange, true);
  assert.equal(state.uiChange, true);
  assert.equal(state.attempts, 0);
  assert.deepEqual(state.successfulChecks, []);
  assert.equal(state.browser.navigated, false);
  assert.equal(tracker.canRequestFollowUp(), true);
});

test("observed browser failures prevent a success report until the feature changes and is rechecked", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation({ ui: true });
  tracker.recordSuccessfulCheck("npm test");
  for (const toolName of completeBrowserJourney) tracker.recordBrowserTool(toolName);
  tracker.recordObservedIssue("Browser console issue: TypeError in checkout.js");
  tracker.submitReport({
    kind: "ui",
    status: "failed",
    summary: "The browser journey exposed an error",
    checks: ["npm test", "Browser journey"],
  });

  const result = tracker.submitReport({
    kind: "ui",
    status: "passed",
    summary: "Checkout appears usable",
    checks: ["npm test", "Browser journey"],
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /unresolved issues/);
  assert.equal(tracker.snapshot().phase, "failed");
});

test("browser evidence must follow navigation, inspection, interaction, diagnostics, then final screenshot", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation({ ui: true });
  tracker.recordSuccessfulCheck("npm test");

  for (const toolName of [...completeBrowserJourney].reverse()) tracker.recordBrowserTool(toolName);

  const result = tracker.submitReport({
    kind: "ui",
    status: "passed",
    summary: "Attempted an out-of-order browser check",
    checks: ["npm test", "Browser journey"],
  });
  assert.equal(result.accepted, false);
  assert.match(result.message, /accessibility snapshot/);
  assert.match(result.message, /final screenshot/);
});

test("a passed report cannot contain unresolved issues", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation();
  tracker.recordSuccessfulCheck("npm test");

  const result = tracker.submitReport({
    ...functionalPass,
    issues: ["The mobile submit button still overlaps the footer"],
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /unresolved issues/);
  assert.equal(tracker.snapshot().phase, "pending");
});

test("an explicit blocker stops automatic follow-ups without claiming a pass", () => {
  const tracker = new VerificationTracker();
  tracker.recordMutation({ ui: true });

  const result = tracker.submitReport({
    kind: "ui",
    status: "blocked",
    summary: "The application server cannot start without the missing local database",
    checks: ["npm run dev"],
    issues: ["Connection refused on the configured database port"],
  });

  assert.equal(result.accepted, true);
  assert.equal(tracker.snapshot().phase, "blocked");
  assert.equal(tracker.canRequestFollowUp(), false);

  tracker.beginUserTask();
  assert.equal(tracker.snapshot().phase, "blocked");
  tracker.recordMutation({ ui: true });
  assert.equal(tracker.snapshot().phase, "pending");
  assert.equal(tracker.snapshot().attempts, 0);
});

test("change detection ignores documentation but recognizes runtime and UI files", () => {
  assert.equal(isVerifiablePath("README.md"), false);
  assert.equal(isVerifiablePath("docs/setup.mdx"), false);
  assert.equal(isVerifiablePath("src/service.ts"), true);
  assert.equal(isUiPath("src/components/Button.tsx"), true);
  assert.equal(isUiPath("src/service.ts"), false);

  assert.equal(mutationFromTool("edit", { path: "README.md" }), undefined);
  assert.deepEqual(mutationFromTool("edit", { path: "src/components/Button.tsx" }), {
    path: "src/components/Button.tsx",
    ui: true,
  });
  assert.equal(mutationFromTool("delegate", { task: "Read-only investigation; do not edit files" }), undefined);
  assert.deepEqual(mutationFromTool("delegate", { task: "Implement the checkout fix" }), { ui: false });
});

test("shell and MCP observations distinguish verification from mutation", () => {
  assert.equal(isMutatingShellCommand("npm test"), false);
  assert.equal(isMutatingShellCommand("node -e \"console.log(2 > 1)\""), false);
  assert.equal(isMutatingShellCommand("echo fixed > src/result.txt"), true);
  assert.equal(verificationCommandFromTool("bash", { command: "npm run test" }), "npm run test");
  assert.equal(verificationCommandFromTool("bash", { command: "npm run dev" }), undefined);
  assert.equal(
    browserToolFromCall("mcp", { action: "call", server: "browser", tool: "browser_snapshot" }),
    "browser_snapshot",
  );
  assert.equal(browserToolFromCall("mcp", { action: "list", server: "browser" }), undefined);
  assert.match(
    browserIssueFromResult("browser_console_messages", "[error] TypeError: cannot read property"),
    /Browser console issue/,
  );
  assert.match(
    browserIssueFromResult("browser_network_requests", "GET /api/checkout 500"),
    /Browser network issue/,
  );
  assert.equal(browserIssueFromResult("browser_console_messages", "No console messages"), undefined);
});

test("Git workspace status parsing includes tracked, untracked, and renamed paths", () => {
  assert.deepEqual(
    parsePorcelainStatus(" M src/a.ts\0?? src/new.ts\0R  src/new-name.ts\0src/old-name.ts\0"),
    [
      { path: "src/a.ts", untracked: false },
      { path: "src/new.ts", untracked: true },
      { path: "src/new-name.ts", untracked: false },
      { path: "src/old-name.ts", untracked: false },
    ],
  );
});

test("workspace fingerprints change when already-dirty tracked or untracked contents change", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-verification-workspace-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync("git", ["config", "user.email", "verification@example.invalid"], { cwd });
  execFileSync("git", ["config", "user.name", "Verification Test"], { cwd });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd });
  fs.writeFileSync(path.join(cwd, "feature.ts"), "export const value = 1;\n");
  execFileSync("git", ["add", "feature.ts"], { cwd });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd });

  const execApi = {
    async exec(command, args, options = {}) {
      try {
        return {
          stdout: execFileSync(command, args, { cwd: options.cwd, encoding: "utf8" }),
          stderr: "",
          code: 0,
          killed: false,
        };
      } catch (error) {
        return {
          stdout: String(error.stdout ?? ""),
          stderr: String(error.stderr ?? ""),
          code: error.status ?? 1,
          killed: false,
        };
      }
    },
  };

  fs.writeFileSync(path.join(cwd, "feature.ts"), "export const value = 2;\n");
  const firstTracked = await captureWorkspaceSnapshot(execApi, cwd);
  fs.writeFileSync(path.join(cwd, "feature.ts"), "export const value = 3;\n");
  const secondTracked = await captureWorkspaceSnapshot(execApi, cwd);
  assert.notEqual(firstTracked.fingerprint, secondTracked.fingerprint);

  fs.writeFileSync(path.join(cwd, "new-feature.ts"), "export const added = 1;\n");
  const firstUntracked = await captureWorkspaceSnapshot(execApi, cwd);
  fs.writeFileSync(path.join(cwd, "new-feature.ts"), "export const added = 2;\n");
  const secondUntracked = await captureWorkspaceSnapshot(execApi, cwd);
  assert.notEqual(firstUntracked.fingerprint, secondUntracked.fingerprint);
});

const extensionModuleStubs = new Map([
  ["@earendil-works/pi-ai", "export function StringEnum(values, options = {}) { return { values, ...options }; }"],
  ["typebox", "export const Type = new Proxy({}, { get: () => (...args) => ({ args }) });"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (extensionModuleStubs.has(specifier)) {
      return { url: `verification-loop-stub:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("verification-loop-stub:")) {
      return {
        format: "module",
        source: extensionModuleStubs.get(url.slice("verification-loop-stub:".length)),
        shortCircuit: true,
      };
    }
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
          mode: "transform",
          sourceMap: false,
        }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { default: verificationLoopExtension } = await import(
  "../extensions/verification-loop/index.ts"
);

function createExtensionHarness() {
  const handlers = new Map();
  const tools = new Map();
  const followUps = [];
  const entries = [];
  const statuses = [];
  const pi = {
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    on(eventName, handler) {
      const eventHandlers = handlers.get(eventName) ?? [];
      eventHandlers.push(handler);
      handlers.set(eventName, eventHandlers);
    },
    registerCommand() {},
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    sendUserMessage(message) { followUps.push(message); },
  };
  const ctx = {
    cwd: "C:/workspace",
    isIdle: () => true,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify() {},
      setStatus(id, value) { statuses.push([id, value]); },
    },
  };
  verificationLoopExtension(pi);
  return { ctx, entries, followUps, handlers, statuses, tools };
}

async function startExtensionHarness(harness) {
  await harness.handlers.get("session_start")[0]({}, harness.ctx);
  await harness.handlers.get("input")[0]({ source: "interactive", streamingBehavior: undefined }, harness.ctx);
}

async function completeToolCall(harness, event) {
  await harness.handlers.get("tool_call")[0]({ toolCallId: event.toolCallId });
  await harness.handlers.get("tool_result")[0](event, harness.ctx);
}

test("the extension automatically requests repair when an agent settles without an accepted report", async () => {
  const harness = createExtensionHarness();
  await startExtensionHarness(harness);
  await completeToolCall(harness, {
    toolCallId: "edit-1",
    toolName: "edit",
    input: { path: "src/service.ts" },
    isError: false,
  });
  await completeToolCall(harness, {
    toolCallId: "test-1",
    toolName: "bash",
    input: { command: "npm test" },
    isError: false,
  });
  await harness.handlers.get("agent_settled")[0]({}, harness.ctx);

  assert.equal(harness.followUps.length, 1);
  assert.match(harness.followUps[0], /AUTOMATIC VERIFICATION REQUIRED/);

  const reportTool = harness.tools.get("verification_report");
  await reportTool.execute("report-1", functionalPass, undefined, undefined, harness.ctx);
  await harness.handlers.get("agent_settled")[0]({}, harness.ctx);

  assert.equal(harness.followUps.length, 1);
  assert.ok(harness.statuses.some(([, value]) => value === "verification passed"));
});

test("tree navigation restores verification state from the active branch", async () => {
  const harness = createExtensionHarness();
  harness.entries.push({
    type: "custom",
    customType: "verification-loop-state",
    data: { enabled: false, phase: "clean" },
  });
  await harness.handlers.get("session_start")[0]({}, harness.ctx);
  assert.equal(await harness.handlers.get("before_agent_start")[0](), undefined);

  harness.entries.splice(0);
  await harness.handlers.get("session_tree")[0]({}, harness.ctx);
  const branchPrompt = await harness.handlers.get("before_agent_start")[0]();
  assert.match(branchPrompt.message.content, /AUTOMATIC FEATURE VERIFICATION/);
});

test("parallel checks that started before a successful edit cannot satisfy the gate", async () => {
  const harness = createExtensionHarness();
  await startExtensionHarness(harness);
  const toolCall = harness.handlers.get("tool_call")[0];
  const toolResult = harness.handlers.get("tool_result")[0];

  await toolCall({ toolCallId: "edit-parallel" });
  await toolCall({ toolCallId: "test-parallel" });
  await toolResult({
    toolCallId: "edit-parallel",
    toolName: "edit",
    input: { path: "src/service.ts" },
    isError: false,
  }, harness.ctx);
  await toolResult({
    toolCallId: "test-parallel",
    toolName: "bash",
    input: { command: "npm test" },
    isError: false,
  }, harness.ctx);

  const reportTool = harness.tools.get("verification_report");
  await assert.rejects(
    reportTool.execute("report-stale", functionalPass, undefined, undefined, harness.ctx),
    /successful automated or command-level check/,
  );
});

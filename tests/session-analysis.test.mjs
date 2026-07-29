import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analyzerPath = path.join(repoRoot, "scripts", "analyze-sessions.mjs");
const generatorPath = path.join(repoRoot, "scripts", "generate-session-report.mjs");

function sessionEntry(type, timestamp, fields = {}) {
  return JSON.stringify({ type, timestamp, ...fields });
}

function writeSession(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-analysis-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now() - 10_000;
  const timestamp = (offsetMs = 0) => new Date(now + offsetMs).toISOString();
  const secret = "PRIVATE_PROMPT_SENTINEL";

  writeSession(path.join(root, "--C--Users-Private--", "private-session.jsonl"), [
    sessionEntry("session", timestamp(-1000), { version: 3, id: "11111111-1111-4111-8111-111111111111", cwd: "C:\\Users\\Private\\Secret Project" }),
    sessionEntry("message", timestamp(), { message: { role: "user", content: secret } }),
    sessionEntry("message", timestamp(100), { message: {
      role: "assistant",
      provider: "openai-codex",
      model: "019fadd2-bcb3-7b28-a9c4-d581a4eb286e",
      stopReason: "toolUse",
      usage: { input: 10, output: 2, cacheRead: 20, cacheWrite: 0, totalTokens: 32, cost: { input: 0.02, output: 0.02, cacheRead: 0.06, cacheWrite: 0, total: 0.1 } },
      content: [{ type: "toolCall", id: "call-private", name: "read", arguments: { path: "C:\\Secret\\private.txt" } }],
    } }),
    sessionEntry("message", timestamp(200), { message: {
      role: "toolResult",
      toolCallId: "call-private",
      toolName: "read",
      isError: false,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.005, output: 0.015, cacheRead: 0, cacheWrite: 0, total: 0.02 } },
      content: [{ type: "text", text: "PRIVATE_TOOL_OUTPUT" }, { type: "image", mimeType: "image/png", data: Buffer.from("image").toString("base64") }],
    } }),
    sessionEntry("compaction", timestamp(300), {
      tokensBefore: 120,
      summary: "PRIVATE_SUMMARY",
      usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { input: 0.01, output: 0.03, cacheRead: 0, cacheWrite: 0, total: 0.04 } },
    }),
    "{malformed",
    sessionEntry("message", new Date(now - 10 * 86400000).toISOString(), { message: { role: "user", content: "OLD_PRIVATE_TEXT" } }),
  ]);

  writeSession(path.join(root, "subagents", "parent-private", "agent-private", "child.jsonl"), [
    sessionEntry("session", timestamp(), { version: 3, id: "22222222-2222-4222-8222-222222222222", cwd: "/home/private/child" }),
    sessionEntry("message", timestamp(50), { message: { role: "user", content: "PRIVATE_DELEGATE_BRIEF" } }),
    sessionEntry("message", timestamp(100), { message: {
      role: "assistant",
      provider: "openai-codex",
      model: "gpt-safe",
      stopReason: "stop",
      usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0.02, output: 0.04, cacheRead: 0, cacheWrite: 0, total: 0.06 } },
      content: [{ type: "text", text: "PRIVATE_CHILD_OUTPUT" }],
    } }),
  ]);

  return { root, secret };
}

test("public aggregates preserve usage facts while removing private session content", (t) => {
  const { root, secret } = fixture(t);
  const output = execFileSync(process.execPath, [analyzerPath, "--days", "2", "--session-dir", root], { encoding: "utf8" });
  const report = JSON.parse(output);

  assert.equal(report.totals.sessions, 2);
  assert.equal(report.parentTotals.sessions, 1);
  assert.equal(report.subagentTotals.sessions, 1);
  assert.equal(report.totals.usage.total.totalTokens, 44);
  assert.equal(report.totals.usage.total.sessionReportedEstimatedCost, 0.22);
  assert.equal(report.totals.compactions, 1);
  assert.equal(report.totals.compactionTokensBefore.median, 120);
  assert.equal(report.totals.nestedToolResults, 1);
  assert.equal(report.totals.imagePayloadBytes, 5);
  assert.equal(report.diagnostics.malformedRecords, 1);
  assert.equal(report.diagnostics.recordsOutsideWindow, 1);
  assert.deepEqual(report.sessions.map((session) => session.alias), ["S-001", "S-002"]);

  for (const privateValue of [secret, "PRIVATE_TOOL_OUTPUT", "PRIVATE_SUMMARY", "PRIVATE_DELEGATE_BRIEF", "Private", "private-session.jsonl", "11111111-1111-4111-8111-111111111111", "019fadd2-bcb3-7b28-a9c4-d581a4eb286e", "C:\\Users"] ) {
    assert.equal(output.includes(privateValue), false, `report leaked ${privateValue}`);
  }
});

test("standalone report generation stays private and malformed CLI input fails", (t) => {
  const { root } = fixture(t);
  const outputPath = path.join(root, "public", "audit.html");
  execFileSync(process.execPath, [generatorPath, "--days", "2", "--session-dir", root, "--output", outputPath], { encoding: "utf8" });
  const html = fs.readFileSync(outputPath, "utf8");

  assert.match(html, /Session Flight Recorder/);
  assert.match(html, /const REPORT = \{/);
  assert.doesNotMatch(html, /__PI_REPORT_DATA__|PRIVATE_|[A-Za-z]:[\\/]|\.jsonl\b|(?:src|href)=["']https?:/i);

  const invalid = spawnSync(process.execPath, [analyzerPath, "--days", "0"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /positive number/);
});

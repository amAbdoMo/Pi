#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analyzerPath = path.join(root, "scripts", "analyze-sessions.mjs");
const templatePath = path.join(root, "reports", "pi-workflow-audit.template.html");
const defaultOutputPath = path.join(root, "reports", "pi-workflow-audit.html");
const dataMarker = "/*__PI_REPORT_DATA__*/{}";
const forbiddenReportKeys = new Set([
  "cwd",
  "path",
  "filePath",
  "filename",
  "sessionId",
  "sessionFile",
  "prompt",
  "arguments",
  "rawContent",
  "toolOutput",
  "errorMessage",
  "screenshot",
  "imageData",
]);
const forbiddenReportPatterns = [
  ["absolute Windows path", /[A-Za-z]:[\\/]/],
  ["absolute user path", /\/(?:Users|home)\/[^\s\"']+/i],
  ["session filename", /\.jsonl\b/i],
  ["UUID", /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~-]{12,}/i],
  ["common API key", /\b(?:sk|ghp|github_pat|AIza)[-_A-Za-z0-9]{16,}/],
  ["embedded image", /data:image\/[a-z0-9.+-]+;base64,/i],
];

function usage() {
  return `Usage: node scripts/generate-session-report.mjs [options]\n\nOptions:\n  --days N          Analyze the last N days (default: 30)\n  --session-dir DIR Override the Pi session directory\n  --output FILE     Write the standalone report to FILE\n  --help            Show this help\n`;
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = { days: "30", output: defaultOutputPath, sessionDir: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--days") options.days = requiredValue(argv, index++, argument);
    else if (argument === "--session-dir") options.sessionDir = requiredValue(argv, index++, argument);
    else if (argument === "--output") options.output = path.resolve(requiredValue(argv, index++, argument));
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function analyzerArguments(options) {
  const args = [analyzerPath, "--days", options.days];
  if (options.sessionDir) args.push("--session-dir", options.sessionDir);
  return args;
}

function embeddedJson(report) {
  return JSON.stringify(report).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function assertSafeKeys(value, location = "report") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeKeys(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenReportKeys.has(key)) throw new Error(`privacy guard rejected forbidden field ${location}.${key}`);
    assertSafeKeys(entry, `${location}.${key}`);
  }
}

function assertAnonymousSessions(report) {
  const allowedLabels = new Set(report.privacy?.workspaceLabels || []);
  for (const session of report.sessions || []) {
    if (!/^S-\d{3,}$/.test(session.alias)) throw new Error("privacy guard rejected a non-anonymous session alias");
    if (!["parent", "subagent"].includes(session.kind)) throw new Error("privacy guard rejected an unknown session kind");
    if (!allowedLabels.has(session.workspaceLabel)) throw new Error("privacy guard rejected an unclassified workspace label");
  }
}

function assertPublicSafeReport(report) {
  assertSafeKeys(report);
  assertAnonymousSessions(report);
  const serialized = JSON.stringify(report);
  for (const [label, pattern] of forbiddenReportPatterns) {
    if (pattern.test(serialized)) throw new Error(`privacy guard detected ${label}`);
  }
}

function assertStandaloneHtml(html) {
  if (/(?:src|href)=["']https?:/i.test(html)) throw new Error("standalone report must not load external resources");
  if (html.includes(dataMarker)) throw new Error("generated report still contains the data marker");
}

function generateReport(options) {
  const analysisJson = execFileSync(process.execPath, analyzerArguments(options), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const report = JSON.parse(analysisJson);
  assertPublicSafeReport(report);
  const template = fs.readFileSync(templatePath, "utf8");
  if (!template.includes(dataMarker)) throw new Error("report template data marker is missing");
  const html = template.replace(dataMarker, embeddedJson(report));
  assertStandaloneHtml(html);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, html, "utf8");
  console.log(`Generated privacy-safe report: ${options.output}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(usage());
  else generateReport(options);
} catch (error) {
  console.error(`generate-session-report: ${error.message}`);
  process.exitCode = 1;
}

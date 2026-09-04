import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createCheckpoint,
  loadBootstrapManifest,
  parseBootstrapArguments,
  restoreCheckpoint,
} from "../scripts/bootstrap.mjs";
import {
  installedManagedSources,
  managedPackagePresence,
  removeNewManagedPackages,
  restorePreviousPiVersion,
} from "../scripts/bootstrap/runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("bootstrap CLI keeps install as the default and exposes recovery commands", () => {
  assert.equal(parseBootstrapArguments([]).command, "install");
  assert.deepEqual(
    parseBootstrapArguments(["install", "--skip-ffmpeg", "--skip-terminal"]),
    {
      command: "install",
      showHelp: false,
      json: false,
      skipFfmpeg: true,
      skipTerminal: true,
      checkpoint: undefined,
    },
  );
  assert.equal(parseBootstrapArguments(["diagnose", "--json"]).json, true);
  assert.equal(parseBootstrapArguments(["rollback", "--checkpoint", "checkpoint-dir"]).checkpoint, "checkpoint-dir");
  assert.throws(() => parseBootstrapArguments(["unknown"]), /unknown command/);
  assert.throws(() => parseBootstrapArguments(["verify", "--skip-terminal"]), /install-only/);
  assert.throws(() => parseBootstrapArguments(["diagnose", "--checkpoint", "x"]), /rollback-only/);

  const output = execFileSync(process.execPath, [path.join(root, "scripts", "install-cli.mjs"), "--help"], {
    encoding: "utf8",
  });
  for (const command of ["diagnose", "install", "verify", "rollback"]) assert.match(output, new RegExp(command));
  assert.match(output, /github:amAbdoMo\/Pi/);
});

test("bootstrap manifest pins managed runtime sources and constrains CI overrides", () => {
  const manifest = loadBootstrapManifest(root, {});
  assert.equal(manifest.release, "0.13.0");
  assert.match(manifest.packages.pi, /@0\.84\.4$/);
  assert.match(manifest.packages.workbench, /@v0\.13\.0$/);
  assert.match(manifest.packages.contextMode, /@1\.0\.169$/);
  assert.equal(manifest.packages.playwrightMcp, "@playwright/mcp@0.0.79");

  const override = "git:github.com/amAbdoMo/Pi@0123456789abcdef";
  assert.equal(loadBootstrapManifest(root, { PI_WORKBENCH_PACKAGE_SPEC: override }).packages.workbench, override);
  for (const invalidSource of [
    "git:github.com/other/repository@main",
    "git:github.com/amAbdoMo/Pi",
  ]) {
    assert.throws(
      () => loadBootstrapManifest(root, { PI_WORKBENCH_PACKAGE_SPEC: invalidSource }),
      /must be a pinned git:github\.com\/amAbdoMo\/Pi source/,
    );
  }
});

test("checkpoint restore is allowlisted, integrity-checked, and excludes private state", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-checkpoint-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "agent");
  const manifest = loadBootstrapManifest(root, {});
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"theme":"before"}\n');
  fs.writeFileSync(path.join(agentDir, "keybindings.json"), '{"before":true}\n');
  fs.writeFileSync(path.join(agentDir, "auth.json"), '{"token":"private-before"}\n');
  fs.writeFileSync(path.join(agentDir, "trust.json"), '{"trusted":true}\n');
  fs.writeFileSync(path.join(agentDir, "sessions", "private.jsonl"), "private-before\n");

  const created = createCheckpoint({
    agentDir,
    manifest,
    now: new Date("2026-01-02T03:04:05.000Z"),
    previousPiVersion: "0.80.0",
    managedPackageSources: [
      "git:github.com/amAbdoMo/Pi@abc123",
      "npm:context-mode@1.0.100",
    ],
    managedPackagePresence: { workbench: true, contextMode: false },
  });
  const checkpoint = readJson(path.join(created.directory, "checkpoint.json"));
  assert.equal(checkpoint.previousPiVersion, "0.80.0");
  assert.deepEqual(checkpoint.managedPackageSources, [
    "git:github.com/amAbdoMo/Pi@abc123",
    "npm:context-mode@1.0.100",
  ]);
  assert.deepEqual(checkpoint.managedPackagePresence, { workbench: true, contextMode: false });
  assert.equal(checkpoint.entries.some((entry) => /auth|trust|sessions/i.test(entry.relativePath)), false);

  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"theme":"after"}\n');
  fs.writeFileSync(path.join(agentDir, "keybindings.json"), '{"after":true}\n');
  fs.writeFileSync(path.join(agentDir, "mcp.json"), '{"created":"after"}\n');
  fs.writeFileSync(path.join(agentDir, "auth.json"), '{"token":"private-after"}\n');
  fs.writeFileSync(path.join(agentDir, "trust.json"), '{"trusted":false}\n');
  fs.writeFileSync(path.join(agentDir, "sessions", "private.jsonl"), "private-after\n");

  restoreCheckpoint({ agentDir, manifest, directory: created.directory });
  assert.equal(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"), '{"theme":"before"}\n');
  assert.equal(fs.readFileSync(path.join(agentDir, "keybindings.json"), "utf8"), '{"before":true}\n');
  assert.equal(fs.existsSync(path.join(agentDir, "mcp.json")), false);
  assert.equal(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8"), '{"token":"private-after"}\n');
  assert.equal(fs.readFileSync(path.join(agentDir, "trust.json"), "utf8"), '{"trusted":false}\n');
  assert.equal(fs.readFileSync(path.join(agentDir, "sessions", "private.jsonl"), "utf8"), "private-after\n");
});

test("rollback without a path selects the newest checkpoint", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-latest-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "agent");
  const manifest = loadBootstrapManifest(root, {});
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"generation":1}\n');
  createCheckpoint({ agentDir, manifest, now: new Date("2026-01-01T00:00:00.000Z") });
  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"generation":2}\n');
  createCheckpoint({ agentDir, manifest, now: new Date("2026-01-02T00:00:00.000Z") });
  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"generation":3}\n');

  restoreCheckpoint({ agentDir, manifest });
  assert.equal(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"), '{"generation":2}\n');
});

test("rollback records immutable versions for installed managed packages", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-sources-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "agent");
  const workbenchDir = path.join(agentDir, "git", "github.com", "amAbdoMo", "Pi");
  const contextModeDir = path.join(agentDir, "npm", "node_modules", "context-mode");
  fs.mkdirSync(workbenchDir, { recursive: true });
  fs.mkdirSync(contextModeDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    packages: ["git:github.com/amAbdoMo/Pi", "npm:context-mode"],
  }));
  fs.writeFileSync(path.join(workbenchDir, "package.json"), '{"name":"pi-workbench"}\n');
  fs.writeFileSync(path.join(contextModeDir, "package.json"), '{"version":"1.0.100"}\n');
  execFileSync("git", ["init", "--quiet"], { cwd: workbenchDir });
  execFileSync("git", ["config", "user.email", "bootstrap-test@example.invalid"], { cwd: workbenchDir });
  execFileSync("git", ["config", "user.name", "Bootstrap Test"], { cwd: workbenchDir });
  execFileSync("git", ["add", "package.json"], { cwd: workbenchDir });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: workbenchDir });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workbenchDir, encoding: "utf8" }).trim();

  assert.deepEqual(installedManagedSources(agentDir), [
    `git:github.com/amAbdoMo/Pi@${commit}`,
    "npm:context-mode@1.0.100",
  ]);
});

test("clean-install rollback removes only managed packages introduced by install", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-clean-rollback-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const before = managedPackagePresence(agentDir);
  const workbenchDir = path.join(agentDir, "git", "github.com", "amAbdoMo", "Pi");
  const contextModeDir = path.join(agentDir, "npm", "node_modules", "context-mode");
  fs.mkdirSync(workbenchDir, { recursive: true });
  fs.mkdirSync(contextModeDir, { recursive: true });
  fs.writeFileSync(path.join(workbenchDir, "package.json"), "{}\n");
  fs.writeFileSync(path.join(contextModeDir, "package.json"), "{}\n");

  removeNewManagedPackages({ managedPackagePresence: before }, agentDir);
  assert.equal(fs.existsSync(workbenchDir), false);
  assert.equal(fs.existsSync(contextModeDir), false);

  fs.mkdirSync(workbenchDir, { recursive: true });
  removeNewManagedPackages({ managedPackagePresence: { workbench: true, contextMode: false } }, agentDir);
  assert.equal(fs.existsSync(workbenchDir), true);
});

test("clean-install rollback uninstalls Pi while upgrade rollback restores its version", () => {
  const calls = [];
  const runNpmCommand = (args) => calls.push(args);
  restorePreviousPiVersion(undefined, {
    installedPiFn: () => ({ version: "0.84.4" }),
    runNpmCommand,
  });
  restorePreviousPiVersion("0.83.0", {
    installedPiFn: () => ({ version: "0.84.4" }),
    runNpmCommand,
  });
  restorePreviousPiVersion("0.84.4", {
    installedPiFn: () => ({ version: "0.84.4" }),
    runNpmCommand,
  });
  assert.deepEqual(calls, [
    ["uninstall", "-g", "@earendil-works/pi-coding-agent"],
    ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent@0.83.0"],
  ]);
});

test("rollback rejects a checkpoint whose contents changed after creation", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-integrity-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "agent");
  const manifest = loadBootstrapManifest(root, {});
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "settings.json"), '{"theme":"before"}\n');
  const created = createCheckpoint({ agentDir, manifest });
  fs.appendFileSync(path.join(created.directory, "files", "settings.json"), "tampered");

  assert.throws(
    () => restoreCheckpoint({ agentDir, manifest, directory: created.directory }),
    /failed integrity verification/,
  );
});

test("checkpoint paths cannot escape the agent directory", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-path-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const manifest = { ...loadBootstrapManifest(root, {}), checkpointFiles: ["../auth.json"] };
  assert.throws(
    () => createCheckpoint({ agentDir: path.join(testRoot, "agent"), manifest }),
    /escapes the agent directory/,
  );
});

test("diagnose is read-only for a fresh agent directory", (t) => {
  const testRoot = temporaryDirectory("pi-bootstrap-diagnose-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, "missing-agent");
  const result = execFileSync(
    process.execPath,
    [path.join(root, "scripts", "install-cli.mjs"), "diagnose", "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    },
  );
  const report = JSON.parse(result);
  assert.equal(report.title, "Pi Workbench diagnosis");
  assert.equal(report.results.some((item) => item.status === "fail"), false);
  assert.equal(fs.existsSync(agentDir), false);
});

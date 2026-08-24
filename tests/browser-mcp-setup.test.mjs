import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadMcpConfiguration } from "../extensions/mcp/config.ts";
import { installBrowserMcp } from "../scripts/setup-browser-mcp.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-browser-mcp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = path.join(root, ".pi", "agent");
  const supervisorSource = path.join(root, "pi-browser-mcp.ps1");
  const watcherSource = path.join(root, "pi-browser-idle-close.ps1");
  fs.writeFileSync(supervisorSource, "supervisor\n");
  fs.writeFileSync(watcherSource, "watcher\n");
  return { root, agentDir, supervisorSource, watcherSource };
}

function install(paths) {
  return installBrowserMcp({ ...paths, platform: "win32" });
}

test("browser MCP setup installs scripts and two loadable managed server definitions", async (t) => {
  const paths = fixture(t);
  const result = install(paths);

  assert.equal(fs.readFileSync(result.supervisorTarget, "utf8"), "supervisor\n");
  assert.equal(fs.readFileSync(result.watcherTarget, "utf8"), "watcher\n");
  const config = JSON.parse(fs.readFileSync(result.configPath, "utf8"));
  assert.deepEqual(Object.keys(config.mcp), ["browser", "Browser Iso"]);
  assert.equal(config.mcp.browser.piWorkbenchManaged, true);
  assert.equal(config.mcp.browser.command[0], "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(config.mcp.browser.command.slice(-2), ["-File", result.supervisorTarget]);
  assert.deepEqual(config.mcp["Browser Iso"].command.slice(-3), ["-File", result.supervisorTarget, "-Isolated"]);

  const loaded = await loadMcpConfiguration({
    cwd: paths.root,
    homeDirectory: paths.root,
    agentDirectory: paths.agentDir,
    includeProject: false,
  });
  assert.deepEqual([...loaded.servers.keys()], ["browser", "Browser Iso"]);
  assert.equal(loaded.diagnostics.length, 0);
});

test("browser MCP setup is idempotent and refreshes managed definitions", (t) => {
  const paths = fixture(t);
  const first = install(paths);
  const before = fs.readFileSync(first.configPath, "utf8");
  const second = install(paths);

  assert.equal(second.scriptsChanged, false);
  assert.equal(second.configChanged, false);
  assert.equal(fs.readFileSync(second.configPath, "utf8"), before);

  const config = JSON.parse(before);
  config.mcp.browser.command = ["stale"];
  fs.writeFileSync(first.configPath, JSON.stringify(config));
  const refreshed = install(paths);
  assert.equal(refreshed.configChanged, true);
  assert.notDeepEqual(JSON.parse(fs.readFileSync(first.configPath, "utf8")).mcp.browser.command, ["stale"]);
});

test("browser MCP setup preserves user-managed definitions", (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.agentDir, { recursive: true });
  const configPath = path.join(paths.agentDir, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    mcp: {
      browser: { type: "remote", url: "https://example.test/mcp" },
      unrelated: { type: "local", command: ["node", "server.mjs"] },
    },
  }));

  const result = install(paths);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(result.preserved, ["browser"]);
  assert.deepEqual(config.mcp.browser, { type: "remote", url: "https://example.test/mcp" });
  assert.deepEqual(config.mcp.unrelated, { type: "local", command: ["node", "server.mjs"] });
  assert.equal(config.mcp["Browser Iso"].piWorkbenchManaged, true);
});

test("browser MCP setup fails closed on invalid managed config", (t) => {
  const paths = fixture(t);
  fs.mkdirSync(paths.agentDir, { recursive: true });
  const configPath = path.join(paths.agentDir, "mcp.json");
  fs.writeFileSync(configPath, "not json\n");

  assert.throws(() => install(paths), /Cannot parse managed MCP config/);
  assert.equal(fs.readFileSync(configPath, "utf8"), "not json\n");
});

test("browser MCP setup is a no-op outside Windows", (t) => {
  const paths = fixture(t);
  const result = installBrowserMcp({ ...paths, platform: "linux" });
  assert.deepEqual(result, { skipped: true, reason: "Windows-only" });
  assert.equal(fs.existsSync(paths.agentDir), false);
});

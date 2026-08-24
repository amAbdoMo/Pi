#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "piWorkbenchManaged";

function isRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

function writeTextRecoverably(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const token = `${process.pid}-${Date.now()}`;
  const temporaryPath = `${filePath}.tmp-${token}`;
  const backupPath = `${filePath}.backup-${token}`;
  const hadExistingFile = fs.existsSync(filePath);
  fs.writeFileSync(temporaryPath, contents);

  try {
    if (hadExistingFile) fs.renameSync(filePath, backupPath);
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    if (hadExistingFile && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath);
    }
    throw error;
  }

  if (hadExistingFile) {
    try {
      fs.rmSync(backupPath, { force: true });
    } catch (error) {
      console.warn(`Updated ${filePath}, but could not remove backup ${backupPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function copyRecoverably(sourcePath, targetPath) {
  const contents = fs.readFileSync(sourcePath);
  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(contents)) return false;
  writeTextRecoverably(targetPath, contents);
  return true;
}

function readManagedConfig(filePath) {
  if (!fs.existsSync(filePath)) return { document: { mcp: {} }, containerKey: "mcp" };

  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse managed MCP config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(document)) throw new Error(`Managed MCP config root must be an object: ${filePath}`);

  const containerKey = ["mcpServers", "servers", "mcp"].find((key) => document[key] !== undefined) ?? "mcp";
  if (document[containerKey] === undefined) document[containerKey] = {};
  if (!isRecord(document[containerKey])) {
    throw new Error(`Managed MCP config ${containerKey} must be an object: ${filePath}`);
  }
  return { document, containerKey };
}

function browserServerDefinition(supervisorPath) {
  return {
    type: "local",
    command: [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      supervisorPath,
    ],
    enabled: true,
    [MANAGED_MARKER]: true,
  };
}

function managedServerDefinitions(supervisorPath) {
  const browser = browserServerDefinition(supervisorPath);
  return new Map([
    ["browser", browser],
    ["Browser Iso", { ...browser, command: [...browser.command, "-Isolated"] }],
  ]);
}

function mergeManagedServers(document, containerKey, supervisorPath) {
  const servers = document[containerKey];
  let changed = false;
  const preserved = [];

  for (const [name, nextDefinition] of managedServerDefinitions(supervisorPath)) {
    const existing = servers[name];
    if (existing !== undefined && (!isRecord(existing) || existing[MANAGED_MARKER] !== true)) {
      preserved.push(name);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(nextDefinition)) {
      servers[name] = nextDefinition;
      changed = true;
    }
  }
  return { changed, preserved };
}

export function installBrowserMcp({
  agentDir,
  supervisorSource,
  watcherSource,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return { skipped: true, reason: "Windows-only" };
  if (!agentDir || !supervisorSource || !watcherSource) {
    throw new Error("agentDir, supervisorSource, and watcherSource are required");
  }

  const binDir = path.join(agentDir, "bin");
  const supervisorTarget = path.join(binDir, "pi-browser-mcp.ps1");
  const watcherTarget = path.join(binDir, "pi-browser-idle-close.ps1");
  const scriptsChanged = [
    copyRecoverably(supervisorSource, supervisorTarget),
    copyRecoverably(watcherSource, watcherTarget),
  ].some(Boolean);

  const configPath = path.join(agentDir, "mcp.json");
  const { document, containerKey } = readManagedConfig(configPath);
  const { changed: configChanged, preserved } = mergeManagedServers(document, containerKey, supervisorTarget);
  if (configChanged || !fs.existsSync(configPath)) {
    writeTextRecoverably(configPath, `${JSON.stringify(document, null, 2)}\n`);
  }

  return {
    skipped: false,
    scriptsChanged,
    configChanged,
    configPath,
    supervisorTarget,
    watcherTarget,
    preserved,
  };
}

function optionValue(argumentsList, option) {
  const index = argumentsList.indexOf(option);
  if (index === -1 || !argumentsList[index + 1]) throw new Error(`${option} requires a file path`);
  return path.resolve(argumentsList[index + 1]);
}

function main() {
  try {
    if (process.platform !== "win32") {
      console.log("Shared browser MCP setup skipped: Windows-only.");
      return;
    }
    const argumentsList = process.argv.slice(2);
    const agentDir = process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
    const installation = installBrowserMcp({
      agentDir,
      supervisorSource: optionValue(argumentsList, "--supervisor"),
      watcherSource: optionValue(argumentsList, "--watcher"),
    });
    console.log(`Shared browser MCP installed in ${path.dirname(installation.supervisorTarget)}.`);
    if (installation.preserved.length > 0) {
      console.warn(`Preserved user-managed MCP definitions: ${installation.preserved.join(", ")}.`);
    }
  } catch (error) {
    console.error(`Shared browser MCP setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

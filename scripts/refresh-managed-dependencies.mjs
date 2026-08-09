import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SECURITY_UPDATE_TARGETS = [
  "@modelcontextprotocol/sdk",
  "@hono/node-server",
  "hono",
  "fast-uri",
  "ip-address",
  "protobufjs",
];

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function windowsPackageManagerRunner(parts, managerName) {
  const directExecutable = path.extname(parts[0]).toLowerCase() === ".exe";
  const directCommand = path.basename(parts[0]).replace(/\.(cmd|exe)$/i, "").toLowerCase();
  if (process.platform !== "win32" || directCommand !== managerName || directExecutable) return undefined;

  const candidates = managerName === "npm"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : managerName === "pnpm"
      ? [
        path.join(process.env.APPDATA ?? "", "npm", "node_modules", "pnpm", "bin", "pnpm.cjs"),
        path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js"),
      ]
      : [];
  const cli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!cli) {
    if (candidates.length > 0) throw new Error(`Cannot locate ${managerName} CLI`);
    return undefined;
  }
  return { command: process.execPath, prefixArgs: [cli, ...parts.slice(1)], name: managerName };
}

function configuredNpmRunner(settings) {
  const parts = Array.isArray(settings.npmCommand) && settings.npmCommand.length > 0
    ? settings.npmCommand
    : ["npm"];
  const separator = parts.lastIndexOf("--");
  const managerCommand = separator >= 0 ? parts[separator + 1] : parts[0];
  const name = path.basename(managerCommand ?? "").replace(/\.(cmd|exe)$/i, "").toLowerCase();
  return windowsPackageManagerRunner(parts, name) ?? {
    command: parts[0],
    prefixArgs: parts.slice(1),
    name,
  };
}

function updateArguments(managerName, installRoot) {
  if (managerName === "bun") {
    return ["update", "context-mode", "--cwd", installRoot, "--ignore-scripts"];
  }
  if (managerName === "pnpm") {
    return [
      "update",
      "context-mode",
      "--prefix",
      installRoot,
      "--config.ignore-scripts=true",
    ];
  }
  if (managerName === "npm") {
    return [
      "update",
      ...SECURITY_UPDATE_TARGETS,
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--legacy-peer-deps",
    ];
  }
  throw new Error(`Unsupported npmCommand package manager: ${managerName || "unknown"}`);
}

function refreshManagedDependencies() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ||
    process.env.PI_AGENT_DIR ||
    path.join(os.homedir(), ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const manifest = readJson(path.join(installRoot, "package.json"));
  if (!Object.hasOwn(manifest.dependencies ?? {}, "context-mode")) return;

  const settings = readJson(path.join(agentDir, "settings.json"));
  const runner = configuredNpmRunner(settings);
  const update = spawnSync(
    runner.command,
    [...runner.prefixArgs, ...updateArguments(runner.name, installRoot)],
    { shell: false, stdio: "inherit" },
  );
  if (update.error) throw update.error;
  if (update.status !== 0) {
    throw new Error(`Could not refresh managed npm dependencies (exit ${update.status ?? "unknown"}).`);
  }
  console.log("Refreshed managed npm security dependencies.");
}

try {
  refreshManagedDependencies();
} catch (error) {
  console.error(`Managed dependency refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

import os from "node:os";
import path from "node:path";
import { readJson } from "./files.mjs";

const COMMANDS = new Set(["diagnose", "install", "verify", "rollback"]);

export function normalizePackageSource(source) {
  return typeof source === "string" ? source.replace(/^npm:\s*/, "npm:").trim() : undefined;
}

export function packageSource(packageSpec) {
  return normalizePackageSource(typeof packageSpec === "string" ? packageSpec : packageSpec?.source);
}

export function packageIdentity(source) {
  const normalizedSource = normalizePackageSource(source);
  if (!normalizedSource) return undefined;
  if (normalizedSource.startsWith("npm:")) {
    const match = normalizedSource.slice(4).match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/);
    return match ? `npm:${match[1]}` : normalizedSource;
  }
  if (normalizedSource.startsWith("git:github.com/amAbdoMo/Pi")) return "git:github.com/amAbdoMo/Pi";
  return normalizedSource;
}

export function packageVersion(packageSpec) {
  const separator = packageSpec.lastIndexOf("@");
  return separator > 0 ? packageSpec.slice(separator + 1) : undefined;
}

export function loadBootstrapManifest(sourceRoot, environment = process.env) {
  const manifest = readJson(path.join(sourceRoot, "bootstrap-manifest.json"));
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported bootstrap manifest schema: ${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.checkpointFiles) || !Array.isArray(manifest.requiredAgentFiles)) {
    throw new Error("Bootstrap manifest file lists are missing.");
  }
  const workbenchOverride = normalizePackageSource(environment.PI_WORKBENCH_PACKAGE_SPEC);
  if (!workbenchOverride) return manifest;
  if (
    packageIdentity(workbenchOverride) !== "git:github.com/amAbdoMo/Pi"
    || !workbenchOverride.startsWith("git:github.com/amAbdoMo/Pi@")
  ) {
    throw new Error("PI_WORKBENCH_PACKAGE_SPEC must be a pinned git:github.com/amAbdoMo/Pi source");
  }
  manifest.packages.workbench = workbenchOverride;
  return manifest;
}

export function parseBootstrapArguments(argumentsList) {
  const remainingArguments = [...argumentsList];
  const command = parseCommand(remainingArguments);
  const options = parseOptions(remainingArguments, command);
  validateOptions(options);
  return options;
}

function parseCommand(remainingArguments) {
  if (!remainingArguments[0] || remainingArguments[0].startsWith("-")) return "install";
  const command = remainingArguments.shift();
  if (!COMMANDS.has(command)) throw new Error(`unknown command: ${command}`);
  return command;
}

function parseOptions(remainingArguments, command) {
  const options = {
    command,
    showHelp: false,
    json: false,
    skipFfmpeg: false,
    skipTerminal: false,
    checkpoint: undefined,
  };
  while (remainingArguments.length > 0) applyOption(options, remainingArguments);
  return options;
}

function applyOption(options, remainingArguments) {
  const argument = remainingArguments.shift();
  if (argument === "-h" || argument === "--help") options.showHelp = true;
  else if (argument === "--json") options.json = true;
  else if (argument === "--skip-ffmpeg") options.skipFfmpeg = true;
  else if (argument === "--skip-terminal") options.skipTerminal = true;
  else if (argument === "--checkpoint") options.checkpoint = requiredOptionValue(remainingArguments, argument);
  else throw new Error(`unknown option: ${argument}`);
}

function requiredOptionValue(remainingArguments, option) {
  const optionValue = remainingArguments.shift();
  if (!optionValue) throw new Error(`${option} requires a directory`);
  return optionValue;
}

function validateOptions(options) {
  if (options.command !== "install" && (options.skipFfmpeg || options.skipTerminal)) {
    throw new Error("--skip-ffmpeg and --skip-terminal are install-only options");
  }
  if (options.command !== "rollback" && options.checkpoint) {
    throw new Error("--checkpoint is a rollback-only option");
  }
}

export function resolveAgentDir(environment = process.env) {
  return path.resolve(
    environment.PI_CODING_AGENT_DIR
      || environment.PI_AGENT_DIR
      || path.join(os.homedir(), ".pi", "agent"),
  );
}

export function bootstrapHelp() {
  return `Pi Workbench bootstrap\n\nUsage:\n  npx --yes github:amAbdoMo/Pi [install] [--skip-ffmpeg] [--skip-terminal]\n  npx --yes github:amAbdoMo/Pi diagnose [--json]\n  npx --yes github:amAbdoMo/Pi verify [--json]\n  npx --yes github:amAbdoMo/Pi rollback [--checkpoint DIR] [--json]\n\nCommands:\n  diagnose  Check prerequisites without changing the machine.\n  install   Create a checkpoint, install pinned tools, configure, and verify.\n  verify    Verify the pinned runtime and required non-secret configuration.\n  rollback  Restore the latest (or selected) bootstrap checkpoint.\n\nOptions:\n  --skip-ffmpeg   Skip optional FFmpeg provisioning during install.\n  --skip-terminal Skip terminal font/settings provisioning during install.\n  --checkpoint    Restore a specific checkpoint directory.\n  --json          Emit machine-readable diagnose/verify/rollback output.\n  -h, --help      Show this help text.\n`;
}

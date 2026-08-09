#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HELP = `Pi Workbench installer

Usage:
  npx --yes github:amAbdoMo/Pi [--skip-ffmpeg]

Options:
  --skip-ffmpeg  Do not install the optional FFmpeg video inspection tools.
  -h, --help     Show this help text.
`;

function installerOptions(argumentsList) {
  if (argumentsList.some((argument) => argument === "-h" || argument === "--help")) {
    return { showHelp: true, skipFfmpeg: false };
  }
  const unknownArgument = argumentsList.find((argument) => argument !== "--skip-ffmpeg");
  if (unknownArgument) throw new Error(`unknown option: ${unknownArgument}`);
  return { showHelp: false, skipFfmpeg: argumentsList.includes("--skip-ffmpeg") };
}

function findPowerShell() {
  for (const command of ["pwsh.exe", "powershell.exe"]) {
    const probe = spawnSync(
      command,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"],
      { stdio: "ignore", windowsHide: true },
    );
    if (!probe.error && probe.status === 0) return command;
  }
  throw new Error("PowerShell 7 or Windows PowerShell is required.");
}

function windowsInstaller(root, options) {
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "install.ps1"),
    "-SourceRoot",
    root,
  ];
  if (options.skipFfmpeg) args.push("-SkipFfmpeg");
  return { command: findPowerShell(), args };
}

function unixInstaller(root, options) {
  const args = [path.join(root, "install.sh"), "--source-root", root];
  if (options.skipFfmpeg) args.push("--skip-ffmpeg");
  return { command: "bash", args };
}

function executeInstaller(invocation) {
  const child = spawnSync(invocation.command, invocation.args, {
    shell: false,
    stdio: "inherit",
  });
  if (child.error) throw child.error;
  if (child.signal) throw new Error(`installer terminated by ${child.signal}`);
  if (child.status !== 0) process.exitCode = child.status ?? 1;
}

function main() {
  try {
    const options = installerOptions(process.argv.slice(2));
    if (options.showHelp) {
      process.stdout.write(HELP);
      return;
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const invocation = process.platform === "win32"
      ? windowsInstaller(root, options)
      : unixInstaller(root, options);
    executeInstaller(invocation);
  } catch (error) {
    console.error(`Pi Workbench installer: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();

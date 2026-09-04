import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { packageIdentity, packageSource, packageVersion } from "./contracts.mjs";
import { errorMessage, readJson, safeAgentPath } from "./files.mjs";

function check(id, status, detail) {
  return { id, status, detail };
}

function executableName(name) {
  return process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
}

function runNative(command, args, { env = process.env, stdio = "pipe", allowFailure = false } = {}) {
  const execution = spawnSync(command, args, {
    encoding: "utf8",
    env,
    shell: false,
    stdio,
    windowsHide: true,
  });
  if (execution.error) throw execution.error;
  if (execution.signal) throw new Error(`${command} terminated by ${execution.signal}`);
  if (!allowFailure && execution.status !== 0) throw commandFailure(command, execution);
  return execution;
}

function commandFailure(command, execution) {
  const failureDetail = `${execution.stderr || execution.stdout || ""}`.trim();
  const suffix = failureDetail ? `: ${failureDetail}` : "";
  return new Error(`${command} failed with exit code ${execution.status}${suffix}`);
}

function npmRunner() {
  const candidates = [
    process.env.npm_execpath,
    path.join(process.env.APPDATA ?? "", "npm", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (!npmCli) throw new Error("Cannot locate the npm CLI. Reinstall Node.js from a trusted package manager.");
  return { command: process.execPath, prefixArgs: [npmCli] };
}

function runNpm(args, options) {
  const runner = npmRunner();
  return runNative(runner.command, [...runner.prefixArgs, ...args], options);
}

function npmGlobalRoot() {
  return runNpm(["root", "-g"]).stdout.trim();
}

export function installedPi() {
  let globalRoot;
  try {
    globalRoot = npmGlobalRoot();
  } catch {
    return undefined;
  }
  const manifestPath = path.join(globalRoot, "@earendil-works", "pi-coding-agent", "package.json");
  if (!fs.existsSync(manifestPath)) return undefined;
  const packageManifest = readJson(manifestPath);
  const binPath = typeof packageManifest.bin === "string" ? packageManifest.bin : packageManifest.bin?.pi;
  if (!binPath) throw new Error(`Installed Pi package has no pi executable: ${manifestPath}`);
  return {
    version: packageManifest.version,
    command: process.execPath,
    prefixArgs: [path.resolve(path.dirname(manifestPath), binPath)],
  };
}

function runPi(args, options) {
  const piInstallation = installedPi();
  if (!piInstallation) throw new Error("Pi is not installed.");
  return runNative(piInstallation.command, [...piInstallation.prefixArgs, ...args], options);
}

function findPowerShell() {
  for (const command of ["pwsh.exe", "powershell.exe"]) {
    try {
      const execution = runNative(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
        allowFailure: true,
      });
      if (execution.status === 0) return command;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("PowerShell 7 or Windows PowerShell is required on Windows.");
}

function commandVersion(command, args = ["--version"]) {
  try {
    const execution = runNative(command, args, { allowFailure: true });
    if (execution.status !== 0) return undefined;
    return `${execution.stdout || execution.stderr || ""}`.trim().split(/\r?\n/)[0];
  } catch {
    return undefined;
  }
}

function nodeDiagnostic(manifest) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const status = nodeMajor >= manifest.minimumNodeMajor ? "pass" : "fail";
  return check("node", status, `${process.version}; requires Node ${manifest.minimumNodeMajor}+`);
}

function npmDiagnostic() {
  try {
    return check("npm", "pass", runNpm(["--version"]).stdout.trim());
  } catch (error) {
    return check("npm", "fail", errorMessage(error));
  }
}

function gitDiagnostic() {
  const version = commandVersion(executableName("git"));
  return check("git", version ? "pass" : "fail", version || "Git is not available");
}

function piDiagnostic(manifest) {
  const piInstallation = installedPi();
  const pinnedVersion = packageVersion(manifest.packages.pi);
  const status = piInstallation?.version === pinnedVersion ? "pass" : "warn";
  const detail = piInstallation
    ? `${piInstallation.version}; pinned ${pinnedVersion}`
    : "not installed; install will provision it";
  return check("pi", status, detail);
}

function platformDiagnostic() {
  try {
    if (process.platform === "win32") return check("powershell", "pass", findPowerShell());
    const version = commandVersion("bash", ["--version"]);
    return check("bash", version ? "pass" : "fail", version || "bash is not available");
  } catch (error) {
    const tool = process.platform === "win32" ? "powershell" : "bash";
    return check(tool, "fail", errorMessage(error));
  }
}

function assetDiagnostics(sourceRoot) {
  return [
    "bootstrap-manifest.json",
    "install.ps1",
    "install.sh",
    "scripts/apply-config.mjs",
    "scripts/setup-browser-mcp.mjs",
  ].map((relativePath) => check(
    `asset:${relativePath}`,
    fs.existsSync(path.join(sourceRoot, relativePath)) ? "pass" : "fail",
    relativePath,
  ));
}

function agentDirectoryDiagnostic(agentDir) {
  let writableRoot = path.resolve(agentDir);
  while (!fs.existsSync(writableRoot) && path.dirname(writableRoot) !== writableRoot) writableRoot = path.dirname(writableRoot);
  try {
    fs.accessSync(writableRoot, fs.constants.W_OK);
    return check("agent-dir", "pass", agentDir);
  } catch {
    return check("agent-dir", "fail", `${writableRoot} is not writable`);
  }
}

export function collectDiagnostics({ sourceRoot, manifest, agentDir }) {
  return [
    nodeDiagnostic(manifest),
    npmDiagnostic(),
    gitDiagnostic(),
    piDiagnostic(manifest),
    platformDiagnostic(),
    ...assetDiagnostics(sourceRoot),
    agentDirectoryDiagnostic(agentDir),
  ];
}

function exactPackageSources(settings) {
  return new Set((Array.isArray(settings.packages) ? settings.packages : []).map(packageSource).filter(Boolean));
}

function piVersionCheck(manifest) {
  const piInstallation = installedPi();
  const expectedVersion = packageVersion(manifest.packages.pi);
  const status = piInstallation?.version === expectedVersion ? "pass" : "fail";
  const detail = piInstallation ? `${piInstallation.version}; expected ${expectedVersion}` : "Pi is not installed";
  return check("pi-version", status, detail);
}

function settingsChecks({ agentDir, manifest }) {
  const settingsPath = path.join(agentDir, "settings.json");
  let settings;
  try {
    settings = readJson(settingsPath);
  } catch (error) {
    return [check("settings", "fail", errorMessage(error))];
  }
  const checks = [check("settings", "pass", settingsPath)];
  const configuredSources = exactPackageSources(settings);
  for (const packageSpec of [manifest.packages.workbench, manifest.packages.contextMode]) {
    const status = configuredSources.has(packageSpec) ? "pass" : "fail";
    checks.push(check(`package:${packageIdentity(packageSpec)}`, status, packageSpec));
  }
  return checks;
}

function installedPackageVersion(manifestPath) {
  return fs.existsSync(manifestPath) ? readJson(manifestPath).version : undefined;
}

function packageVersionChecks({ agentDir, manifest }) {
  const contextVersion = installedPackageVersion(path.join(agentDir, "npm", "node_modules", "context-mode", "package.json"));
  const workbenchVersion = installedPackageVersion(path.join(agentDir, "git", "github.com", "amAbdoMo", "Pi", "package.json"));
  return [
    versionCheck("context-mode-version", contextVersion, packageVersion(manifest.packages.contextMode), "context-mode"),
    versionCheck("workbench-version", workbenchVersion, manifest.release, "Pi Workbench"),
  ];
}

function versionCheck(id, installedVersion, expectedVersion, displayName) {
  const status = installedVersion === expectedVersion ? "pass" : "fail";
  const detail = installedVersion
    ? `${installedVersion}; expected ${expectedVersion}`
    : `${displayName} is not installed`;
  return check(id, status, detail);
}

function requiredFileChecks({ agentDir, manifest }) {
  return manifest.requiredAgentFiles.map((relativePath) => {
    const filePath = safeAgentPath(agentDir, relativePath);
    return check(`file:${relativePath}`, fs.existsSync(filePath) ? "pass" : "fail", filePath);
  });
}

function browserFileChecks(agentDir) {
  if (process.platform !== "win32") return [];
  return ["bin/pi-browser-mcp.ps1", "bin/pi-browser-idle-close.ps1", "mcp.json"].map((relativePath) => {
    const filePath = safeAgentPath(agentDir, relativePath);
    return check(`browser:${relativePath}`, fs.existsSync(filePath) ? "pass" : "fail", filePath);
  });
}

export function verifyInstallation({ manifest, agentDir }) {
  return [
    piVersionCheck(manifest),
    ...settingsChecks({ agentDir, manifest }),
    ...packageVersionChecks({ agentDir, manifest }),
    ...requiredFileChecks({ agentDir, manifest }),
    ...browserFileChecks(agentDir),
  ];
}

export function installedManagedSources(agentDir) {
  const settings = readJson(path.join(agentDir, "settings.json"), {});
  const configuredSources = (Array.isArray(settings.packages) ? settings.packages : [])
    .map(packageSource)
    .filter(Boolean);
  return [
    resolvedWorkbenchSource(agentDir, configuredSources),
    resolvedContextModeSource(agentDir, configuredSources),
  ].filter(Boolean);
}

function resolvedWorkbenchSource(agentDir, configuredSources) {
  const identity = "git:github.com/amAbdoMo/Pi";
  const isConfigured = configuredSources.some((source) => packageIdentity(source) === identity);
  if (!isConfigured) return undefined;
  const checkout = path.join(agentDir, "git", "github.com", "amAbdoMo", "Pi");
  if (!fs.existsSync(path.join(checkout, "package.json"))) return undefined;
  const commit = commandVersion(executableName("git"), ["-C", checkout, "rev-parse", "HEAD"]);
  if (!commit) throw new Error(`Cannot checkpoint the existing Workbench checkout: ${checkout}`);
  return `${identity}@${commit}`;
}

function resolvedContextModeSource(agentDir, configuredSources) {
  const identity = "npm:context-mode";
  const isConfigured = configuredSources.some((source) => packageIdentity(source) === identity);
  if (!isConfigured) return undefined;
  const manifestPath = path.join(agentDir, "npm", "node_modules", "context-mode", "package.json");
  const version = installedPackageVersion(manifestPath);
  return version ? `${identity}@${version}` : undefined;
}

export function managedPackagePresence(agentDir) {
  return {
    workbench: fs.existsSync(safeAgentPath(agentDir, "git/github.com/amAbdoMo/Pi/package.json")),
    contextMode: fs.existsSync(safeAgentPath(agentDir, "npm/node_modules/context-mode/package.json")),
  };
}

export function ensurePiVersion(manifest) {
  const expectedVersion = packageVersion(manifest.packages.pi);
  if (installedPi()?.version === expectedVersion) return;
  runNpm(["install", "-g", "--ignore-scripts", manifest.packages.pi], { stdio: "inherit" });
  if (installedPi()?.version !== expectedVersion) throw new Error(`Pi ${expectedVersion} was not installed successfully`);
}

export function invokePlatformInstaller({ sourceRoot, manifest, skipFfmpeg, skipTerminal }) {
  if (process.platform === "win32") invokeWindowsInstaller({ sourceRoot, manifest, skipFfmpeg, skipTerminal });
  else invokePosixInstaller({ sourceRoot, manifest, skipFfmpeg, skipTerminal });
}

function invokeWindowsInstaller({ sourceRoot, manifest, skipFfmpeg, skipTerminal }) {
  const args = windowsInstallerArguments({ sourceRoot, manifest, skipFfmpeg, skipTerminal });
  runNative(findPowerShell(), args, { stdio: "inherit" });
}

function windowsInstallerArguments({ sourceRoot, manifest, skipFfmpeg, skipTerminal }) {
  const args = [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(sourceRoot, "install.ps1"),
    "-SourceRoot", sourceRoot,
    "-WorkbenchPackage", manifest.packages.workbench,
    "-ContextModePackage", manifest.packages.contextMode,
  ];
  if (skipFfmpeg) args.push("-SkipFfmpeg");
  if (skipTerminal) args.push("-SkipTerminal");
  return args;
}

function invokePosixInstaller({ sourceRoot, manifest, skipFfmpeg, skipTerminal }) {
  const args = [
    path.join(sourceRoot, "install.sh"),
    "--source-root", sourceRoot,
    "--workbench-package", manifest.packages.workbench,
    "--context-mode-package", manifest.packages.contextMode,
  ];
  if (skipFfmpeg) args.push("--skip-ffmpeg");
  if (skipTerminal) args.push("--skip-terminal");
  runNative("bash", args, { stdio: "inherit" });
}

export function reinstallPreviousState(checkpoint, { agentDir } = {}) {
  restorePreviousPiVersion(checkpoint.previousPiVersion);
  removeNewManagedPackages(checkpoint, agentDir);
  for (const source of checkpoint.managedPackageSources ?? []) reinstallManagedPackage(source);
}

export function restorePreviousPiVersion(previousVersion, {
  installedPiFn = installedPi,
  runNpmCommand = runNpm,
} = {}) {
  const current = installedPiFn();
  if (!previousVersion) {
    if (current) runNpmCommand(["uninstall", "-g", "@earendil-works/pi-coding-agent"], { stdio: "inherit" });
    return;
  }
  if (current?.version === previousVersion) return;
  runNpmCommand([
    "install",
    "-g",
    "--ignore-scripts",
    `@earendil-works/pi-coding-agent@${previousVersion}`,
  ], { stdio: "inherit" });
}

export function removeNewManagedPackages(checkpoint, agentDir, rmSync = fs.rmSync) {
  if (!agentDir || !checkpoint.managedPackagePresence) return;
  const managedPaths = {
    workbench: "git/github.com/amAbdoMo/Pi",
    contextMode: "npm/node_modules/context-mode",
  };
  for (const [name, relativePath] of Object.entries(managedPaths)) {
    if (checkpoint.managedPackagePresence[name] === false) {
      rmSync(safeAgentPath(agentDir, relativePath), { recursive: true, force: true });
    }
  }
}

function reinstallManagedPackage(source) {
  const supportedIdentities = new Set(["git:github.com/amAbdoMo/Pi", "npm:context-mode"]);
  if (!supportedIdentities.has(packageIdentity(source))) {
    throw new Error(`Checkpoint contains an unsupported managed package: ${source}`);
  }
  runPi(["install", source], { stdio: "inherit" });
}

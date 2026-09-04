import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const RETIRED_PACKAGES = ["@hypabolic/pi-hypa", "pi-mcp-adapter"];
const RETIRED_PACKAGE_SET = new Set(RETIRED_PACKAGES);
const HYPA_RUNTIME_PACKAGE = "@hypabolic/hypa";

function packageSource(packageSpec) {
  return typeof packageSpec === "string" ? packageSpec : packageSpec?.source;
}

function npmPackageName(source) {
  if (typeof source !== "string" || !source.startsWith("npm:")) return undefined;
  const spec = source.slice(4).trim();
  const match = spec.match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/);
  return match?.[1];
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonRecoverably(filePath, jsonDocument) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const token = `${process.pid}-${Date.now()}`;
  const temporaryPath = `${filePath}.tmp-${token}`;
  const backupPath = `${filePath}.backup-${token}`;
  const hadExistingFile = fs.existsSync(filePath);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(jsonDocument, null, 2)}\n`);

  try {
    if (hadExistingFile) fs.renameSync(filePath, backupPath);
    fs.renameSync(temporaryPath, filePath);
    if (hadExistingFile) fs.rmSync(backupPath, { force: true });
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    if (hadExistingFile && !fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath);
    }
    throw error;
  }
}

function removeRetiredSettingsEntries(settingsFile) {
  const settings = readJson(settingsFile);
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const retained = packages.filter((packageSpec) =>
    !RETIRED_PACKAGE_SET.has(npmPackageName(packageSource(packageSpec)))
  );
  if (retained.length === packages.length) return false;
  settings.packages = retained;
  writeJsonRecoverably(settingsFile, settings);
  return true;
}

function packageHasDependency(manifest, packageName) {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .some((field) => Object.hasOwn(manifest[field] ?? {}, packageName));
}

function windowsPackageManagerRunner(parts, managerName) {
  const directExecutable = path.extname(parts[0]).toLowerCase() === ".exe";
  const directCommand = path.basename(parts[0]).replace(/\.(cmd|exe)$/i, "").toLowerCase();
  if (process.platform !== "win32" || directCommand !== managerName || directExecutable) return undefined;

  const npmExecPath = process.env.npm_execpath;
  const candidates = managerName === "npm"
    ? [
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      ...(npmExecPath && path.basename(npmExecPath).toLowerCase() === "npm-cli.js" ? [npmExecPath] : []),
    ]
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

function uninstallArguments(managerName, installRoot, packageNames) {
  if (managerName === "bun") {
    return ["remove", ...packageNames, "--cwd", installRoot, "--ignore-scripts"];
  }
  if (managerName === "pnpm") {
    return [
      "remove",
      ...packageNames,
      "--prefix",
      installRoot,
      "--config.ignore-scripts=true",
    ];
  }
  if (managerName === "npm") {
    return [
      "uninstall",
      ...packageNames,
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--legacy-peer-deps",
    ];
  }
  throw new Error(`Unsupported npmCommand package manager: ${managerName || "unknown"}`);
}

function installedPackageDirectory(installRoot, packageName) {
  return path.join(installRoot, "node_modules", ...packageName.split("/"));
}

function retirementPaths(agentDir) {
  const installRoot = path.join(agentDir, "npm");
  return {
    settingsFile: path.join(agentDir, "settings.json"),
    installRoot,
    packageFile: path.join(installRoot, "package.json"),
    hypabolicRoot: path.join(installRoot, "node_modules", "@hypabolic"),
  };
}

function remainingHypaPackages(hypabolicRoot) {
  try {
    return fs.readdirSync(hypabolicRoot)
      .filter((name) => name === "hypa" || name.startsWith("hypa-"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function installedRetiredPackages(paths) {
  const manifest = readJson(paths.packageFile);
  return RETIRED_PACKAGES.filter((packageName) =>
    packageHasDependency(manifest, packageName) ||
    fs.existsSync(installedPackageDirectory(paths.installRoot, packageName))
  );
}

function uninstallRetiredPackages(settings, paths, packageNames) {
  if (packageNames.length === 0) return false;

  const npmRunner = configuredNpmRunner(settings);
  const uninstallArgs = uninstallArguments(npmRunner.name, paths.installRoot, packageNames);
  const uninstall = spawnSync(npmRunner.command, [...npmRunner.prefixArgs, ...uninstallArgs], {
    shell: false,
    stdio: "inherit",
  });
  if (uninstall.error) throw uninstall.error;
  if (uninstall.status !== 0) {
    throw new Error(`Could not remove retired packages ${packageNames.join(", ")} (exit ${uninstall.status ?? "unknown"}).`);
  }
  return true;
}

function verifyRetirement(paths) {
  const remainingRetired = installedRetiredPackages(paths);
  if (remainingRetired.length > 0) {
    throw new Error(`Retired packages remain installed: ${remainingRetired.join(", ")}`);
  }

  const manifest = readJson(paths.packageFile);
  const directHypa = packageHasDependency(manifest, HYPA_RUNTIME_PACKAGE);
  const remainingPackages = remainingHypaPackages(paths.hypabolicRoot);
  if (!directHypa && remainingPackages.length > 0) {
    throw new Error(`Hypa runtime packages are still owned by another managed dependency: ${remainingPackages.join(", ")}`);
  }
}

function retirePackages() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ||
    process.env.PI_AGENT_DIR ||
    path.join(os.homedir(), ".pi", "agent");
  const paths = retirementPaths(agentDir);
  const settings = readJson(paths.settingsFile);
  const wasConfigured = removeRetiredSettingsEntries(paths.settingsFile);
  const retiredPackages = installedRetiredPackages(paths);
  const wasUninstalled = uninstallRetiredPackages(settings, paths, retiredPackages);
  verifyRetirement(paths);
  if (wasConfigured || wasUninstalled) {
    console.log(`Retired packages removed: ${RETIRED_PACKAGES.map((name) => `npm:${name}`).join(", ")}`);
  }
}

try {
  retirePackages();
} catch (error) {
  console.error(`Retired package cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

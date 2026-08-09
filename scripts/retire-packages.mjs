import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const RETIRED_PACKAGE = "@hypabolic/pi-hypa";
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

function removeRetiredSettingsEntry(settingsFile) {
  const settings = readJson(settingsFile);
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  const retained = packages.filter((packageSpec) =>
    npmPackageName(packageSource(packageSpec)) !== RETIRED_PACKAGE
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

function windowsNpmRunner(parts, managerName) {
  const directCommand = path.basename(parts[0]).replace(/\.(cmd|exe)$/i, "").toLowerCase();
  if (process.platform !== "win32" || directCommand !== "npm") return undefined;

  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(npmCli)) throw new Error(`Cannot locate npm CLI: ${npmCli}`);
  return { command: process.execPath, prefixArgs: [npmCli, ...parts.slice(1)], name: managerName };
}

function configuredNpmRunner(settings) {
  const parts = Array.isArray(settings.npmCommand) && settings.npmCommand.length > 0
    ? settings.npmCommand
    : ["npm"];
  const separator = parts.lastIndexOf("--");
  const managerCommand = separator >= 0 ? parts[separator + 1] : parts[0];
  const name = path.basename(managerCommand ?? "").replace(/\.(cmd|exe)$/i, "").toLowerCase();
  return windowsNpmRunner(parts, name) ?? {
    command: parts[0],
    prefixArgs: parts.slice(1),
    name,
  };
}

function uninstallArguments(managerName, installRoot) {
  if (managerName === "bun") {
    return ["remove", RETIRED_PACKAGE, "--cwd", installRoot, "--ignore-scripts"];
  }
  if (managerName === "pnpm") {
    return [
      "remove",
      RETIRED_PACKAGE,
      "--prefix",
      installRoot,
      "--config.ignore-scripts=true",
    ];
  }
  if (managerName === "npm") {
    return [
      "uninstall",
      RETIRED_PACKAGE,
      "--prefix",
      installRoot,
      "--ignore-scripts",
      "--legacy-peer-deps",
    ];
  }
  throw new Error(`Unsupported npmCommand package manager: ${managerName || "unknown"}`);
}

function retirementPaths(agentDir) {
  const installRoot = path.join(agentDir, "npm");
  const hypabolicRoot = path.join(installRoot, "node_modules", "@hypabolic");
  return {
    settingsFile: path.join(agentDir, "settings.json"),
    installRoot,
    packageFile: path.join(installRoot, "package.json"),
    packageDirectory: path.join(hypabolicRoot, "pi-hypa"),
    hypabolicRoot,
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

function uninstallRetiredPackage(settings, paths) {
  const manifest = readJson(paths.packageFile);
  const needsUninstall = packageHasDependency(manifest, RETIRED_PACKAGE) ||
    fs.existsSync(paths.packageDirectory);
  if (!needsUninstall) return false;

  const npmRunner = configuredNpmRunner(settings);
  const uninstallArgs = uninstallArguments(npmRunner.name, paths.installRoot);
  const uninstall = spawnSync(npmRunner.command, [...npmRunner.prefixArgs, ...uninstallArgs], {
    shell: false,
    stdio: "inherit",
  });
  if (uninstall.error) throw uninstall.error;
  if (uninstall.status !== 0) {
    throw new Error(`Could not remove retired ${RETIRED_PACKAGE} package (exit ${uninstall.status ?? "unknown"}).`);
  }
  return true;
}

function verifyRetirement(paths) {
  const manifest = readJson(paths.packageFile);
  if (packageHasDependency(manifest, RETIRED_PACKAGE) || fs.existsSync(paths.packageDirectory)) {
    throw new Error(`Retired package remains installed: ${RETIRED_PACKAGE}`);
  }

  const directHypa = packageHasDependency(manifest, HYPA_RUNTIME_PACKAGE);
  const remainingPackages = remainingHypaPackages(paths.hypabolicRoot);
  if (!directHypa && remainingPackages.length > 0) {
    throw new Error(`Hypa runtime packages are still owned by another managed dependency: ${remainingPackages.join(", ")}`);
  }
}

function retireHypa() {
  const agentDir = process.env.PI_CODING_AGENT_DIR ||
    process.env.PI_AGENT_DIR ||
    path.join(os.homedir(), ".pi", "agent");
  const paths = retirementPaths(agentDir);
  const settings = readJson(paths.settingsFile);
  const wasConfigured = removeRetiredSettingsEntry(paths.settingsFile);
  const wasUninstalled = uninstallRetiredPackage(settings, paths);
  verifyRetirement(paths);
  if (wasConfigured || wasUninstalled) {
    console.log(`Retired package removed: npm:${RETIRED_PACKAGE}`);
  }
}

try {
  retireHypa();
} catch (error) {
  console.error(`Hypa cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

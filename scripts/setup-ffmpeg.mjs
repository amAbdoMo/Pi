import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function commandSucceeds(command, args = [], options = {}) {
  const commandRun = spawnSync(command, args, {
    shell: false,
    stdio: options.stdio ?? "ignore",
    env: options.env ?? process.env,
  });
  return !commandRun.error && commandRun.status === 0;
}

function mediaToolsAvailable(binDirectory) {
  const ffmpeg = binDirectory ? path.join(binDirectory, "ffmpeg.exe") : "ffmpeg";
  const ffprobe = binDirectory ? path.join(binDirectory, "ffprobe.exe") : "ffprobe";
  return commandSucceeds(ffmpeg, ["-version"]) && commandSucceeds(ffprobe, ["-version"]);
}

function wingetOwnsFfmpeg() {
  const listing = spawnSync(
    "winget.exe",
    ["list", "--id", "Gyan.FFmpeg", "--exact", "--source", "winget", "--disable-interactivity"],
    { shell: false, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return !listing.error && listing.status === 0 && /\bGyan\.FFmpeg\b/.test(listing.stdout ?? "");
}

function readableDirectoryEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EACCES") return [];
    throw error;
  }
}

function findWindowsFfmpegBin() {
  const packagesRoot = process.env.LOCALAPPDATA && path.join(
    process.env.LOCALAPPDATA,
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (!packagesRoot || !fs.existsSync(packagesRoot) || !wingetOwnsFfmpeg()) return undefined;

  const roots = readableDirectoryEntries(packagesRoot)
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("Gyan.FFmpeg_"))
    .map((entry) => path.join(packagesRoot, entry.name));
  const queue = roots.map((directory) => ({ directory, depth: 0 }));
  const binaryDirectories = [];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = readableDirectoryEntries(current.directory);
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
    if (names.has("ffmpeg.exe") && names.has("ffprobe.exe")) {
      binaryDirectories.push(fs.realpathSync(current.directory));
    }
    if (current.depth >= 8) continue;
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    }
  }

  const canonicalRoot = `${fs.realpathSync(packagesRoot)}${path.sep}`.toLowerCase();
  const trustedDirectories = [...new Set(binaryDirectories)]
    .filter((directory) => `${directory}${path.sep}`.toLowerCase().startsWith(canonicalRoot));
  return trustedDirectories.length === 1 ? trustedDirectories[0] : undefined;
}

function persistWindowsPath(binDirectory) {
  const shell = ["pwsh.exe", "powershell.exe"].find((command) =>
    commandSucceeds(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"])
  );
  if (!shell) return false;

  const script = [
    "$bin = $env:PI_WORKBENCH_FFMPEG_BIN",
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = @($current -split ';' | Where-Object { $_ })",
    "if (-not ($parts | Where-Object { $_.TrimEnd('\\') -ieq $bin.TrimEnd('\\') })) {",
    "  [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')",
    "}",
  ].join("\n");
  return commandSucceeds(
    shell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, PI_WORKBENCH_FFMPEG_BIN: binDirectory } },
  );
}

function linuxPrivilege() {
  if (process.getuid?.() === 0) return { commandPrefix: [] };
  if (commandSucceeds("sudo", ["-n", "true"])) return { commandPrefix: ["sudo"] };
  return undefined;
}

function windowsInstallation() {
  if (!commandSucceeds("winget.exe", ["--version"])) return undefined;
  return {
    command: "winget.exe",
    args: [
      "install",
      "--id",
      "Gyan.FFmpeg",
      "--exact",
      "--source",
      "winget",
      "--accept-source-agreements",
      "--accept-package-agreements",
      "--disable-interactivity",
      "--silent",
    ],
    manual: "winget install --id Gyan.FFmpeg --exact --source winget",
  };
}

function macInstallation() {
  if (!commandSucceeds("brew", ["--version"])) return undefined;
  return { command: "brew", args: ["install", "ffmpeg"], manual: "brew install ffmpeg" };
}

function linuxInstallation() {
  const packageManagers = [
    ["apt-get", ["install", "-y", "ffmpeg"]],
    ["dnf", ["install", "-y", "ffmpeg"]],
    ["yum", ["install", "-y", "ffmpeg"]],
    ["pacman", ["-S", "--needed", "--noconfirm", "ffmpeg"]],
    ["zypper", ["--non-interactive", "install", "ffmpeg"]],
    ["apk", ["add", "ffmpeg"]],
  ];
  const selected = packageManagers.find(([command]) => commandSucceeds(command, ["--version"]));
  if (!selected) return undefined;

  const [systemManager, args] = selected;
  const privilege = linuxPrivilege();
  const manualPrefix = process.getuid?.() === 0 ? "" : "sudo ";
  if (!privilege) return { manual: `${manualPrefix}${systemManager} ${args.join(" ")}` };
  return {
    command: privilege.commandPrefix[0] ?? systemManager,
    args: privilege.commandPrefix.length > 0 ? [systemManager, ...args] : args,
    manual: `${manualPrefix}${systemManager} ${args.join(" ")}`,
  };
}

function ffmpegInstallation() {
  if (process.platform === "win32") return windowsInstallation();
  if (process.platform === "darwin") return macInstallation();
  return linuxInstallation();
}

function finishWindowsSetup() {
  if (process.platform !== "win32") return mediaToolsAvailable();
  const binDirectory = findWindowsFfmpegBin();
  if (!binDirectory || !mediaToolsAvailable(binDirectory)) return mediaToolsAvailable();
  process.env.PATH = `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`;
  if (!persistWindowsPath(binDirectory)) {
    console.warn(`FFmpeg works at ${binDirectory}, but its user PATH entry could not be verified.`);
  }
  return true;
}

function reportUnavailable(installation) {
  console.warn("FFmpeg was not installed automatically.");
  if (installation?.manual) console.warn(`Run manually: ${installation.manual}`);
  else console.warn("Install FFmpeg with your trusted system package manager.");
  process.exitCode = 2;
}

function installFfmpeg(installation) {
  console.log(`Installing FFmpeg with ${installation.command}...`);
  if (!commandSucceeds(installation.command, installation.args, { stdio: "inherit" })) {
    console.warn(`FFmpeg installation failed. Run manually: ${installation.manual}`);
    process.exitCode = 2;
    return;
  }
  if (!mediaToolsAvailable() && !finishWindowsSetup()) {
    console.warn("The package manager completed, but FFmpeg and FFprobe could not be verified.");
    console.warn(`Run manually if needed: ${installation.manual}`);
    process.exitCode = 2;
    return;
  }
  console.log("FFmpeg and FFprobe are ready. Reopen the terminal if they are not visible in the current shell.");
}

function main() {
  if (mediaToolsAvailable()) {
    console.log("FFmpeg and FFprobe are ready for video inspection.");
    return;
  }
  if (process.argv.includes("--check")) {
    process.exitCode = 2;
    return;
  }
  if (finishWindowsSetup()) {
    console.log("FFmpeg and FFprobe are ready for video inspection.");
    return;
  }

  const installation = ffmpegInstallation();
  if (!installation?.command) {
    reportUnavailable(installation);
    return;
  }
  installFfmpeg(installation);
}

main();

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function logLines(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
}

async function waitForLogLines(logPath, expectedCount) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (logLines(logPath).length >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expectedCount} browser MCP launches`);
}

function waitForExit(child, stderr) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser MCP supervisor exited ${code}: ${stderr()}`));
    });
  });
}

function startSupervisor(powerShell, scriptPath, debugPort, environment) {
  let stderr = "";
  const child = spawn(powerShell, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-DebugPort",
    String(debugPort),
  ], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, exited: waitForExit(child, () => stderr) };
}

test("concurrent browser MCP clients keep the shared-profile CDP mode", {
  skip: process.platform !== "win32",
}, async (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-browser-supervisor-"));
  const binDirectory = path.join(testRoot, "bin");
  const scriptDirectory = path.join(testRoot, "scripts");
  const userProfile = path.join(testRoot, "user");
  const localAppData = path.join(testRoot, "local");
  const launchLog = path.join(testRoot, "npx.log");
  const releaseMarker = path.join(testRoot, "release");
  const supervisors = [];
  let listener;
  t.after(async () => {
    fs.writeFileSync(releaseMarker, "release\n");
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_500);
      timer.unref();
    });
    await Promise.race([Promise.allSettled(supervisors.map(({ exited }) => exited)), timeout]);
    for (const { child } of supervisors) {
      if (child.exitCode === null) child.kill();
    }
    if (listener?.listening) await new Promise((resolve) => listener.close(resolve));
    fs.rmSync(testRoot, { recursive: true, force: true });
  });
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.mkdirSync(userProfile, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });

  const supervisorPath = path.join(scriptDirectory, "pi-browser-mcp.ps1");
  fs.copyFileSync(path.join(root, "scripts", "browser", "pi-browser-mcp.ps1"), supervisorPath);
  fs.writeFileSync(path.join(scriptDirectory, "pi-browser-idle-close.ps1"), "exit 0\n");
  fs.writeFileSync(path.join(binDirectory, "npx.cmd"), [
    "@echo off",
    "echo %*>>\"%PI_BROWSER_TEST_LOG%\"",
    ":wait",
    "if exist \"%PI_BROWSER_TEST_RELEASE%\" goto done",
    "ping 127.0.0.1 -n 2 >nul",
    "goto wait",
    ":done",
    "exit /b 0",
    "",
  ].join("\r\n"));

  listener = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");

  const environment = {
    ...process.env,
    USERPROFILE: userProfile,
    LOCALAPPDATA: localAppData,
    PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    PI_BROWSER_TEST_LOG: launchLog,
    PI_BROWSER_TEST_RELEASE: releaseMarker,
  };
  const powerShell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

  const first = startSupervisor(powerShell, supervisorPath, address.port, environment);
  supervisors.push(first);
  await waitForLogLines(launchLog, 1);

  const second = startSupervisor(powerShell, supervisorPath, address.port, environment);
  supervisors.push(second);
  await waitForLogLines(launchLog, 2);

  fs.writeFileSync(releaseMarker, "release\n");
  await Promise.all([first.exited, second.exited]);

  const launches = logLines(launchLog);
  assert.match(launches[0], /@playwright\/mcp@0\.0\.79/);
  assert.match(launches[1], /@playwright\/mcp@0\.0\.79/);
  assert.doesNotMatch(launches[0], /--isolated/);
  assert.doesNotMatch(launches[1], /--isolated/);
});

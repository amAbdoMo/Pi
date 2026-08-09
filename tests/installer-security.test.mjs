import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("the GitHub package exposes one deterministic npx installer", () => {
  const manifest = readJson(path.join(root, "package.json"));
  assert.deepEqual(manifest.bin, {
    "pi-workbench-install": "./scripts/install-cli.mjs",
  });
  assert.equal(manifest.engines.node, ">=20");

  const output = execFileSync(
    process.execPath,
    [path.join(root, "scripts", "install-cli.mjs"), "--help"],
    { encoding: "utf8" },
  );
  assert.match(output, /npx --yes github:amAbdoMo\/Pi/);
  assert.match(output, /--skip-ffmpeg/);
});

test("retired package cleanup removes exact legacy packages without deleting ambiguous neighbors", (t) => {
  const testRoot = temporaryDirectory("pi-retire-hypa-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const packageDirectory = path.join(installRoot, "node_modules", "@hypabolic", "pi-hypa");
  const adapterDirectory = path.join(installRoot, "node_modules", "pi-mcp-adapter");
  const fakeManager = path.join(testRoot, "fake-manager.mjs");
  const managerLog = path.join(testRoot, "manager.log");
  const localAppData = path.join(testRoot, "LocalAppData");
  const home = path.join(testRoot, "home");
  const shim = process.platform === "win32"
    ? path.join(localAppData, "Hypa", "bin", "hypa.cmd")
    : path.join(home, ".local", "bin", "hypa");

  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.mkdirSync(adapterDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify({ name: "@hypabolic/pi-hypa" }));
  fs.writeFileSync(path.join(adapterDirectory, "package.json"), JSON.stringify({ name: "pi-mcp-adapter" }));
  fs.writeFileSync(shim, `shim target ${packageDirectory}\n`);
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@hypabolic/pi-hypa": "0.1.13",
        "pi-mcp-adapter": "2.11.0",
        "pi-mcp-adapter-tools": "1.0.0",
        "context-mode": "1.0.0",
      },
    }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      npmCommand: [process.execPath, fakeManager, "--", "npm"],
      packages: [
        "npm: @hypabolic/pi-hypa",
        { source: "npm: @hypabolic/pi-hypa@0.1.13", extensions: [] },
        "npm: pi-mcp-adapter@2.11.0",
        "npm:@hypabolic/pi-hypa-tools",
        "npm:pi-mcp-adapter-tools",
        { source: "npm:context-mode", extensions: ["keep"] },
      ],
    }),
  );
  fs.writeFileSync(
    fakeManager,
    `import fs from "node:fs";\nimport path from "node:path";\nconst args = process.argv.slice(2);\nif (!args.includes("--ignore-scripts")) process.exit(9);\nif (!args.includes("@hypabolic/pi-hypa") || !args.includes("pi-mcp-adapter")) process.exit(8);\nconst prefix = args[args.indexOf("--prefix") + 1];\nconst manifestFile = path.join(prefix, "package.json");\nconst manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));\ndelete manifest.dependencies["@hypabolic/pi-hypa"];\ndelete manifest.dependencies["pi-mcp-adapter"];\nfs.writeFileSync(manifestFile, JSON.stringify(manifest));\nfs.rmSync(path.join(prefix, "node_modules", "@hypabolic", "pi-hypa"), { recursive: true, force: true });\nfs.rmSync(path.join(prefix, "node_modules", "pi-mcp-adapter"), { recursive: true, force: true });\nfs.appendFileSync(process.env.MANAGER_LOG, "uninstalled\\n");\n`,
  );

  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    LOCALAPPDATA: localAppData,
    HOME: home,
    USERPROFILE: home,
    MANAGER_LOG: managerLog,
  };
  for (let run = 0; run < 2; run++) {
    execFileSync(process.execPath, [path.join(root, "scripts", "retire-packages.mjs")], {
      env: environment,
      stdio: "pipe",
    });
  }

  const settings = readJson(path.join(agentDir, "settings.json"));
  const sources = settings.packages.map((packageSpec) =>
    typeof packageSpec === "string" ? packageSpec : packageSpec.source,
  );
  assert.deepEqual(sources, [
    "npm:@hypabolic/pi-hypa-tools",
    "npm:pi-mcp-adapter-tools",
    "npm:context-mode",
  ]);
  assert.deepEqual(settings.packages[2].extensions, ["keep"]);
  const dependencies = readJson(path.join(installRoot, "package.json")).dependencies;
  assert.equal(dependencies["context-mode"], "1.0.0");
  assert.equal(dependencies["pi-mcp-adapter-tools"], "1.0.0");
  assert.equal(fs.existsSync(packageDirectory), false);
  assert.equal(fs.existsSync(adapterDirectory), false);
  assert.equal(fs.existsSync(shim), true);
  assert.equal(fs.readFileSync(managerLog, "utf8"), "uninstalled\n");
});

test("retired package cleanup resolves the platform default npm executable", (t) => {
  const testRoot = temporaryDirectory("pi-retire-default-npm-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const packageDirectory = path.join(installRoot, "node_modules", "@hypabolic", "pi-hypa");
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ private: true, dependencies: { "@hypabolic/pi-hypa": "0.1.13" } }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ packages: ["npm:@hypabolic/pi-hypa"] }),
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "retire-packages.mjs")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: "pipe",
  });

  assert.equal(fs.existsSync(packageDirectory), false);
  assert.deepEqual(readJson(path.join(agentDir, "settings.json")).packages, []);
});

test("retired package cleanup resolves the Windows pnpm CLI shell-free", {
  skip: process.platform !== "win32",
}, (t) => {
  const testRoot = temporaryDirectory("pi-retire-pnpm-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const adapterDirectory = path.join(installRoot, "node_modules", "pi-mcp-adapter");
  const appData = path.join(testRoot, "AppData");
  const pnpmCli = path.join(appData, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs");
  const managerLog = path.join(testRoot, "manager.json");
  fs.mkdirSync(adapterDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(pnpmCli), { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "pi-mcp-adapter": "2.11.0" } }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ npmCommand: ["pnpm"], packages: [] }),
  );
  fs.writeFileSync(
    pnpmCli,
    `const fs = require("node:fs");\nconst path = require("node:path");\nconst args = process.argv.slice(2);\nconst prefix = args[args.indexOf("--prefix") + 1];\nconst manifestFile = path.join(prefix, "package.json");\nconst manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));\ndelete manifest.dependencies["pi-mcp-adapter"];\nfs.writeFileSync(manifestFile, JSON.stringify(manifest));\nfs.rmSync(path.join(prefix, "node_modules", "pi-mcp-adapter"), { recursive: true, force: true });\nfs.writeFileSync(process.env.MANAGER_LOG, JSON.stringify(args));\n`,
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "retire-packages.mjs")], {
    env: {
      ...process.env,
      APPDATA: appData,
      PI_CODING_AGENT_DIR: agentDir,
      MANAGER_LOG: managerLog,
    },
    stdio: "pipe",
  });

  const argumentsList = readJson(managerLog);
  assert.equal(argumentsList[0], "remove");
  assert.ok(argumentsList.includes("pi-mcp-adapter"));
  assert.ok(argumentsList.includes("--config.ignore-scripts=true"));
  assert.equal(argumentsList[argumentsList.indexOf("--prefix") + 1], installRoot);
  assert.equal(fs.existsSync(adapterDirectory), false);
});

test("retired package cleanup preserves a directly installed Hypa runtime", (t) => {
  const testRoot = temporaryDirectory("pi-retire-direct-hypa-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const runtimeDirectory = path.join(installRoot, "node_modules", "@hypabolic", "hypa");
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "@hypabolic/hypa": "0.1.13" } }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ packages: ["npm:@hypabolic/hypa"] }),
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "retire-packages.mjs")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: "pipe",
  });

  assert.equal(fs.existsSync(runtimeDirectory), true);
  assert.deepEqual(readJson(path.join(agentDir, "settings.json")).packages, ["npm:@hypabolic/hypa"]);
});

test("managed dependency refresh targets security fixes without lifecycle scripts", (t) => {
  const testRoot = temporaryDirectory("pi-refresh-managed-dependencies-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const fakeManager = path.join(testRoot, "fake-manager.mjs");
  const managerLog = path.join(testRoot, "manager.json");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "context-mode": "1.0.169" } }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ npmCommand: [process.execPath, fakeManager, "--", "npm"] }),
  );
  fs.writeFileSync(
    fakeManager,
    `import fs from "node:fs";\nfs.writeFileSync(process.env.MANAGER_LOG, JSON.stringify(process.argv.slice(2)));\n`,
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "refresh-managed-dependencies.mjs")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, MANAGER_LOG: managerLog },
    stdio: "pipe",
  });

  const argumentsList = readJson(managerLog);
  assert.deepEqual(argumentsList.slice(0, 3), ["--", "npm", "update"]);
  assert.ok(argumentsList.includes("@modelcontextprotocol/sdk"));
  assert.ok(argumentsList.includes("@hono/node-server"));
  assert.ok(argumentsList.includes("hono"));
  assert.ok(argumentsList.includes("fast-uri"));
  assert.ok(argumentsList.includes("ip-address"));
  assert.ok(argumentsList.includes("protobufjs"));
  assert.ok(argumentsList.includes("--ignore-scripts"));
  assert.ok(argumentsList.includes("--legacy-peer-deps"));
  assert.equal(argumentsList[argumentsList.indexOf("--prefix") + 1], installRoot);
});

test("managed dependency refresh resolves the Windows pnpm CLI shell-free", {
  skip: process.platform !== "win32",
}, (t) => {
  const testRoot = temporaryDirectory("pi-refresh-managed-pnpm-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const appData = path.join(testRoot, "AppData");
  const pnpmCli = path.join(appData, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs");
  const managerLog = path.join(testRoot, "manager.json");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(path.dirname(pnpmCli), { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "context-mode": "1.0.169" } }),
  );
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ npmCommand: ["pnpm"] }),
  );
  fs.writeFileSync(
    pnpmCli,
    `const fs = require("node:fs");\nfs.writeFileSync(process.env.MANAGER_LOG, JSON.stringify(process.argv.slice(2)));\n`,
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "refresh-managed-dependencies.mjs")], {
    env: {
      ...process.env,
      APPDATA: appData,
      PI_CODING_AGENT_DIR: agentDir,
      MANAGER_LOG: managerLog,
    },
    stdio: "pipe",
  });

  const argumentsList = readJson(managerLog);
  assert.equal(argumentsList[0], "update");
  assert.ok(argumentsList.includes("context-mode"));
  assert.equal(argumentsList.includes("@modelcontextprotocol/sdk"), false);
  assert.ok(argumentsList.includes("--config.ignore-scripts=true"));
  assert.equal(argumentsList[argumentsList.indexOf("--prefix") + 1], installRoot);
});

test("managed dependency refresh skips npm roots without context-mode", (t) => {
  const testRoot = temporaryDirectory("pi-refresh-managed-skip-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const managerLog = path.join(testRoot, "manager.log");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "unrelated-package": "1.0.0" } }),
  );

  execFileSync(process.execPath, [path.join(root, "scripts", "refresh-managed-dependencies.mjs")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, MANAGER_LOG: managerLog },
    stdio: "pipe",
  });

  assert.equal(fs.existsSync(managerLog), false);
});

test("FFmpeg check mode is side-effect-free when media tools are unavailable", (t) => {
  const testRoot = temporaryDirectory("pi-ffmpeg-check-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "setup-ffmpeg.mjs"), "--check"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
        LOCALAPPDATA: path.join(testRoot, "LocalAppData"),
        HOME: path.join(testRoot, "home"),
        USERPROFILE: path.join(testRoot, "home"),
      },
    },
  );
  assert.equal(result.status, 2);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Installing FFmpeg/);
});

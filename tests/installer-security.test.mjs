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

test("retired Hypa cleanup removes whitespace and versioned settings without deleting an ambiguous shim", (t) => {
  const testRoot = temporaryDirectory("pi-retire-hypa-");
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const agentDir = path.join(testRoot, ".pi", "agent");
  const installRoot = path.join(agentDir, "npm");
  const packageDirectory = path.join(installRoot, "node_modules", "@hypabolic", "pi-hypa");
  const fakeManager = path.join(testRoot, "fake-manager.mjs");
  const managerLog = path.join(testRoot, "manager.log");
  const localAppData = path.join(testRoot, "LocalAppData");
  const home = path.join(testRoot, "home");
  const shim = process.platform === "win32"
    ? path.join(localAppData, "Hypa", "bin", "hypa.cmd")
    : path.join(home, ".local", "bin", "hypa");

  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify({ name: "@hypabolic/pi-hypa" }));
  fs.writeFileSync(shim, `shim target ${packageDirectory}\n`);
  fs.writeFileSync(
    path.join(installRoot, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "@hypabolic/pi-hypa": "0.1.13",
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
        "npm:@hypabolic/pi-hypa-tools",
        { source: "npm:context-mode", extensions: ["keep"] },
      ],
    }),
  );
  fs.writeFileSync(
    fakeManager,
    `import fs from "node:fs";\nimport path from "node:path";\nconst args = process.argv.slice(2);\nif (!args.includes("--ignore-scripts")) process.exit(9);\nconst prefix = args[args.indexOf("--prefix") + 1];\nconst manifestFile = path.join(prefix, "package.json");\nconst manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));\ndelete manifest.dependencies["@hypabolic/pi-hypa"];\nfs.writeFileSync(manifestFile, JSON.stringify(manifest));\nfs.rmSync(path.join(prefix, "node_modules", "@hypabolic", "pi-hypa"), { recursive: true, force: true });\nfs.appendFileSync(process.env.MANAGER_LOG, "uninstalled\\n");\n`,
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
  assert.deepEqual(sources, ["npm:@hypabolic/pi-hypa-tools", "npm:context-mode"]);
  assert.deepEqual(settings.packages[1].extensions, ["keep"]);
  assert.equal(readJson(path.join(installRoot, "package.json")).dependencies["context-mode"], "1.0.0");
  assert.equal(fs.existsSync(packageDirectory), false);
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

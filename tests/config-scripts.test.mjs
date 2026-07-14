import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("package reconciliation preserves user filters and unrelated local packages", () => {
  const testRoot = temporaryDirectory("pi-apply-config-");
  const agentDir = path.join(testRoot, ".pi", "agent");
  const setupCheckout = path.join(testRoot, "ours", "Projects", "Pi");
  const unrelatedPiPackage = path.join(testRoot, "unrelated", "Projects", "Pi");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(setupCheckout, { recursive: true });
  fs.mkdirSync(unrelatedPiPackage, { recursive: true });
  fs.writeFileSync(path.join(setupCheckout, "package.json"), JSON.stringify({ name: "amabdomo-pi" }));
  fs.writeFileSync(path.join(unrelatedPiPackage, "package.json"), JSON.stringify({ name: "unrelated-pi" }));

  const filteredContextMode = { source: "npm:context-mode", extensions: ["keep-context-filter"] };
  const filteredHypa = { source: "npm:@hypabolic/pi-hypa", extensions: ["keep-hypa-filter"] };
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      packages: [
        unrelatedPiPackage,
        path.relative(agentDir, setupCheckout),
        "npm:context-mode",
        filteredContextMode,
        filteredHypa,
        "npm:@hypabolic/pi-hypa",
        "npm:pi-mcp-adapter",
        { source: "npm:pi-mcp-adapter", extensions: ["legacy-adapter"] },
      ],
      defaultModel: "keep-model",
      defaultThinkingLevel: "minimal",
    }),
  );

  const environment = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
  for (let run = 0; run < 2; run++) {
    execFileSync(process.execPath, [path.join(root, "scripts", "apply-config.mjs")], {
      env: environment,
      stdio: "pipe",
    });
  }

  const settings = readJson(path.join(agentDir, "settings.json"));
  const sources = settings.packages.map((packageSpec) =>
    typeof packageSpec === "string" ? packageSpec : packageSpec.source,
  );
  assert.ok(sources.includes(unrelatedPiPackage));
  assert.ok(!sources.includes(path.relative(agentDir, setupCheckout)));
  assert.deepEqual(settings.packages.find((packageSpec) => packageSpec.source === "npm:context-mode"), filteredContextMode);
  assert.deepEqual(settings.packages.find((packageSpec) => packageSpec.source === "npm:@hypabolic/pi-hypa"), filteredHypa);
  assert.equal(sources.filter((source) => source === "npm:context-mode").length, 1);
  assert.equal(sources.filter((source) => source === "npm:@hypabolic/pi-hypa").length, 1);
  assert.equal(sources.includes("npm:pi-mcp-adapter"), false);
  assert.match(fs.readFileSync(path.join(agentDir, "mcp.jsonc"), "utf8"), /"mcp"\s*:\s*\{\}/);
  assert.equal(settings.defaultModel, "keep-model");
  assert.equal(settings.defaultThinkingLevel, "minimal");
});

test("config capture copies shared preferences without runtime or credential fields", () => {
  const testRoot = temporaryDirectory("pi-capture-config-");
  const testRepo = path.join(testRoot, "repo");
  const agentDir = path.join(testRoot, "agent");
  fs.mkdirSync(path.join(testRepo, "scripts"), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  for (const relativePath of ["scripts/capture-config.mjs", "settings.example.json", "keybindings.json"]) {
    fs.copyFileSync(path.join(root, relativePath), path.join(testRepo, relativePath));
  }
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      theme: "captured-theme",
      defaultModel: "captured-model",
      packages: ["private-package"],
      lastChangelogVersion: "runtime-only",
      apiKey: "do-not-copy",
    }),
  );
  fs.writeFileSync(path.join(agentDir, "keybindings.json"), JSON.stringify({ "custom.action": ["ctrl+x"] }));

  execFileSync(process.execPath, [path.join(testRepo, "scripts", "capture-config.mjs")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: "pipe",
  });

  const captured = readJson(path.join(testRepo, "settings.example.json"));
  assert.equal(captured.theme, "captured-theme");
  assert.equal(captured.defaultModel, "captured-model");
  assert.equal(captured.lastChangelogVersion, undefined);
  assert.equal(captured.apiKey, undefined);
  assert.ok(captured.packages.includes("git:github.com/amAbdoMo/Pi"));
  assert.ok(!captured.packages.includes("private-package"));
  assert.deepEqual(readJson(path.join(testRepo, "keybindings.json")), { "custom.action": ["ctrl+x"] });
});

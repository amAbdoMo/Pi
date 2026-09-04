import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "jsonc-parser";
import {
  WORKBENCH_EXTENSIONS,
  extensionSnapshot,
  updateExtensionSettings,
  writeExtensionSettings,
} from "../browser/extension-settings.mjs";

const defaultSettings = JSON.stringify({
  packages: ["git:github.com/amAbdoMo/Pi", "npm:context-mode@1.0.169"],
}, null, 2);

function enabledStates(overrides = {}) {
  return Object.fromEntries(WORKBENCH_EXTENSIONS.map((extension) => [
    extension.id,
    overrides[extension.id] ?? true,
  ]));
}

test("Workbench extension catalog exposes exactly the 16 loadable entry points", async () => {
  assert.equal(WORKBENCH_EXTENSIONS.length, 16);
  assert.equal(new Set(WORKBENCH_EXTENSIONS.map((extension) => extension.id)).size, 16);
  assert.equal(new Set(WORKBENCH_EXTENSIONS.map((extension) => extension.path)).size, 16);
  await Promise.all(WORKBENCH_EXTENSIONS.map((extension) => access(new URL(`../${extension.path}`, import.meta.url))));
  assert.ok(extensionSnapshot(defaultSettings).every((extension) => extension.enabled));
});

test("extension snapshots honor broad include and exclude filters", () => {
  const filtered = JSON.stringify({
    packages: [{
      source: "git:github.com/amAbdoMo/Pi",
      extensions: ["extensions/**", "!extensions/memory/**"],
    }],
  });
  const excluded = JSON.stringify({
    packages: [{ source: "git:github.com/amAbdoMo/Pi", extensions: ["!extensions/**"] }],
  });

  assert.equal(extensionSnapshot(filtered).filter((extension) => extension.enabled).length, 15);
  assert.equal(extensionSnapshot(filtered).find((extension) => extension.id === "memory").enabled, false);
  assert.ok(extensionSnapshot(excluded).every((extension) => !extension.enabled));
});

test("extension settings preserve unrelated packages and unknown filters", () => {
  const settings = `{
  // Keep this user package and comment.
  "packages": [
    {
      "source": "git:github.com/amAbdoMo/Pi@main",
      "extensions": ["!extensions/private/**", "-extensions/memory/index.ts"],
      "skills": ["skills/**"],
      "customField": true
    },
    "npm:context-mode@1.0.169"
  ]
}`;
  const updated = updateExtensionSettings(settings, enabledStates({ memory: false, workflow: false }));
  const parsed = parse(updated);
  const workbench = parsed.packages[0];

  assert.match(updated, /Keep this user package and comment/);
  assert.equal(parsed.packages[1], "npm:context-mode@1.0.169");
  assert.deepEqual(workbench.skills, ["skills/**"]);
  assert.equal(workbench.customField, true);
  assert.ok(workbench.extensions.includes("!extensions/private/**"));
  assert.ok(workbench.extensions.includes("-extensions/memory/index.ts"));
  assert.ok(workbench.extensions.includes("-extensions/workflow/index.ts"));
  assert.equal(workbench.extensions.filter((selector) => selector.endsWith("extensions/memory/index.ts")).length, 1);
});

test("extension state updates are strict, atomic, and idempotent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-extension-settings-"));
  const settingsPath = path.join(root, "settings.json");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(settingsPath, defaultSettings);
  const states = enabledStates({ "login-guard": false });

  const first = await writeExtensionSettings(settingsPath, states);
  await writeExtensionSettings(settingsPath, states);
  const persisted = await readFile(settingsPath, "utf8");

  assert.equal(first.find((extension) => extension.id === "login-guard").enabled, false);
  assert.equal(parse(persisted).packages.length, 2);
  assert.equal(parse(persisted).packages[0].extensions.length, 16);
  await assert.rejects(access(`${settingsPath}.lock`));
  assert.throws(() => updateExtensionSettings(defaultSettings, { memory: true }), /every Workbench extension/);
});

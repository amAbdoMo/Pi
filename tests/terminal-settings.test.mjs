import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureTerminalSettings, parseJsonc } from "../scripts/set-terminal-font.mjs";

test("JSONC parsing accepts comments and trailing commas without changing string content", () => {
  const parsed = parseJsonc(`{
    // Windows Terminal permits comments.
    "url": "https://example.com/a//b",
    "profiles": { "list": [1, 2,], },
  }`);
  assert.equal(parsed.url, "https://example.com/a//b");
  assert.deepEqual(parsed.profiles.list, [1, 2]);
});

test("terminal font configuration preserves settings and creates only one backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const original = `{
    // Preserve semantic settings while adding the font.
    "defaultProfile": "profile-id",
    "profiles": {
      "defaults": { "opacity": 90, "font": { "features": { "ss01": 1 } } },
      "list": [{ "name": "PowerShell" }],
    },
  }`;
  fs.writeFileSync(settingsFile, original);

  assert.equal(configureTerminalSettings(settingsFile, "DejaVuSansM Nerd Font Mono"), true);
  assert.equal(configureTerminalSettings(settingsFile, "DejaVuSansM Nerd Font Mono"), false);

  const configured = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(configured.defaultProfile, "profile-id");
  assert.equal(configured.profiles.defaults.opacity, 90);
  assert.deepEqual(configured.profiles.list, [{ name: "PowerShell" }]);
  assert.equal(configured.profiles.defaults.font.face, "DejaVuSansM Nerd Font Mono");
  assert.deepEqual(configured.profiles.defaults.font.features, {
    ss01: 1,
    curs: 1,
    rlig: 1,
    liga: 1,
  });
  assert.equal(fs.readFileSync(`${settingsFile}.pi-workbench-backup`, "utf8"), original);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir =
  process.env.PI_CODING_AGENT_DIR ||
  process.env.PI_AGENT_DIR ||
  path.join(os.homedir(), ".pi", "agent");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Captured ${filePath}`);
}

const localSettings = readJson(path.join(agentDir, "settings.json"));
const sharedSettingsFile = path.join(root, "settings.example.json");
const sharedSettings = readJson(sharedSettingsFile);
const sharedKeys = [
  "theme",
  "defaultProvider",
  "defaultModel",
  "hideThinkingBlock",
  "defaultThinkingLevel",
  "editorPaddingX",
  "terminal",
  "steeringMode",
  "quietStartup",
  "enableInstallTelemetry",
  "doubleEscapeAction",
  "treeFilterMode",
  "warnings",
];

for (const key of sharedKeys) {
  if (localSettings[key] !== undefined) sharedSettings[key] = localSettings[key];
}
writeJson(sharedSettingsFile, sharedSettings);

const localKeybindingsFile = path.join(agentDir, "keybindings.json");
if (fs.existsSync(localKeybindingsFile)) {
  writeJson(path.join(root, "keybindings.json"), readJson(localKeybindingsFile));
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonFiles = ["package.json", "settings.example.json", "keybindings.json", "themes/hypr-waves.json"];

function parseJson(relativePath) {
  const filePath = path.join(root, relativePath);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`valid JSON: ${relativePath}`);
  return parsed;
}

const parsedJson = new Map(jsonFiles.map((relativePath) => [relativePath, parseJson(relativePath)]));
const packageManifest = parsedJson.get("package.json");
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (packageLock.version !== packageManifest.version || packageLock.packages?.[""]?.version !== packageManifest.version) {
  throw new Error("package.json and package-lock.json versions do not match");
}
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## ${packageManifest.version}`)) {
  throw new Error(`CHANGELOG.md is missing version ${packageManifest.version}`);
}

for (const resourceGroup of ["extensions", "themes"]) {
  for (const resourcePath of packageManifest.pi?.[resourceGroup] ?? []) {
    const absolutePath = path.resolve(root, resourcePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Missing ${resourceGroup} resource: ${resourcePath}`);
  }
}

const requiredFiles = [
  "extensions/ui/imagePaste.ts",
  "extensions/ui/terminalEditor.ts",
  "extensions/plan-mode/index.ts",
  "extensions/skills-browser/index.ts",
  "extensions/subagents/child-profile.ts",
  "scripts/apply-config.mjs",
  "scripts/capture-config.mjs",
  "scripts/setup-terminal-font.ps1",
  "scripts/set-terminal-font.mjs",
  "scripts/set-warp-settings.mjs",
  "UPSTREAM.md",
  "install.ps1",
  "install.sh",
];
for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`Missing required file: ${relativePath}`);
}

const headerSource = fs.readFileSync(path.join(root, "extensions/ui/header.ts"), "utf8");
const requiredHeaderIcons = ["󰉋", "", "󰒓", "󰧑", "󰍛", ""];
for (const icon of requiredHeaderIcons) {
  if (!headerSource.includes(icon)) throw new Error(`Missing required header icon: ${icon}`);
}

const fontSetupSource = fs.readFileSync(path.join(root, "scripts/setup-terminal-font.ps1"), "utf8");
for (const requiredFontSetting of ["CaskaydiaMono NFM", "3.4.0", "7c22db8c8460ef62abffbb6d5c7b212507de0798a4a762fa2a005a8bc4c90fc6"]) {
  if (!fontSetupSource.includes(requiredFontSetting)) {
    throw new Error(`Missing pinned Nerd Font setting: ${requiredFontSetting}`);
  }
}

const warpSettingsSource = fs.readFileSync(path.join(root, "scripts/set-warp-settings.mjs"), "utf8");
for (const requiredWarpSetting of ["font_name", "input_box_type_setting", "classic"]) {
  if (!warpSettingsSource.includes(requiredWarpSetting)) {
    throw new Error(`Missing Warp compatibility setting: ${requiredWarpSetting}`);
  }
}

for (const installer of ["install.ps1", "install.sh"]) {
  const installerSource = fs.readFileSync(path.join(root, installer), "utf8");
  for (const requiredReference of ["set-warp-settings.mjs", "WarpSettingsScript"]) {
    if (!installerSource.includes(requiredReference)) {
      throw new Error(`${installer} does not provision ${requiredReference}`);
    }
  }
}

const settings = parsedJson.get("settings.example.json");
const requiredPackages = [
  "git:github.com/amAbdoMo/Pi",
  "npm:@hypabolic/pi-hypa",
  "npm:context-mode",
  "npm:pi-mcp-adapter",
];
for (const packageSpec of requiredPackages) {
  if (!settings.packages?.includes(packageSpec)) throw new Error(`Missing recommended package: ${packageSpec}`);
}

console.log("Pi setup validation passed.");

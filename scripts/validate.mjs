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
  "scripts/apply-config.mjs",
  "scripts/capture-config.mjs",
  "UPSTREAM.md",
  "install.ps1",
  "install.sh",
];
for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`Missing required file: ${relativePath}`);
}

const headerSource = fs.readFileSync(path.join(root, "extensions/ui/header.ts"), "utf8");
const requiredHeaderIcons = ["󰉋", "", "󰧑", "󰍛", ""];
for (const icon of requiredHeaderIcons) {
  if (!headerSource.includes(icon)) throw new Error(`Missing required header icon: ${icon}`);
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

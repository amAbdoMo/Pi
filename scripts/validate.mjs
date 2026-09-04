import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonFiles = ["package.json", "settings.example.json", "keybindings.json", "themes/hypr-waves.json", "bootstrap-manifest.json"];

function parseJson(relativePath) {
  const filePath = path.join(root, relativePath);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`valid JSON: ${relativePath}`);
  return parsed;
}

const parsedJson = new Map(jsonFiles.map((relativePath) => [relativePath, parseJson(relativePath)]));
const packageManifest = parsedJson.get("package.json");
const bootstrapManifest = parsedJson.get("bootstrap-manifest.json");
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (packageManifest.name !== "pi-workbench") {
  throw new Error("package.json must use the global pi-workbench package name");
}
if (
  packageLock.name !== packageManifest.name
  || packageLock.packages?.[""]?.name !== packageManifest.name
  || packageLock.version !== packageManifest.version
  || packageLock.packages?.[""]?.version !== packageManifest.version
  || packageLock.packages?.[""]?.bin?.["pi-workbench-install"] !== "scripts/install-cli.mjs"
  || packageLock.packages?.[""]?.engines?.node !== packageManifest.engines?.node
) {
  throw new Error("package.json and package-lock.json metadata do not match");
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

if (bootstrapManifest.release !== packageManifest.version) {
  throw new Error("bootstrap-manifest.json release must match package.json version");
}
for (const [name, source] of Object.entries(bootstrapManifest.packages ?? {})) {
  if (!source || source.includes("@latest")) throw new Error(`Bootstrap package ${name} must be pinned`);
}

const requiredFiles = [
  "extensions/mcp/index.ts",
  "extensions/mcp/config.ts",
  "extensions/mcp/hub.ts",
  "extensions/ui/agentTime.ts",
  "extensions/ui/agentTimeTracker.ts",
  "extensions/ui/copyFeedback.ts",
  "extensions/ui/imagePaste.ts",
  "extensions/ui/rtlText.ts",
  "extensions/ui/terminalEditor.ts",
  "extensions/ui/textSelection.ts",
  "extensions/ui/workbenchShell.ts",
  "extensions/ui/workbenchSidebar.ts",
  "extensions/plan-mode/index.ts",
  "extensions/skills-browser/index.ts",
  "extensions/subagents/child-profile.ts",
  "extensions/subagents/runtime/detail-bounds.ts",
  "extensions/subagents/runtime/errors.ts",
  "extensions/subagents/runtime/handoff-cache.ts",
  "extensions/subagents/runtime/invocation.ts",
  "extensions/subagents/runtime/limits.ts",
  "extensions/subagents/summaries/model.ts",
  "extensions/subagents/summaries/parent-content.ts",
  "extensions/subagents/summaries/payload-limit.ts",
  "extensions/workflow/index.ts",
  "extensions/workflow/schema.ts",
  "extensions/workflow/runner.ts",
  "extensions/workflow/rpc-client.ts",
  "extensions/workflow/pipeline.yaml",
  "extensions/workflow/deep-review.yaml",
  "scripts/analyze-sessions.mjs",
  "scripts/generate-session-report.mjs",
  "reports/pi-workflow-audit.template.html",
  "reports/pi-workflow-audit.html",
  "APPEND_SYSTEM.md",
  "scripts/apply-config.mjs",
  "scripts/capture-config.mjs",
  "scripts/install-cli.mjs",
  "scripts/bootstrap.mjs",
  "scripts/bootstrap/checkpoint.mjs",
  "scripts/bootstrap/contracts.mjs",
  "scripts/bootstrap/files.mjs",
  "scripts/bootstrap/runtime.mjs",
  "bootstrap-manifest.json",
  "setup.ps1",
  "scripts/retire-packages.mjs",
  "scripts/refresh-managed-dependencies.mjs",
  "scripts/scan-public-files.mjs",
  "scripts/setup-ffmpeg.mjs",
  "scripts/setup-browser-mcp.mjs",
  "scripts/browser/pi-browser-mcp.ps1",
  "scripts/browser/pi-browser-idle-close.ps1",
  "browser/server.mjs",
  "browser/security.mjs",
  "browser/session-catalog.mjs",
  "browser/pi-bridge.mjs",
  "browser/public/index.html",
  "browser/public/styles.css",
  "browser/public/app.js",
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

const statusSurfaceSource = [
  "extensions/ui/header.ts",
  "extensions/ui/workbenchSidebar.ts",
].map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8")).join("\n");
const requiredStatusIcons = ["󰉋", "", "󰧑", "󰍛", ""];
for (const icon of requiredStatusIcons) {
  if (!statusSurfaceSource.includes(icon)) throw new Error(`Missing required status icon: ${icon}`);
}

const fontSetupSource = fs.readFileSync(path.join(root, "scripts/setup-terminal-font.ps1"), "utf8");
for (const requiredFontSetting of ["DejaVuSansM Nerd Font Mono", "3.4.0", "0e58ff9c1f9378922b7f324fdba953929d88d61b36aedd80ee43964567b226cc"]) {
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
  for (const requiredReference of [
    "set-warp-settings.mjs",
    "WarpSettingsScript",
    "APPEND_SYSTEM.md",
    "system-policy",
    "retire-packages.mjs",
    "refresh-managed-dependencies.mjs",
    "setup-ffmpeg.mjs",
  ]) {
    if (!installerSource.includes(requiredReference)) {
      throw new Error(`${installer} does not provision ${requiredReference}`);
    }
  }
  for (const retiredPackage of ["pi-mcp-adapter", "@hypabolic/pi-hypa"]) {
    if (installerSource.includes(retiredPackage)) {
      throw new Error(`${installer} still installs the retired ${retiredPackage} package`);
    }
  }
}

const windowsInstallerSource = fs.readFileSync(path.join(root, "install.ps1"), "utf8");
const posixInstallerSource = fs.readFileSync(path.join(root, "install.sh"), "utf8");
for (const packageSpec of [bootstrapManifest.packages.workbench, bootstrapManifest.packages.contextMode]) {
  if (!windowsInstallerSource.includes(packageSpec) || !posixInstallerSource.includes(packageSpec)) {
    throw new Error(`Platform installers must default to pinned package ${packageSpec}`);
  }
}
for (const browserMcpAsset of [
  "setup-browser-mcp.mjs",
  "pi-browser-mcp.ps1",
  "pi-browser-idle-close.ps1",
]) {
  if (!windowsInstallerSource.includes(browserMcpAsset)) {
    throw new Error(`install.ps1 does not provision ${browserMcpAsset}`);
  }
}

const applyConfigSource = fs.readFileSync(path.join(root, "scripts/apply-config.mjs"), "utf8");
for (const packageSpec of [bootstrapManifest.packages.workbench, bootstrapManifest.packages.contextMode]) {
  if (!applyConfigSource.includes(packageSpec)) {
    throw new Error(`apply-config.mjs must reconcile pinned package ${packageSpec}`);
  }
}
for (const policyMarker of ["pi-workbench:managed-policy:start", "pi-workbench:managed-policy:end"]) {
  if (!applyConfigSource.includes(policyMarker)) {
    throw new Error(`apply-config.mjs is missing ${policyMarker}`);
  }
}

const agentPolicy = fs.readFileSync(path.join(root, "APPEND_SYSTEM.md"), "utf8");
for (const requiredWordPressPolicy of [
  "do not create standalone HTML review pages",
  "ask one concise question offering three choices",
  "Not tested in a real WordPress environment.",
]) {
  if (!agentPolicy.includes(requiredWordPressPolicy)) {
    throw new Error(`APPEND_SYSTEM.md is missing WordPress policy: ${requiredWordPressPolicy}`);
  }
}

const browserSupervisorSource = fs.readFileSync(path.join(root, "scripts/browser/pi-browser-mcp.ps1"), "utf8");
if (!browserSupervisorSource.includes(bootstrapManifest.packages.playwrightMcp) || browserSupervisorSource.includes("@playwright/mcp@latest")) {
  throw new Error("Browser supervisor must use the pinned Playwright MCP package");
}
const setupSource = fs.readFileSync(path.join(root, "setup.ps1"), "utf8");
for (const command of ["diagnose", "install", "verify", "rollback"]) {
  if (!setupSource.includes(command)) throw new Error(`setup.ps1 is missing ${command}`);
}

const settings = parsedJson.get("settings.example.json");
const requiredPackages = [
  bootstrapManifest.packages.workbench,
  bootstrapManifest.packages.contextMode,
];
for (const packageSpec of requiredPackages) {
  if (!settings.packages?.includes(packageSpec)) throw new Error(`Missing recommended package: ${packageSpec}`);
}
for (const retiredPackage of ["npm:pi-mcp-adapter", "npm:@hypabolic/pi-hypa"]) {
  if (settings.packages?.some((packageSpec) => {
    const source = typeof packageSpec === "string" ? packageSpec : packageSpec?.source;
    const normalizedSource = source?.replace(/^npm:\s*/, "npm:");
    return normalizedSource === retiredPackage || normalizedSource?.startsWith(`${retiredPackage}@`);
  })) {
    throw new Error(`The retired ${retiredPackage} package must not be reinstalled`);
  }
}
if (Object.keys(packageManifest.bin ?? {}).length !== 1 || packageManifest.bin?.["pi-workbench-install"] !== "./scripts/install-cli.mjs") {
  throw new Error("package.json must expose exactly one deterministic pi-workbench-install bin");
}
if (packageManifest.scripts?.browser !== "node browser/server.mjs") {
  throw new Error("package.json must expose the local Pi Harness launcher");
}
for (const dependency of ["@modelcontextprotocol/sdk", "arabic-reshaper", "bidi-js", "jsonc-parser", "typebox", "yaml"]) {
  if (!packageManifest.dependencies?.[dependency]) throw new Error(`Missing runtime dependency: ${dependency}`);
}

console.log("Pi setup validation passed.");

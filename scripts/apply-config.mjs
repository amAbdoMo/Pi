import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED_PACKAGES = [
  "git:github.com/amAbdoMo/Pi",
  "npm:@hypabolic/pi-hypa",
  "npm:context-mode",
];
const RETIRED_PACKAGES = new Set(["npm:pi-mcp-adapter"]);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageSource(packageSpec) {
  return typeof packageSpec === "string" ? packageSpec : packageSpec?.source;
}

function isLocalSource(source) {
  return typeof source === "string" && !/^(git:|npm:|https?:|ssh:)/i.test(source);
}

function isThisSetupCheckout(packageSpec, agentDir) {
  const source = packageSource(packageSpec);
  if (!isLocalSource(source)) return false;

  const checkoutPath = path.resolve(agentDir, source);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(checkoutPath, "package.json"), "utf8"));
    return manifest.name === "amabdomo-pi";
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

function mergePackages(existingPackages, agentDir) {
  const preservedPackages = [];
  const requiredSpecs = new Map();

  for (const packageSpec of Array.isArray(existingPackages) ? existingPackages : []) {
    if (isThisSetupCheckout(packageSpec, agentDir)) continue;

    const source = packageSource(packageSpec);
    if (RETIRED_PACKAGES.has(source)) continue;
    if (!REQUIRED_PACKAGES.includes(source)) {
      preservedPackages.push(packageSpec);
      continue;
    }

    const existingSpec = requiredSpecs.get(source);
    if (existingSpec === undefined || (typeof existingSpec === "string" && typeof packageSpec === "object")) {
      requiredSpecs.set(source, packageSpec);
    }
  }

  return [
    ...preservedPackages,
    ...REQUIRED_PACKAGES.map((source) => requiredSpecs.get(source) ?? source),
  ];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Updated ${filePath}`);
}

function ensureMcpConfig(filePath) {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `{\n  // Add local and remote MCP servers here.\n  "mcp": {}\n}\n`);
  console.log(`Created ${filePath}`);
}

const agentDir =
  process.env.PI_CODING_AGENT_DIR ||
  process.env.PI_AGENT_DIR ||
  path.join(os.homedir(), ".pi", "agent");

const settingsFile = path.join(agentDir, "settings.json");
const settings = readJson(settingsFile);
settings.theme = "hypr-waves";
settings.packages = mergePackages(settings.packages, agentDir);
settings.defaultProvider ??= "openai-codex";
settings.defaultModel ??= "gpt-5.6-sol";
settings.hideThinkingBlock ??= false;
settings.defaultThinkingLevel ??= "high";
settings.editorPaddingX ??= 0;
settings.terminal = { ...(settings.terminal || {}), showTerminalProgress: true };
settings.steeringMode ??= "one-at-a-time";
settings.quietStartup ??= true;
settings.enableInstallTelemetry ??= false;
settings.doubleEscapeAction ??= "tree";
settings.treeFilterMode ??= "no-tools";
settings.warnings = { ...(settings.warnings || {}), anthropicExtraUsage: true };
writeJson(settingsFile, settings);
ensureMcpConfig(path.join(agentDir, "mcp.jsonc"));

const keybindingsFile = path.join(agentDir, "keybindings.json");
const keybindings = readJson(keybindingsFile);
keybindings["tui.input.copy"] = ["ctrl+c"];
keybindings["app.clear"] = [];
keybindings["app.clipboard.pasteImage"] = [];
writeJson(keybindingsFile, keybindings);

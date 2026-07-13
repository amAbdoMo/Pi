import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function removeJsonComments(jsonc) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < jsonc.length; index++) {
    const character = jsonc[index];
    const nextCharacter = jsonc[index + 1];

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        output += "  ";
        blockComment = false;
        index++;
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      output += "  ";
      index++;
    } else if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      output += "  ";
      index++;
    } else {
      output += character;
    }
  }
  if (inString || blockComment) throw new Error("Invalid JSONC: unterminated string or comment");
  return output;
}

function removeTrailingCommas(json) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < json.length; index++) {
    const character = json[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(json[nextIndex] ?? "")) nextIndex++;
      if (json[nextIndex] === "}" || json[nextIndex] === "]") continue;
    }
    output += character;
  }
  return output;
}

export function parseJsonc(jsonc) {
  return JSON.parse(removeTrailingCommas(removeJsonComments(jsonc)));
}

function objectProperty(parent, propertyName, settingsFile) {
  const existing = parent[propertyName];
  if (existing === undefined || existing === null) {
    parent[propertyName] = {};
    return parent[propertyName];
  }
  if (typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error(`${settingsFile}: ${propertyName} must be an object`);
  }
  return existing;
}

export function configureTerminalSettings(settingsFile, fontFamily) {
  if (!fs.existsSync(settingsFile)) return false;

  const settings = parseJsonc(fs.readFileSync(settingsFile, "utf8"));
  const profiles = objectProperty(settings, "profiles", settingsFile);
  const defaults = objectProperty(profiles, "defaults", settingsFile);
  const font = objectProperty(defaults, "font", settingsFile);
  if (font.face === fontFamily) return false;

  const backupFile = `${settingsFile}.amabdomo-pi-backup`;
  if (!fs.existsSync(backupFile)) fs.copyFileSync(settingsFile, backupFile);
  font.face = fontFamily;
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 4)}\n`);
  console.log(`Configured ${settingsFile} to use ${fontFamily}`);
  return true;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [, , fontFamily, ...settingsFiles] = process.argv;
  if (!fontFamily || settingsFiles.length === 0) {
    throw new Error("Usage: node set-terminal-font.mjs <font-family> <settings-file> [...settings-files]");
  }
  for (const settingsFile of settingsFiles) configureTerminalSettings(settingsFile, fontFamily);
}

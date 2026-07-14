import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WARP_SETTING_TARGETS = [
  { table: "appearance.text", parent: "appearance", child: "text", key: "font_name" },
  { table: "terminal.input", parent: "terminal", child: "input", key: "input_box_type_setting" },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tableHeaderName(line) {
  return line.match(/^\s*\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]\s*(?:#.*)?$/)?.[1];
}

function isTableHeader(line) {
  return tableHeaderName(line) !== undefined;
}

function tomlCommentSuffix(line) {
  let quote;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && !escaped) {
      quote = quote === character ? undefined : quote ?? character;
    } else if (character === "#" && !quote) {
      let commentStart = index;
      while (commentStart > 0 && /\s/.test(line[commentStart - 1])) commentStart--;
      return line.slice(commentStart);
    }
    escaped = false;
  }
  return "";
}

function assignmentKey(line) {
  let quote;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote === '"' && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && !escaped) {
      quote = quote === character ? undefined : quote ?? character;
    } else if (character === "#" && !quote) {
      return undefined;
    } else if (character === "=" && !quote) {
      return line.slice(0, index).trim();
    }
    escaped = false;
  }
  return undefined;
}

function assertSupportedTargetPath(currentTable, key, target, settingsFile) {
  if (currentTable === target.parent && key === target.child) {
    throw new Error(`${settingsFile}: inline ${target.table} settings are not supported safely`);
  }
  if (!currentTable && key === target.parent) {
    throw new Error(`${settingsFile}: inline ${target.parent} settings are not supported safely`);
  }
  const targetLeafTable = `${target.table}.${target.key}`;
  if (currentTable === targetLeafTable || currentTable.startsWith(`${targetLeafTable}.`)) {
    throw new Error(`${settingsFile}: ${targetLeafTable} is defined as a table`);
  }
}

function assertSupportedTomlSubset(original, settingsFile) {
  let currentTable = "";
  for (const line of original.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    if (trimmedLine.startsWith("[")) {
      const headerName = tableHeaderName(line);
      if (!headerName) throw new Error(`${settingsFile}: unsupported TOML table syntax`);
      currentTable = headerName;
      for (const target of WARP_SETTING_TARGETS) {
        assertSupportedTargetPath(currentTable, "", target, settingsFile);
      }
      continue;
    }

    const key = assignmentKey(line);
    if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`${settingsFile}: unsupported TOML assignment syntax`);
    }
    for (const target of WARP_SETTING_TARGETS) {
      assertSupportedTargetPath(currentTable, key, target, settingsFile);
    }
  }
}

function tableBounds(lines, tableName, settingsFile) {
  const starts = lines
    .map((line, index) => (tableHeaderName(line) === tableName ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length > 1) throw new Error(`${settingsFile}: duplicate [${tableName}] table`);
  if (starts.length === 0) return undefined;

  const start = starts[0];
  const nextHeader = lines.findIndex((line, index) => index > start && isTableHeader(line));
  return { start, end: nextHeader < 0 ? lines.length : nextHeader };
}

function assignTomlString(lines, assignmentTarget, settingsFile) {
  const { tableName, key, settingValue } = assignmentTarget;
  const bounds = tableBounds(lines, tableName, settingsFile);
  if (!bounds) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(`[${tableName}]`, `${key} = ${JSON.stringify(settingValue)}`);
    return;
  }

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const matches = lines
    .slice(bounds.start + 1, bounds.end)
    .map((line, offset) => (keyPattern.test(line) ? bounds.start + 1 + offset : -1))
    .filter((index) => index >= 0);
  if (matches.length > 1) throw new Error(`${settingsFile}: duplicate ${key} setting in [${tableName}]`);

  const assignment = `${key} = ${JSON.stringify(settingValue)}`;
  if (matches.length === 0) {
    let insertionIndex = bounds.end;
    while (insertionIndex > bounds.start + 1 && lines[insertionIndex - 1].trim() === "") {
      insertionIndex--;
    }
    lines.splice(insertionIndex, 0, assignment);
    return;
  }

  const existingLine = lines[matches[0]];
  const indentation = existingLine.match(/^\s*/)?.[0] ?? "";
  lines[matches[0]] = `${indentation}${assignment}${tomlCommentSuffix(existingLine)}`;
}

function configuredWarpToml(original, settingsFile, fontFamily) {
  if (original.includes("'''") || original.includes('"""')) {
    throw new Error(`${settingsFile}: multiline TOML strings are not supported safely`);
  }
  assertSupportedTomlSubset(original, settingsFile);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(original);
  const lines = original.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  if (lines.length === 1 && lines[0] === "") lines.pop();

  assignTomlString(
    lines,
    { tableName: "appearance.text", key: "font_name", settingValue: fontFamily },
    settingsFile,
  );
  assignTomlString(
    lines,
    { tableName: "terminal.input", key: "input_box_type_setting", settingValue: "classic" },
    settingsFile,
  );
  return lines.join(eol) + (endsWithNewline ? eol : "");
}

function replaceFile(settingsFile, configured) {
  const temporaryFile = `${settingsFile}.pi-workbench-${randomUUID()}.tmp`;
  const mode = fs.statSync(settingsFile).mode;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryFile, "wx", mode);
    fs.writeFileSync(descriptor, configured);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryFile, settingsFile);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

export function configureWarpSettings(settingsFile, fontFamily) {
  if (!fs.existsSync(settingsFile)) return false;

  const original = fs.readFileSync(settingsFile, "utf8");
  const configured = configuredWarpToml(original, settingsFile, fontFamily);
  if (configured === original) return false;

  const backupFile = `${settingsFile}.pi-workbench-backup`;
  const legacyBackupFile = `${settingsFile}.amabdomo-pi-backup`;
  const createdBackup = !fs.existsSync(backupFile) && !fs.existsSync(legacyBackupFile);
  if (createdBackup) fs.copyFileSync(settingsFile, backupFile);
  try {
    replaceFile(settingsFile, configured);
  } catch (replacementError) {
    if (createdBackup) fs.unlinkSync(backupFile);
    throw replacementError;
  }
  console.log(`Configured ${settingsFile} for Pi terminal compatibility`);
  return true;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [, , fontFamily, ...settingsFiles] = process.argv;
  if (!fontFamily || settingsFiles.length === 0) {
    throw new Error("Usage: node set-warp-settings.mjs <font-family> <settings-file> [...settings-files]");
  }
  for (const settingsFile of settingsFiles) configureWarpSettings(settingsFile, fontFamily);
}

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode } from "jsonc-parser";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const MAX_TEXT = 16 * 1024;
const CREDENTIAL_HEADER = /(?:authorization|auth|cookie|credential|token|api[-_]?key|secret|password)/i;
const CREDENTIAL_ENV = /(?:authorization|auth|cookie|credential|token|api[-_]?key|secret|password)/i;
const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" };

function invalid(message, code = "INVALID_MCP_SETTINGS") {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function cleanString(value, label, { max = MAX_TEXT, required = true } = {}) {
  if (typeof value !== "string") throw invalid(`${label} must be a string`);
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000]/.test(text)) throw invalid(`${label} is invalid`);
  return text;
}

function cleanName(value, label = "Server name") {
  const name = cleanString(value, label, { max: 128 });
  if (!SERVER_NAME.test(name) || name === "." || name === "..") throw invalid(`${label} is invalid`);
  return name;
}

function cleanFieldName(value, label) {
  const name = cleanString(value, label, { max: 128 });
  if (!FIELD_NAME.test(name)) throw invalid(`${label} is invalid`);
  return name;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sourceHash(sourcePath) {
  const absolute = path.resolve(sourcePath);
  const normalized = process.platform === "win32" ? absolute.replaceAll("\\", "/").toLowerCase() : absolute;
  return createHash("sha256").update(normalized).digest("base64url");
}

function credentialId(source, server, location, key) {
  return createHash("sha256").update(JSON.stringify([source, server, location, key])).digest("base64url");
}

function optionsWithDefaults(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
  const agentDirectory = path.resolve(options.agentDirectory ?? process.env.PI_CODING_AGENT_DIR ?? path.join(homeDirectory, ".pi", "agent"));
  return { cwd, homeDirectory, agentDirectory, includeProject: options.includeProject !== false };
}

export function mcpSettingsPaths(options = {}) {
  const resolved = optionsWithDefaults(options);
  const sharedDirectory = path.join(resolved.homeDirectory, ".config", "mcp");
  const paths = [
    path.join(resolved.homeDirectory, ".config", "mcp", "mcp.json"),
    path.join(resolved.homeDirectory, ".config", "mcp", "mcp.jsonc"),
    path.join(resolved.agentDirectory, "mcp.json"),
    path.join(resolved.agentDirectory, "mcp.jsonc"),
  ];
  if (resolved.includeProject) paths.push(
    path.join(resolved.cwd, ".mcp.json"),
    path.join(resolved.cwd, ".mcp.jsonc"),
    path.join(resolved.cwd, ".pi", "mcp.json"),
    path.join(resolved.cwd, ".pi", "mcp.jsonc"),
  );
  return {
    ...resolved,
    authPath: path.join(resolved.agentDirectory, "mcp-auth.json"),
    mutationLockPath: path.join(sharedDirectory, ".pi-workbench-mutation"),
    configPaths: paths,
  };
}

function parseJsoncObject(text, label) {
  const errors = [];
  const document = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw invalid(`${label} is invalid JSONC: ${printParseErrorCode(errors[0].error)}`);
  if (!isRecord(document)) throw invalid(`${label} root must be an object`);
  return document;
}

function parseAuth(text) {
  let document;
  try { document = JSON.parse(text); } catch { throw invalid("Private MCP credential storage is invalid"); }
  if (!isRecord(document)) throw invalid("Private MCP credential storage must contain an object");
  if (document.version !== undefined && document.version !== 1) throw invalid("Private MCP credential storage version is not supported");
  if (document.credentials === undefined) document.credentials = {};
  if (!isRecord(document.credentials)) throw invalid("Private MCP credentials must contain an object");
  for (const [id, row] of Object.entries(document.credentials)) {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(id) || !validCredentialRow(row)) throw invalid("Private MCP credential storage contains an invalid row");
  }
  return document;
}

function validCredentialRow(row) {
  return isRecord(row)
    && typeof row.source === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(row.source)
    && typeof row.server === "string" && SERVER_NAME.test(row.server)
    && (row.location === "env" || row.location === "headers")
    && typeof row.key === "string" && FIELD_NAME.test(row.key)
    && typeof row.value === "string" && row.value.length > 0 && row.value.length <= MAX_TEXT;
}

function containerInfo(document) {
  for (const key of ["mcpServers", "servers", "mcp"]) {
    if (document[key] !== undefined) {
      if (!isRecord(document[key])) throw invalid(`${key} must be an object`);
      return { key, servers: document[key] };
    }
  }
  return null;
}

function safeSource(filePath, index, paths) {
  let scope = "global";
  if (filePath.startsWith(`${paths.cwd}${path.sep}`)) scope = "project";
  else if (filePath.startsWith(`${paths.agentDirectory}${path.sep}`)) scope = "agent";
  return {
    id: sourceHash(filePath),
    scope,
    file: path.basename(filePath),
    precedence: index,
  };
}

async function readExisting(filePath) {
  try { return { exists: true, text: await readFile(filePath, "utf8") }; }
  catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

async function loadState(options = {}) {
  const paths = mcpSettingsPaths(options);
  const authFile = await readExisting(paths.authPath);
  const auth = authFile.exists ? parseAuth(authFile.text) : { version: 1, credentials: {} };
  const sources = [];
  const diagnostics = [];
  for (let index = 0; index < paths.configPaths.length; index += 1) {
    const filePath = paths.configPaths[index];
    let file;
    try { file = await readExisting(filePath); }
    catch { diagnostics.push({ source: safeSource(filePath, index, paths), message: "Configuration could not be read" }); continue; }
    if (!file.exists) continue;
    try {
      const document = parseJsoncObject(file.text, path.basename(filePath));
      const container = containerInfo(document);
      if (!container) {
        diagnostics.push({ source: safeSource(filePath, index, paths), message: "Expected an mcp, mcpServers, or servers object" });
        continue;
      }
      sources.push({ filePath, text: file.text, document, containerKey: container.key, servers: container.servers, source: safeSource(filePath, index, paths) });
    } catch (error) {
      diagnostics.push({ source: safeSource(filePath, index, paths), message: error.message });
    }
  }
  return { paths, auth, authExists: authFile.exists, authText: authFile.text, sources, diagnostics };
}

function privateRows(auth, source, server) {
  return Object.entries(auth.credentials)
    .filter(([, row]) => row.source === source && row.server === server)
    .map(([id, row]) => ({ id, ...row }));
}

function transportOf(raw) {
  const declared = raw.transport ?? raw.type;
  if (["stdio", "local"].includes(declared) || (!declared && (typeof raw.command === "string" || Array.isArray(raw.command)))) return "stdio";
  if (["http", "streamable-http", "remote"].includes(declared) || (!declared && typeof raw.url === "string")) return "streamable-http";
  return "invalid";
}

function disabledOf(raw) {
  if (typeof raw.disabled === "boolean") return raw.disabled;
  if (typeof raw.enabled === "boolean") return !raw.enabled;
  return false;
}

const SENSITIVE_NAME = /(?:authorization|auth|cookie|credential|token|api[-_]?key|secret|password)/i;

function publicUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function unquotedValue(value) {
  return typeof value === "string" ? value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2") : "";
}

function absolutePathValue(value) {
  if (typeof value !== "string") return null;
  const unquoted = unquotedValue(value);
  if (path.isAbsolute(unquoted) || path.win32.isAbsolute(unquoted) || path.posix.isAbsolute(unquoted)) return unquoted;
  const windowsPath = /[A-Za-z]:[\\/][^"']*/.exec(value)?.[0]?.trimEnd();
  if (windowsPath) return windowsPath;
  const uncPath = /(?:^|[=:"'])(\\\\[^\\/"']+[\\/][^"']*|\/\/[^/"']+\/[^"']*)/.exec(value)?.[1]?.trimEnd();
  if (uncPath) return uncPath;
  return /(?:^|[=:"'])(\/(?!\/)[^"']*)/.exec(value)?.[1]?.trimEnd() ?? null;
}

function pathBasename(privatePath) {
  return path.win32.isAbsolute(privatePath) ? path.win32.basename(privatePath) : path.posix.basename(privatePath);
}

function sensitiveArgumentName(value) {
  const candidate = unquotedValue(value).replace(/^(?:--?|\/)/, "");
  const name = /^([^=:]+)(?:[=:]|$)/.exec(candidate)?.[1];
  return name && SENSITIVE_NAME.test(name) ? name : null;
}

function containsSensitiveAssignment(value) {
  return /(?:^|[=:]\s*)(?:--?|\/)?(?:authorization|auth|cookie|credential|token|api[-_]?key|secret|password)[=:]\s*.+/i
    .test(unquotedValue(value));
}

function publicCommand(command) {
  const entries = command.filter((entry) => typeof entry === "string");
  return entries.map((entry, index) => {
    if (index > 0 && sensitiveArgumentName(entries[index - 1])) return "[REDACTED]";
    const candidate = unquotedValue(entry);
    if (containsSensitiveAssignment(candidate)) return "[REDACTED_ARGUMENT]";
    const privatePath = absolutePathValue(entry);
    if (!privatePath) return entry;
    return unquotedValue(entry) === privatePath ? pathBasename(privatePath) : entry.replace(privatePath, "[PRIVATE_PATH]");
  });
}

function safePublicValue(value) {
  const privatePath = absolutePathValue(value);
  if (!privatePath) return value;
  return unquotedValue(value) === privatePath ? pathBasename(privatePath) : value.replace(privatePath, "[PRIVATE_PATH]");
}

function credentialRowId(location, key) {
  return `${location}:${location === "headers" || (location === "env" && process.platform === "win32") ? key.toLowerCase() : key}`;
}

function publicConfig(raw, rows) {
  const transport = transportOf(raw);
  const rowMap = new Map(rows.map((row) => [credentialRowId(row.location, row.key), row]));
  const settings = {
    transport,
    disabled: disabledOf(raw),
    managed: raw.piWorkbenchManaged === true,
  };
  if (transport === "stdio") {
    const command = Array.isArray(raw.command) ? raw.command : [raw.command, ...(Array.isArray(raw.args) ? raw.args : [])];
    settings.command = publicCommand(command);
    settings.commandMasked = command.some((entry) => Boolean(absolutePathValue(entry)));
    if (typeof raw.cwd === "string") {
      settings.cwd = safePublicValue(raw.cwd);
      settings.cwdMasked = Boolean(absolutePathValue(raw.cwd));
    }
    settings.envField = raw.env === undefined && raw.environment !== undefined ? "environment" : "env";
    settings.env = publicKeyValues(raw.env ?? raw.environment, "env", rowMap);
  } else if (transport === "streamable-http") {
    settings.url = publicUrl(raw.url);
    if (typeof raw.url === "string") {
      try {
        const parsed = new URL(raw.url);
        settings.urlMasked = !["http:", "https:"].includes(parsed.protocol)
          || Boolean(parsed.username || parsed.password || parsed.search || parsed.hash);
      } catch { settings.urlMasked = true; }
    }
    settings.headers = publicKeyValues(raw.headers, "headers", rowMap);
  }
  for (const row of rows) {
    const list = settings[row.location] ??= [];
    if (!list.some((entry) => credentialRowId(row.location, entry.key) === credentialRowId(row.location, row.key))) {
      list.push({ key: row.key, private: true, configured: true });
    }
  }
  return settings;
}

function publicKeyValues(raw, location, rowMap) {
  if (!isRecord(raw)) return [];
  return Object.entries(raw).map(([key, value]) => {
    const secret = location === "headers" ? CREDENTIAL_HEADER.test(key) : CREDENTIAL_ENV.test(key);
    const privateRow = rowMap.has(credentialRowId(location, key));
    return {
      key,
      ...(secret || privateRow ? {} : { value: typeof value === "string" ? safePublicValue(value) : "" }),
      ...(!secret && !privateRow && Boolean(absolutePathValue(value)) ? { masked: true } : {}),
      private: privateRow,
      configured: privateRow || Boolean(value),
      ...(secret && !privateRow ? { inline: true } : {}),
    };
  });
}

export async function readMcpSettings(options = {}) {
  const state = await loadState(options);
  const byName = new Map();
  for (const source of state.sources) {
    for (const [name, raw] of Object.entries(source.servers)) {
      if (!isRecord(raw)) {
        state.diagnostics.push({ source: source.source, server: name, message: "Server config must be an object" });
        continue;
      }
      const rows = privateRows(state.auth, source.source.id, name);
      const definition = {
        name,
        source: source.source,
        config: publicConfig(raw, rows),
        credentialCount: rows.length,
      };
      const definitions = byName.get(name) ?? [];
      definitions.push(definition);
      byName.set(name, definitions);
    }
  }
  const servers = [...byName.entries()].map(([name, definitions]) => {
    const effective = definitions.at(-1);
    const managed = definitions.some((definition) => definition.config.managed);
    return {
      ...effective,
      config: { ...effective.config, managed },
      definitions: definitions.map((definition, index) => ({ ...definition, effective: index === definitions.length - 1 })),
      duplicate: definitions.length > 1,
      shadowedCount: definitions.length - 1,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return { servers, diagnostics: state.diagnostics, sourceCount: state.sources.length };
}

function validateRawConfig(config, credentials = []) {
  if (!isRecord(config)) throw invalid("Server configuration is required");
  if (config.piWorkbenchManaged !== undefined) throw invalid("Installer-managed state cannot be changed through MCP settings");
  const allowedCommon = new Set(["transport", "type", "disabled", "enabled", "command", "args", "environment", "env", "cwd", "url", "headers"]);
  if (Object.keys(config).some((key) => !allowedCommon.has(key))) throw invalid("Server configuration contains unsupported fields");
  if (config.disabled !== undefined && config.enabled !== undefined) throw invalid("Use either enabled or disabled, not both");
  if (config.disabled !== undefined && typeof config.disabled !== "boolean") throw invalid("disabled must be a boolean");
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw invalid("enabled must be a boolean");
  const transport = transportOf(config);
  if (transport === "invalid") throw invalid("Use stdio/local or streamable-http/remote transport");
  if (credentials.some((row) => row.location !== (transport === "stdio" ? "env" : "headers"))) {
    throw invalid(`${transport === "stdio" ? "Stdio" : "HTTP"} servers contain credentials for the wrong transport`);
  }
  if (transport === "stdio") validateStdio(config);
  else validateHttp(config, credentials);
  return transport;
}

function validateUpdatedConfig(config, existing, credentials) {
  const candidate = structuredClone(config);
  for (const [field, pattern] of [["env", CREDENTIAL_ENV], ["environment", CREDENTIAL_ENV], ["headers", CREDENTIAL_HEADER]]) {
    if (!isRecord(candidate[field]) || !isRecord(existing[field])) continue;
    for (const [key, value] of Object.entries(candidate[field])) {
      if (pattern.test(key) && existing[field][key] === value) candidate[field][key] = "";
    }
  }
  return validateRawConfig(candidate, credentials);
}

function validateStdio(config) {
  if (config.url !== undefined || config.headers !== undefined) throw invalid("Stdio servers cannot define url or headers");
  if (config.env !== undefined && config.environment !== undefined) throw invalid("Use either env or environment, not both");
  let command;
  if (Array.isArray(config.command)) {
    if (config.args !== undefined || !config.command.length || !config.command.every((entry) => typeof entry === "string" && entry.trim() && !/[\u0000]/.test(entry))) throw invalid("command must be a non-empty string array and cannot be combined with args");
    command = config.command[0];
  } else {
    command = cleanString(config.command, "command");
    if (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every((entry) => typeof entry === "string" && entry.length <= MAX_TEXT && !/[\u0000]/.test(entry)))) throw invalid("args must be an array of strings");
  }
  if (/[\r\n\u0000]/.test(command)) throw invalid("command is invalid");
  const commandParts = Array.isArray(config.command) ? config.command : [config.command, ...(config.args ?? [])];
  if (commandParts.some((entry, index) => containsSensitiveAssignment(entry)
    || (sensitiveArgumentName(entry) && Boolean(commandParts[index + 1])))) {
    throw invalid("Credential-like command arguments are not supported; use private environment credentials");
  }
  if (config.cwd !== undefined) cleanString(config.cwd, "cwd", { max: 4096 });
  validateStringRecord(config.env ?? config.environment, "env", CREDENTIAL_ENV);
}

function validateHttp(config, credentials) {
  if (["command", "args", "env", "environment", "cwd"].some((field) => config[field] !== undefined)) throw invalid("HTTP servers cannot define stdio fields");
  const text = cleanString(config.url, "url", { max: 4096 });
  let url;
  try { url = new URL(text); } catch { throw invalid("url must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw invalid("url must be HTTP(S) and must not include credentials");
  if ([...url.searchParams.keys()].some((key) => CREDENTIAL_HEADER.test(key))) throw invalid("Credential-like URL parameters are not supported; use private headers");
  validateStringRecord(config.headers, "headers", CREDENTIAL_HEADER);
  const hasCredential = Object.keys(config.headers ?? {}).some((key) => CREDENTIAL_HEADER.test(key))
    || credentials.some((row) => row.location === "headers" && row.action !== "delete");
  if (url.protocol === "http:" && hasCredential && !isLoopback(url.hostname)) throw invalid("Credential headers require HTTPS unless the MCP server is loopback-only");
}

function validateStringRecord(value, label, secretPattern) {
  if (value === undefined) return;
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  for (const [key, raw] of Object.entries(value)) {
    cleanFieldName(key, `${label} key`);
    if (typeof raw !== "string" || raw.length > MAX_TEXT || /\u0000/.test(raw)) throw invalid(`${label}.${key} must be a string`);
    if (secretPattern.test(key) && raw) throw invalid(`${label}.${key} is credential-like and must be stored through private credentials`);
  }
}

function isLoopback(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const parts = host.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function normalizeCredentials(rows = []) {
  if (!Array.isArray(rows) || rows.length > 100) throw invalid("credentials must be an array");
  const normalized = rows.map((row) => {
    if (!isRecord(row) || (row.location !== "env" && row.location !== "headers")) throw invalid("Credential location is invalid");
    const key = cleanFieldName(row.key, "Credential key");
    const action = row.action ?? "preserve";
    if (!["preserve", "replace", "delete"].includes(action)) throw invalid("Credential action is invalid");
    if (action === "replace") {
      const value = cleanString(row.value, "Credential value", { max: MAX_TEXT });
      return { location: row.location, key, action, value };
    }
    if (row.value !== undefined) throw invalid("Credential values are accepted only for replace actions");
    return { location: row.location, key, action };
  });
  if (new Set(normalized.map((row) => credentialRowId(row.location, row.key))).size !== normalized.length) throw invalid("Credential keys must be unique");
  return normalized;
}

function sourceForMutation(state, request, name) {
  if (request.sourceId) {
    const source = state.sources.find((candidate) => candidate.source.id === request.sourceId);
    if (!source) throw invalid("Configuration source was not found", "MCP_SOURCE_NOT_FOUND");
    return source;
  }
  const effective = state.sources.filter((source) => Object.hasOwn(source.servers, name)).at(-1);
  if (effective) return effective;
  const target = request.target ?? (state.paths.includeProject ? "project" : "global");
  if (!new Set(["project", "global"]).has(target)) throw invalid("target must be project or global");
  const filePath = target === "project" ? path.join(state.paths.cwd, ".pi", "mcp.json") : path.join(state.paths.agentDirectory, "mcp.json");
  const existing = state.sources.find((source) => source.filePath === filePath);
  return existing ?? {
    filePath,
    text: "{\n  \"mcp\": {}\n}\n",
    document: { mcp: {} },
    containerKey: "mcp",
    servers: {},
    source: safeSource(filePath, state.paths.configPaths.indexOf(filePath), state.paths),
    newFile: true,
  };
}

function normalizeRequest(request) {
  if (!isRecord(request)) throw invalid("MCP mutation request is invalid");
  const action = request.action;
  const fields = {
    add: ["action", "name", "sourceId", "target", "config", "credentials"],
    update: ["action", "name", "sourceId", "newName", "config", "credentials", "clearFields", "clearValues"],
    rename: ["action", "name", "sourceId", "newName"],
    remove: ["action", "name", "sourceId", "deleteCredentials"],
    toggle: ["action", "name", "sourceId", "enabled"],
    "migrate-inline-secrets": ["action", "name", "sourceId", "keys"],
  };
  if (!Object.hasOwn(fields, action)) throw invalid("MCP mutation action is invalid");
  if (Object.keys(request).some((key) => !fields[action].includes(key))) throw invalid("MCP mutation request contains unsupported fields");
  if (request.sourceId !== undefined && !/^[A-Za-z0-9_-]{20,128}$/.test(request.sourceId)) throw invalid("Configuration source ID is invalid");
  if (request.clearFields !== undefined) {
    const allowed = new Set(["command", "args", "environment", "env", "cwd", "url", "headers"]);
    if (!Array.isArray(request.clearFields) || request.clearFields.some((field) => !allowed.has(field))) throw invalid("clearFields is invalid");
  }
  if (request.clearValues !== undefined) {
    if (!Array.isArray(request.clearValues) || request.clearValues.some((row) => !isRecord(row)
      || !["env", "headers"].includes(row.location) || !FIELD_NAME.test(row.key))) throw invalid("clearValues is invalid");
  }
  return { ...request, action, name: cleanName(request.name) };
}

function updateAuth(auth, source, server, credentials) {
  for (const credential of credentials) {
    if (credential.action === "preserve") continue;
    for (const [id, row] of Object.entries(auth.credentials)) {
      if (row.source === source && row.server === server
        && credentialRowId(row.location, row.key) === credentialRowId(credential.location, credential.key)) {
        delete auth.credentials[id];
      }
    }
    if (credential.action === "replace") {
      const id = credentialId(source, server, credential.location, credential.key);
      auth.credentials[id] = { source, server, location: credential.location, key: credential.key, value: credential.value };
    }
  }
}

function transferAuth(auth, source, oldName, newName) {
  for (const [id, row] of Object.entries(auth.credentials)) {
    if (row.source !== source || row.server !== oldName) continue;
    delete auth.credentials[id];
    const next = { ...row, server: newName };
    auth.credentials[credentialId(source, newName, row.location, row.key)] = next;
  }
}

function deleteAuth(auth, source, server) {
  for (const [id, row] of Object.entries(auth.credentials)) if (row.source === source && row.server === server) delete auth.credentials[id];
}

function replaceKnownConfig(source, serverName, config) {
  const knownFields = ["transport", "type", "disabled", "enabled", "command", "args", "environment", "env", "cwd", "url", "headers"];
  let next = source.text;
  for (const field of knownFields) {
    const nextValue = Object.hasOwn(config, field) ? config[field] : undefined;
    if (nextValue === undefined && !Object.hasOwn(source.servers[serverName], field)) continue;
    next = applyEdits(next, modify(next, [source.containerKey, serverName, field], nextValue, { formattingOptions: FORMATTING }));
  }
  return next;
}

function renameConfigKey(source, oldName, newName) {
  const root = parseTree(source.text, [], { allowTrailingComma: true });
  const serverNode = findNodeAtLocation(root, [source.containerKey, oldName]);
  const keyNode = serverNode?.parent?.children?.[0];
  if (!keyNode || keyNode.type !== "string") throw invalid("Server key could not be located", "MCP_SERVER_NOT_FOUND");
  return `${source.text.slice(0, keyNode.offset)}${JSON.stringify(newName)}${source.text.slice(keyNode.offset + keyNode.length)}`;
}

function configEdit(source, request, auth) {
  const pathPrefix = [source.containerKey];
  const existing = source.servers[request.name];
  if (["update", "rename", "remove", "toggle", "migrate-inline-secrets"].includes(request.action) && !isRecord(existing)) {
    throw invalid("Server is not configured in the selected source", "MCP_SERVER_NOT_FOUND");
  }
  const managed = existing?.piWorkbenchManaged === true;
  if (managed && request.action !== "toggle") throw invalid("Installer-managed servers may only be enabled or disabled", "MCP_MANAGED_SERVER");
  if (request.action === "add") {
    if (existing !== undefined) throw invalid("Server already exists in the selected source", "MCP_SERVER_EXISTS");
    const credentials = normalizeCredentials(request.credentials);
    updateAuth(auth, source.source.id, request.name, credentials);
    const storedCredentials = privateRows(auth, source.source.id, request.name).map((row) => ({ ...row, action: "preserve" }));
    validateRawConfig(request.config, storedCredentials);
    return applyEdits(source.text, modify(source.text, [...pathPrefix, request.name], request.config, { formattingOptions: FORMATTING }));
  }
  if (request.action === "update") {
    const credentials = normalizeCredentials(request.credentials);
    updateAuth(auth, source.source.id, request.name, credentials);
    const storedCredentials = privateRows(auth, source.source.id, request.name).map((row) => ({ ...row, action: "preserve" }));
    const knownFields = ["transport", "type", "disabled", "enabled", "command", "args", "environment", "env", "cwd", "url", "headers"];
    const merged = Object.fromEntries(knownFields.filter((field) => Object.hasOwn(existing, field)).map((field) => [field, existing[field]]));
    for (const field of request.clearFields ?? []) delete merged[field];
    const nextConfig = { ...request.config };
    const replacementRows = new Set();
    for (const location of ["env", "headers"]) {
      const values = location === "env" ? request.config.env ?? request.config.environment : request.config.headers;
      if (isRecord(values)) for (const key of Object.keys(values)) replacementRows.add(credentialRowId(location, key));
    }
    if (Object.hasOwn(existing, "enabled") && !Object.hasOwn(existing, "disabled")
      && Object.hasOwn(nextConfig, "disabled") && !Object.hasOwn(nextConfig, "enabled")) {
      nextConfig.enabled = !nextConfig.disabled;
      delete nextConfig.disabled;
    }
    for (const location of ["env", "headers"]) {
      const field = location === "env" && nextConfig.env === undefined && isRecord(nextConfig.environment) ? "environment" : location;
      if (!isRecord(nextConfig[field])) continue;
      const existingField = location === "env" && merged.env === undefined && isRecord(merged.environment) ? "environment" : location;
      const existingValues = isRecord(merged[existingField]) ? { ...merged[existingField] } : {};
      for (const key of Object.keys(nextConfig[field])) {
        const storedKey = Object.keys(existingValues).find((candidate) => credentialRowId(location, candidate) === credentialRowId(location, key));
        if (storedKey) delete existingValues[storedKey];
      }
      nextConfig[field] = { ...existingValues, ...nextConfig[field] };
    }
    Object.assign(merged, nextConfig);
    for (const row of request.clearValues ?? []) {
      if (replacementRows.has(credentialRowId(row.location, row.key))) continue;
      const location = row.location === "env" && merged.env === undefined && isRecord(merged.environment) ? "environment" : row.location;
      if (!isRecord(merged[location])) continue;
      const storedKey = Object.keys(merged[location]).find((key) => credentialRowId(row.location, key) === credentialRowId(row.location, row.key));
      if (storedKey) delete merged[location][storedKey];
    }
    validateUpdatedConfig(merged, existing, storedCredentials);
    const updated = replaceKnownConfig(source, request.name, merged);
    if (request.newName === undefined || request.newName === request.name) return updated;
    const newName = cleanName(request.newName, "New server name");
    if (Object.hasOwn(source.servers, newName)) throw invalid("New server name already exists in the selected source", "MCP_SERVER_EXISTS");
    transferAuth(auth, source.source.id, request.name, newName);
    return renameConfigKey({ ...source, text: updated }, request.name, newName);
  }
  if (request.action === "rename") {
    const newName = cleanName(request.newName, "New server name");
    if (Object.hasOwn(source.servers, newName)) throw invalid("New server name already exists in the selected source", "MCP_SERVER_EXISTS");
    transferAuth(auth, source.source.id, request.name, newName);
    return renameConfigKey(source, request.name, newName);
  }
  if (request.action === "remove") {
    if (typeof request.deleteCredentials !== "boolean") throw invalid("deleteCredentials must be a boolean");
    if (request.deleteCredentials) deleteAuth(auth, source.source.id, request.name);
    return applyEdits(source.text, modify(source.text, [...pathPrefix, request.name], undefined, { formattingOptions: FORMATTING }));
  }
  if (request.action === "toggle") {
    if (typeof request.enabled !== "boolean") throw invalid("enabled must be a boolean");
    let next = source.text;
    if (Object.hasOwn(existing, "enabled") && !Object.hasOwn(existing, "disabled")) {
      next = applyEdits(next, modify(next, [...pathPrefix, request.name, "enabled"], request.enabled, { formattingOptions: FORMATTING }));
    } else {
      next = applyEdits(next, modify(next, [...pathPrefix, request.name, "disabled"], !request.enabled, { formattingOptions: FORMATTING }));
    }
    return next;
  }
  const keys = Array.isArray(request.keys) ? request.keys : [];
  if (!keys.length) throw invalid("Explicit inline credential keys are required for migration");
  let next = source.text;
  for (const candidate of keys) {
    if (!isRecord(candidate) || (candidate.location !== "env" && candidate.location !== "headers")) throw invalid("Inline credential migration key is invalid");
    const key = cleanFieldName(candidate.key, "Inline credential key");
    const field = candidate.location === "env" && existing.env === undefined ? "environment" : candidate.location;
    const record = existing[field];
    if (!isRecord(record) || typeof record[key] !== "string" || !record[key]) throw invalid(`Inline credential ${candidate.location}.${key} was not found`);
    updateAuth(auth, source.source.id, request.name, [{ location: candidate.location, key, action: "replace", value: record[key] }]);
    next = applyEdits(next, modify(next, [...pathPrefix, request.name, field, key], undefined, { formattingOptions: FORMATTING }));
  }
  return next;
}

async function ensureFile(filePath, contents, mode) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let created = false;
  try {
    await writeFile(filePath, contents, { encoding: "utf8", flag: "wx", mode });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (mode === 0o600) await chmod(filePath, 0o600).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
  return created;
}

async function atomicWrite(filePath, contents, mode) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode, flag: "wx" });
    await rename(temporary, filePath);
    if (mode === 0o600) await chmod(filePath, mode).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

async function fileMode(filePath, fallback) {
  try { return (await stat(filePath)).mode & 0o777; } catch { return fallback; }
}

const EMPTY_AUTH = "{\n  \"version\": 1,\n  \"credentials\": {}\n}\n";
const EMPTY_CONFIG = "{\n  \"mcp\": {}\n}\n";

async function removeCreatedFile(filePath, expected) {
  try { if (await readFile(filePath, "utf8") === expected) await rm(filePath, { force: true }); } catch { /* best effort */ }
}

async function withLocks(configPath, authPath, mutationLockPath, operation) {
  await ensureFile(mutationLockPath, "Pi Workbench MCP mutation lock\n", 0o600);
  const releaseGlobal = await lockfile.lock(mutationLockPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
  let authCreated = false;
  let configCreated = false;
  let releaseAuth;
  let releaseConfig;
  let completed = false;
  try {
    authCreated = await ensureFile(authPath, EMPTY_AUTH, 0o600);
    configCreated = await ensureFile(configPath, EMPTY_CONFIG, 0o600);
    releaseAuth = await lockfile.lock(authPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
    releaseConfig = await lockfile.lock(configPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
    const result = await operation({ configCreated, authCreated });
    completed = true;
    return result;
  } finally {
    await releaseConfig?.().catch(() => {});
    await releaseAuth?.().catch(() => {});
    if (!completed) {
      if (configCreated) await removeCreatedFile(configPath, EMPTY_CONFIG);
      if (authCreated) await removeCreatedFile(authPath, EMPTY_AUTH);
    }
    await releaseGlobal().catch(() => {});
  }
}

async function restoreTransaction(record) {
  return withLocks(record.configPath, record.authPath, record.mutationLockPath, async () => {
    const currentConfig = await readFile(record.configPath, "utf8");
    const currentAuth = await readFile(record.authPath, "utf8");
    if (currentConfig !== record.nextConfig || currentAuth !== record.nextAuth) throw invalid("MCP settings changed after this transaction; rollback refused", "MCP_ROLLBACK_CONFLICT");
    try {
      if (record.configExisted) await atomicWrite(record.configPath, record.previousConfig, record.configMode);
      else await rm(record.configPath, { force: true });
      if (record.authExisted) await atomicWrite(record.authPath, record.previousAuth, 0o600);
      else await rm(record.authPath, { force: true });
    } catch (error) {
      const recoveryFailures = [];
      await atomicWrite(record.configPath, record.nextConfig, record.configMode).catch((recoveryError) => recoveryFailures.push(recoveryError));
      await atomicWrite(record.authPath, record.nextAuth, 0o600).catch((recoveryError) => recoveryFailures.push(recoveryError));
      if (recoveryFailures.length) throw new AggregateError([error, ...recoveryFailures], "MCP rollback and recovery both failed");
      throw error;
    }
  });
}

export async function mutateMcpSettings(options, rawRequest) {
  const request = normalizeRequest(rawRequest);
  const initial = await loadState(options);
  const configuredSources = initial.sources.filter((candidate) => Object.hasOwn(candidate.servers, request.name));
  const effectiveSource = configuredSources.at(-1);
  const managedName = configuredSources.some((candidate) => candidate.servers[request.name]?.piWorkbenchManaged === true);
  if (managedName && request.action !== "toggle") {
    throw invalid("Installer-managed servers may only be enabled or disabled", "MCP_MANAGED_SERVER");
  }
  if (request.action !== "add" && request.sourceId && effectiveSource?.source.id !== request.sourceId) {
    throw invalid("Only the effective server definition can be changed", "MCP_SOURCE_SHADOWED");
  }
  const source = sourceForMutation(initial, request, request.name);
  let rollbackUsed = false;
  let record;
  await withLocks(source.filePath, initial.paths.authPath, initial.paths.mutationLockPath, async ({ configCreated, authCreated }) => {
    const fresh = await loadState(options);
    const freshConfigured = fresh.sources.filter((candidate) => Object.hasOwn(candidate.servers, request.name));
    const freshEffective = freshConfigured.at(-1);
    if (request.action !== "add" && freshEffective?.source.id !== source.source.id) {
      throw invalid("Only the effective server definition can be changed", "MCP_SOURCE_SHADOWED");
    }
    if (freshConfigured.some((candidate) => candidate.servers[request.name]?.piWorkbenchManaged === true)
      && request.action !== "toggle") {
      throw invalid("Installer-managed servers may only be enabled or disabled", "MCP_MANAGED_SERVER");
    }
    const freshSource = sourceForMutation(fresh, { ...request, sourceId: source.source.id }, request.name);
    const currentConfig = await readExisting(source.filePath);
    const currentAuth = await readExisting(initial.paths.authPath);
    const nextAuthObject = structuredClone(fresh.auth);
    const nextConfig = configEdit({ ...freshSource, text: currentConfig.text }, request, nextAuthObject);
    const nextAuth = `${JSON.stringify(nextAuthObject, null, 2)}\n`;
    const configMode = await fileMode(source.filePath, 0o600);
    await atomicWrite(source.filePath, nextConfig, configMode);
    try {
      await atomicWrite(initial.paths.authPath, nextAuth, 0o600);
    } catch (error) {
      const rollbackFailures = [];
      try {
        if (currentConfig.exists) await atomicWrite(source.filePath, currentConfig.text, configMode);
        else await rm(source.filePath, { force: true });
      } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      try {
        if (currentAuth.exists) await atomicWrite(initial.paths.authPath, currentAuth.text, 0o600);
        else await rm(initial.paths.authPath, { force: true });
      } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      if (rollbackFailures.length) throw new AggregateError([error, ...rollbackFailures], "MCP settings write and rollback both failed");
      throw error;
    }
    record = {
      configPath: source.filePath, authPath: initial.paths.authPath, mutationLockPath: initial.paths.mutationLockPath,
      configExisted: !configCreated, authExisted: !authCreated,
      previousConfig: currentConfig.text, previousAuth: currentAuth.text,
      nextConfig, nextAuth, configMode,
    };
  });
  const snapshot = await readMcpSettings(options);
  const effective = snapshot.servers.find((server) => server.name === (request.newName ?? request.name));
  const revealed = request.action === "remove" ? snapshot.servers.find((server) => server.name === request.name) ?? null : null;
  return {
    action: request.action,
    server: request.action === "remove" ? null : effective ?? null,
    revealed,
    snapshot,
    async rollback() {
      if (rollbackUsed) throw invalid("MCP settings transaction was already rolled back", "MCP_ROLLBACK_USED");
      rollbackUsed = true;
      await restoreTransaction(record);
      return readMcpSettings(options);
    },
  };
}

export const addMcpServer = (options, request) => mutateMcpSettings(options, { ...request, action: "add" });
export const updateMcpServer = (options, request) => mutateMcpSettings(options, { ...request, action: "update" });
export const renameMcpServer = (options, request) => mutateMcpSettings(options, { ...request, action: "rename" });
export const removeMcpServer = (options, request) => mutateMcpSettings(options, { ...request, action: "remove" });
export const toggleMcpServer = (options, request) => mutateMcpSettings(options, { ...request, action: "toggle" });
export const migrateInlineMcpSecrets = (options, request) => mutateMcpSettings(options, { ...request, action: "migrate-inline-secrets" });

function hydratedConfig(source, name, raw, auth) {
  const config = structuredClone(raw);
  for (const row of privateRows(auth, source.source.id, name)) {
    const field = row.location === "env" && config.env === undefined && config.environment !== undefined ? "environment" : row.location;
    const values = isRecord(config[field]) ? { ...config[field] } : {};
    for (const key of Object.keys(values)) {
      if (credentialRowId(row.location, key) === credentialRowId(row.location, row.key)) delete values[key];
    }
    config[field] = { ...values, [row.key]: row.value };
  }
  validateRuntimeConfig(config);
  return config;
}

function validateRuntimeConfig(config) {
  const transport = transportOf(config);
  if (transport === "stdio") {
    const env = config.env ?? config.environment;
    const safe = { ...config, ...(env ? { env: Object.fromEntries(Object.keys(env).map((key) => [key, ""])) } : {}) };
    validateStdio(safe);
  } else if (transport === "streamable-http") {
    const headers = config.headers;
    const safe = { ...config, ...(headers ? { headers: Object.fromEntries(Object.keys(headers).map((key) => [key, ""])) } : {}) };
    validateHttp(safe, Object.keys(headers ?? {}).map((key) => ({ location: "headers", key, action: "preserve" })));
  } else throw invalid("Server transport is invalid");
}

function runtimeSecretValues(config, privateValues) {
  const secrets = [...privateValues];
  for (const [key, value] of Object.entries(config.env ?? config.environment ?? {})) if (CREDENTIAL_ENV.test(key)) secrets.push(value);
  for (const [key, value] of Object.entries(config.headers ?? {})) if (CREDENTIAL_HEADER.test(key)) secrets.push(value);
  if (typeof config.url === "string") {
    try {
      const url = new URL(config.url);
      secrets.push(...url.searchParams.values());
    } catch { /* Runtime validation reports the invalid URL without connecting. */ }
  }
  return secrets.filter((value) => typeof value === "string");
}

function runtimePrivatePaths(state, source, config) {
  const candidates = [state.paths.cwd, state.paths.homeDirectory, state.paths.agentDirectory, source.filePath, config.cwd];
  if (Array.isArray(config.command)) candidates.push(...config.command);
  else candidates.push(config.command, ...(config.args ?? []));
  return candidates
    .map(absolutePathValue)
    .filter(Boolean)
    .flatMap((candidate) => [candidate, candidate.replaceAll("\\", "/")]);
}

function redactedConnectionError(error, values) {
  const variants = new Set();
  for (const value of values) {
    for (const candidate of [value, value.replace(/^\S+\s+/, "")]) {
      if (!candidate) continue;
      variants.add(candidate);
      const encoded = encodeURIComponent(candidate);
      variants.add(encoded);
      variants.add(encoded.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toLowerCase()));
      variants.add(encoded.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase()));
      variants.add(encoded.replaceAll("%20", "+"));
    }
  }
  if ([...variants].some((value) => value.length < 4)) return "MCP connection failed";
  let message = error instanceof Error ? error.message : "MCP connection failed";
  for (const value of [...variants].sort((left, right) => right.length - left.length)) {
    message = message.split(value).join("[REDACTED]");
  }
  return message.slice(0, 1000);
}

async function closeClientWithin(client, timeoutMs = 1_000) {
  if (!client) return;
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); });
  await Promise.race([client.close().catch(() => {}), deadline]);
  clearTimeout(timer);
}

export async function testMcpServerConnection(options, request = {}) {
  const name = cleanName(request.name);
  const timeoutMs = Number(request.timeoutMs ?? 8_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw invalid("Connection timeout must be between 250 and 30000 milliseconds");
  const state = await loadState(options);
  const source = request.sourceId
    ? state.sources.find((candidate) => candidate.source.id === request.sourceId)
    : state.sources.filter((candidate) => Object.hasOwn(candidate.servers, name)).at(-1);
  if (!source || !isRecord(source.servers[name])) throw invalid("Server was not found", "MCP_SERVER_NOT_FOUND");
  const config = hydratedConfig(source, name, source.servers[name], state.auth);
  const rows = privateRows(state.auth, source.source.id, name);
  const secretValues = [
    ...runtimeSecretValues(config, rows.map((row) => row.value)),
    ...runtimePrivatePaths(state, source, config),
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let client;
  try {
    client = new Client({ name: "pi-harness-mcp-settings-test", version: "1.0.0" }, { capabilities: {} });
    let transport;
    if (transportOf(config) === "streamable-http") {
      transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: config.headers ? { headers: config.headers } : undefined });
    } else {
      const parts = Array.isArray(config.command) ? config.command : [config.command, ...(config.args ?? [])];
      transport = new StdioClientTransport({ command: parts[0], args: parts.slice(1), env: { ...getDefaultEnvironment(), ...(config.env ?? config.environment) }, cwd: config.cwd ? path.resolve(source.filePath, "..", config.cwd) : state.paths.cwd, stderr: "pipe" });
    }
    await client.connect(transport, { signal: controller.signal });
    const tools = await client.listTools(undefined, { signal: controller.signal });
    return { ok: true, kind: "live", server: name, transport: transportOf(config), toolCount: tools.tools.length };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, kind: "live", server: name, error: "MCP connection test timed out" };
    return { ok: false, kind: "live", server: name, error: redactedConnectionError(error, secretValues) };
  } finally {
    clearTimeout(timer);
    await closeClientWithin(client);
  }
}

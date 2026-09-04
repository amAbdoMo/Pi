import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";

export const PROVIDER_APIS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_MODELS = 50;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "INVALID_PROVIDER";
  return error;
}

function parseObject(text, label, { jsonc = false } = {}) {
  let value;
  if (jsonc) {
    const errors = [];
    value = parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) throw invalid(`${label} is invalid: ${printParseErrorCode(errors[0].error)}`);
  } else {
    try { value = JSON.parse(text); }
    catch { throw invalid(`${label} is invalid JSON`); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${label} must contain an object`);
  return value;
}

function cleanText(value, label, { required = true, max = 200 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw invalid(`${label} is invalid`);
  return text;
}

function normalizeUrl(value) {
  const text = cleanText(value, "Base URL", { max: 2048 });
  let url;
  try { url = new URL(text); } catch { throw invalid("Base URL must be a valid HTTP or HTTPS URL"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw invalid("Base URL must be an HTTP or HTTPS URL without credentials, query parameters, or fragments");
  }
  return text.replace(/\/$/, "");
}

function publicBaseUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}

function normalizeModel(model, index) {
  if (!model || typeof model !== "object" || Array.isArray(model)) throw invalid(`Model ${index + 1} is invalid`);
  const allowed = new Set(["id", "name", "reasoning", "input", "contextWindow", "maxTokens"]);
  if (Object.keys(model).some((key) => !allowed.has(key))) throw invalid(`Model ${index + 1} contains unsupported fields`);
  const id = cleanText(model.id, `Model ${index + 1} ID`);
  const name = model.name === undefined || model.name === "" ? undefined : cleanText(model.name, `Model ${index + 1} name`, { max: 120 });
  if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") throw invalid(`Model ${index + 1} reasoning setting is invalid`);
  const input = model.input ?? ["text"];
  if (!Array.isArray(input) || input.length < 1 || input.length > 2 || input[0] !== "text"
    || input.some((type) => type !== "text" && type !== "image") || new Set(input).size !== input.length) {
    throw invalid(`Model ${index + 1} input types are invalid`);
  }
  const normalized = { id, ...(name ? { name } : {}), reasoning: model.reasoning === true, input };
  for (const field of ["contextWindow", "maxTokens"]) {
    if (model[field] === undefined || model[field] === "") continue;
    const number = Number(model[field]);
    if (!Number.isSafeInteger(number) || number < 1 || number > 10_000_000) throw invalid(`Model ${index + 1} ${field} is invalid`);
    normalized[field] = number;
  }
  if (normalized.contextWindow && normalized.maxTokens && normalized.maxTokens > normalized.contextWindow) {
    throw invalid(`Model ${index + 1} max tokens cannot exceed its context window`);
  }
  return normalized;
}

export function normalizeProviderRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("Provider request is invalid");
  const allowed = new Set(["provider", "credentialAction", "apiKey"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw invalid("Provider request contains unsupported fields");
  const provider = body.provider;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) throw invalid("Provider configuration is required");
  const providerAllowed = new Set(["id", "baseUrl", "api", "models"]);
  if (Object.keys(provider).some((key) => !providerAllowed.has(key))) throw invalid("Provider configuration contains unsupported fields");
  const id = cleanText(provider.id, "Provider ID", { max: 64 }).toLowerCase();
  if (!PROVIDER_ID.test(id)) throw invalid("Provider ID must use lowercase letters, numbers, dots, dashes, or underscores");
  if (!PROVIDER_APIS.includes(provider.api)) throw invalid("Provider API is not supported");
  if (!Array.isArray(provider.models) || provider.models.length < 1 || provider.models.length > MAX_MODELS) {
    throw invalid(`Add between 1 and ${MAX_MODELS} models`);
  }
  const models = provider.models.map(normalizeModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) throw invalid("Model IDs must be unique within a provider");
  const credentialAction = body.credentialAction ?? "preserve";
  if (!new Set(["preserve", "replace", "delete"]).has(credentialAction)) throw invalid("Credential action is invalid");
  const apiKey = credentialAction === "replace" ? cleanText(body.apiKey, "API key", { max: 16 * 1024 }) : undefined;
  if (apiKey && (apiKey.startsWith("!") || apiKey.includes("$"))) {
    throw invalid("API key cannot contain command or environment interpolation syntax");
  }
  if (credentialAction !== "replace" && body.apiKey !== undefined) throw invalid("API key is only accepted when replacing a credential");
  return {
    provider: { id, baseUrl: normalizeUrl(provider.baseUrl), api: provider.api, models },
    credentialAction,
    apiKey,
  };
}

export function normalizeProviderRemoval(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => !new Set(["providerId", "deleteCredential"]).has(key))) {
    throw invalid("Provider removal request is invalid");
  }
  const providerId = cleanText(body.providerId, "Provider ID", { max: 64 }).toLowerCase();
  if (!PROVIDER_ID.test(providerId) || typeof body.deleteCredential !== "boolean") throw invalid("Provider removal request is invalid");
  return { providerId, deleteCredential: body.deleteCredential };
}

function publicModel(model) {
  if (!model || typeof model !== "object" || Array.isArray(model) || typeof model.id !== "string") return null;
  return {
    id: model.id,
    ...(typeof model.name === "string" ? { name: model.name } : {}),
    reasoning: model.reasoning === true,
    input: Array.isArray(model.input) && model.input.includes("image") ? ["text", "image"] : ["text"],
    ...(Number.isSafeInteger(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
    ...(Number.isSafeInteger(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
  };
}

export function providerSnapshot(modelsText = "{}", authText = "{}") {
  const modelsRoot = parseObject(modelsText, "models.json", { jsonc: true });
  const authRoot = parseObject(authText, "auth.json");
  const providers = modelsRoot.providers;
  if (providers !== undefined && (!providers || typeof providers !== "object" || Array.isArray(providers))) {
    throw invalid("models.json providers must be an object");
  }
  return Object.entries(providers ?? {}).map(([id, config]) => {
    const safeConfig = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    const models = Array.isArray(safeConfig.models) ? safeConfig.models.map(publicModel).filter(Boolean) : [];
    const storedCredential = authRoot[id];
    return {
      id,
      baseUrl: publicBaseUrl(safeConfig.baseUrl),
      api: PROVIDER_APIS.includes(safeConfig.api) ? safeConfig.api : "",
      models,
      editable: Boolean(safeConfig.baseUrl && PROVIDER_APIS.includes(safeConfig.api) && models.length > 0),
      credentialConfigured: Boolean(storedCredential || safeConfig.apiKey),
      credentialType: storedCredential?.type === "oauth" ? "oauth" : storedCredential?.type === "api_key" ? "api_key" : safeConfig.apiKey ? "models_config" : null,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function ensureJsonFile(filePath, initial, mode) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try { await readFile(filePath, "utf8"); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(filePath, initial, { encoding: "utf8", mode, flag: "wx" }).catch((writeError) => {
      if (writeError?.code !== "EEXIST") throw writeError;
    });
  }
  if (mode === 0o600) await chmod(filePath, mode).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
}

async function atomicWritePrivate(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function writeProviderFiles(modelsPath, authPath, currentModels, nextModels, currentAuth, nextAuth) {
  await atomicWritePrivate(modelsPath, nextModels);
  try {
    if (nextAuth !== undefined) await atomicWritePrivate(authPath, nextAuth);
  } catch (error) {
    await atomicWritePrivate(modelsPath, currentModels).catch(() => {});
    await atomicWritePrivate(authPath, currentAuth).catch(() => {});
    throw error;
  }
}

async function withProviderFiles(modelsPath, authPath, operation) {
  await ensureJsonFile(modelsPath, "{\n  \"providers\": {}\n}\n", 0o600);
  await ensureJsonFile(authPath, "{}\n", 0o600);
  const releaseModels = await lockfile.lock(modelsPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
  let releaseAuth;
  try {
    releaseAuth = await lockfile.lock(authPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
    return await operation();
  } finally {
    await releaseAuth?.().catch(() => {});
    await releaseModels().catch(() => {});
  }
}

export async function readProviderSettings(modelsPath, authPath) {
  try {
    return await withProviderFiles(modelsPath, authPath, async () => providerSnapshot(
      await readFile(modelsPath, "utf8"),
      await readFile(authPath, "utf8"),
    ));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new Error("Provider settings could not be read", { cause: error });
  }
}

export async function writeProviderSettings(modelsPath, authPath, request) {
  const normalized = normalizeProviderRequest(request);
  return withProviderFiles(modelsPath, authPath, async () => {
    const modelsText = await readFile(modelsPath, "utf8");
    const authText = await readFile(authPath, "utf8");
    const modelsRoot = parseObject(modelsText, "models.json", { jsonc: true });
    if (modelsRoot.providers !== undefined && (!modelsRoot.providers || typeof modelsRoot.providers !== "object" || Array.isArray(modelsRoot.providers))) {
      throw invalid("models.json providers must be an object");
    }
    const existingProvider = modelsRoot.providers?.[normalized.provider.id];
    const existingConfig = existingProvider && typeof existingProvider === "object" && !Array.isArray(existingProvider) ? existingProvider : {};
    const existingModels = Array.isArray(existingConfig.models) ? existingConfig.models : [];
    const mergedModels = normalized.provider.models.map((model) => {
      const existingModel = existingModels.find((candidate) => candidate?.id === model.id);
      return existingModel && typeof existingModel === "object" && !Array.isArray(existingModel)
        ? { ...existingModel, ...model }
        : model;
    });
    const edits = modify(modelsText, ["providers", normalized.provider.id], {
      ...existingConfig,
      baseUrl: normalized.provider.baseUrl,
      api: normalized.provider.api,
      models: mergedModels,
    }, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } });
    const nextModels = `${applyEdits(modelsText, edits).trimEnd()}\n`;
    const authRoot = parseObject(authText, "auth.json");
    if (normalized.credentialAction === "replace") authRoot[normalized.provider.id] = { type: "api_key", key: normalized.apiKey };
    if (normalized.credentialAction === "delete") delete authRoot[normalized.provider.id];
    const nextAuth = normalized.credentialAction === "preserve" ? undefined : `${JSON.stringify(authRoot, null, 2)}\n`;
    await writeProviderFiles(modelsPath, authPath, modelsText, nextModels, authText, nextAuth);
    return providerSnapshot(nextModels, nextAuth ?? authText);
  });
}

export async function removeProviderSettings(modelsPath, authPath, request) {
  const { providerId, deleteCredential } = normalizeProviderRemoval(request);
  return withProviderFiles(modelsPath, authPath, async () => {
    const modelsText = await readFile(modelsPath, "utf8");
    const modelsRoot = parseObject(modelsText, "models.json", { jsonc: true });
    if (!modelsRoot.providers || !Object.prototype.hasOwnProperty.call(modelsRoot.providers, providerId)) {
      const error = invalid("Provider is not configured in models.json");
      error.code = "PROVIDER_NOT_FOUND";
      throw error;
    }
    const removedConfig = modelsRoot.providers[providerId];
    const nextModels = `${applyEdits(modelsText, modify(modelsText, ["providers", providerId], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    })).trimEnd()}\n`;
    const authText = await readFile(authPath, "utf8");
    const authRoot = parseObject(authText, "auth.json");
    const hadStoredCredential = Object.prototype.hasOwnProperty.call(authRoot, providerId);
    if (deleteCredential) delete authRoot[providerId];
    else if (!hadStoredCredential && typeof removedConfig?.apiKey === "string") {
      authRoot[providerId] = { type: "api_key", key: removedConfig.apiKey };
    }
    const authChanged = (deleteCredential && hadStoredCredential) || (!hadStoredCredential && Boolean(authRoot[providerId]));
    const nextAuth = authChanged ? `${JSON.stringify(authRoot, null, 2)}\n` : undefined;
    await writeProviderFiles(modelsPath, authPath, modelsText, nextModels, authText, nextAuth);
    return providerSnapshot(nextModels, nextAuth ?? authText);
  });
}

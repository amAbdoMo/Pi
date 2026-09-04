import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function invalid(message) {
  const error = new TypeError(message);
  error.code = "INVALID_MODEL_DEFAULT";
  return error;
}

export function normalizeModelDefault(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Browser model default must be an object");
  const allowed = new Set(["provider", "modelId", "name", "thinkingLevel"]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || !["provider", "modelId", "thinkingLevel"].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    throw invalid("Browser model default has unsupported or missing fields");
  }
  const provider = typeof value.provider === "string" ? value.provider.trim().toLowerCase() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!PROVIDER_ID.test(provider)) throw invalid("Browser model provider is invalid");
  if (!modelId || modelId.length > 512 || /[\u0000-\u001f\u007f]/.test(modelId)) throw invalid("Browser model ID is invalid");
  if (!THINKING_LEVELS.has(value.thinkingLevel)) throw invalid("Browser thinking level is invalid");
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid("Browser model name is invalid");
  return { provider, modelId, ...(name ? { name } : {}), thinkingLevel: value.thinkingLevel };
}

async function ensurePreferenceFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try { await readFile(filePath, "utf8"); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(filePath, "{}\n", { encoding: "utf8", mode: 0o600, flag: "wx" }).catch((writeError) => {
      if (writeError?.code !== "EEXIST") throw writeError;
    });
  }
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function readModelDefault(filePath) {
  let text;
  try { text = await readFile(filePath, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  let parsed;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw invalid("Browser model default is invalid JSON"); }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0) return null;
  return normalizeModelDefault(parsed);
}

export async function writeModelDefault(filePath, preference) {
  const normalized = normalizeModelDefault(preference);
  await ensurePreferenceFile(filePath);
  const release = await lockfile.lock(filePath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
  try { await atomicWrite(filePath, `${JSON.stringify(normalized, null, 2)}\n`); }
  finally { await release().catch(() => {}); }
  return normalized;
}

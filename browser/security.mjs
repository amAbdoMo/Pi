import { randomBytes, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_JSON_LIMIT = 64 * 1024;

export class SecurityError extends Error {
  constructor(message, statusCode = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "SecurityError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function hostNameFromHeader(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || /[\s\\/@]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isLoopbackHost(value) {
  return LOOPBACK_NAMES.has(hostNameFromHeader(value));
}

export function isLoopbackAddress(value) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function assertLoopbackRequest(request, { requireOrigin = false } = {}) {
  const host = request?.headers?.host;
  if (!isLoopbackHost(host)) throw new SecurityError("Loopback host required", 403, "FORBIDDEN_HOST");
  const remote = request?.socket?.remoteAddress;
  if (remote && !isLoopbackAddress(remote)) throw new SecurityError("Loopback client required", 403, "FORBIDDEN_CLIENT");
  const origin = request?.headers?.origin;
  if (requireOrigin && !origin) throw new SecurityError("Origin required", 403, "FORBIDDEN_ORIGIN");
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new SecurityError("Invalid origin", 403, "FORBIDDEN_ORIGIN"); }
    if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new SecurityError("Invalid origin", 403, "FORBIDDEN_ORIGIN");
    }
    if (!isLoopbackHost(parsed.host) || parsed.host.toLowerCase() !== String(host).toLowerCase()) {
      throw new SecurityError("Origin mismatch", 403, "FORBIDDEN_ORIGIN");
    }
  }
  return true;
}

export function createToken(bytes = 32) {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) throw new TypeError("Token size must be between 16 and 128 bytes");
  return randomBytes(bytes).toString("base64url");
}

export const createBootstrapToken = createToken;
export const createSessionToken = createToken;

export async function loadOrCreatePrivateToken(filePath, {
  bytes = 32,
  fs = { open, readFile, unlink },
} = {}) {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) throw new TypeError("Token file path is required");
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) throw new TypeError("Token size must be between 16 and 128 bytes");

  const readStored = async () => {
    const token = String(await fs.readFile(filePath, "utf8")).trim();
    const decoded = /^[A-Za-z0-9_-]+$/.test(token) ? Buffer.from(token, "base64url") : Buffer.alloc(0);
    if (decoded.length !== bytes || decoded.toString("base64url") !== token) throw new Error("Stored browser token is invalid");
    return token;
  };

  try {
    return await readStored();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const token = createToken(bytes);
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return readStored();
    throw error;
  }
  try {
    await handle.writeFile(token, "utf8");
    await handle.sync?.();
  } catch (error) {
    await fs.unlink(filePath).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
  return token;
}

export function tokensEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || left.length === 0) {
    const pad = Buffer.alloc(Math.max(left.length, right.length, 1));
    timingSafeEqual(pad, pad);
    return false;
  }
  return timingSafeEqual(left, right);
}

export const timingSafeTokenEqual = tokensEqual;

export function setSecurityHeaders(response, { cspNonce } = {}) {
  const scriptSource = cspNonce ? `'self' 'nonce-${cspNonce}'` : "'self'";
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Content-Security-Policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src ${scriptSource}; style-src 'self'; img-src 'self' data:; connect-src 'self'`,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  return headers;
}

export const applySecurityHeaders = setSecurityHeaders;

export async function readJsonBody(request, { maxBytes = DEFAULT_JSON_LIMIT, signal } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new TypeError("Invalid JSON body limit");
  const declared = Number(request?.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new SecurityError("Request body too large", 413, "BODY_TOO_LARGE");
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw new SecurityError("Request body too large", 413, "BODY_TOO_LARGE");
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    throw new SecurityError("Unable to read request body", 400, "INVALID_BODY");
  }
  if (size === 0) throw new SecurityError("JSON body required", 400, "INVALID_JSON");
  let value;
  try { value = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new SecurityError("Invalid JSON", 400, "INVALID_JSON"); }
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new SecurityError("JSON object required", 400, "INVALID_JSON");
  return value;
}

function isWithin(root, candidate, pathImpl = path) {
  const relative = pathImpl.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${pathImpl.sep}`) && relative !== ".." && !pathImpl.isAbsolute(relative));
}

export async function resolveStaticPath(root, urlPath, { fs = { realpath, lstat }, pathImpl = path } = {}) {
  if (typeof urlPath !== "string" || urlPath.length > 2048 || urlPath.includes("\0") || urlPath.includes("\\")) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname); } catch { return null; }
  if (pathname.split("/").includes("..")) return null;
  const rootReal = await fs.realpath(root);
  const candidate = pathImpl.resolve(rootReal, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!isWithin(rootReal, candidate, pathImpl)) return null;
  let candidateReal;
  try { candidateReal = await fs.realpath(candidate); } catch { return null; }
  if (!isWithin(rootReal, candidateReal, pathImpl)) return null;
  const info = await fs.lstat(candidateReal);
  return info.isFile() && !info.isSymbolicLink() ? candidateReal : null;
}

function pidIsAlive(pid, kill = process.kill) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

export async function acquireWriterLock(lockPath, {
  pid = process.pid,
  kill = process.kill,
  maxAttempts = 2,
  fs = { open, readFile, unlink },
} = {}) {
  const owner = createToken(18);
  const payload = JSON.stringify({ pid, owner });
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      try { await handle.writeFile(payload, "utf8"); await handle.sync?.(); } finally { await handle.close(); }
      let released = false;
      return {
        path: lockPath,
        pid,
        async release() {
          if (released) return;
          released = true;
          try {
            const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
            if (current.pid === pid && tokensEqual(current.owner, owner)) await fs.unlink(lockPath);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
        stale = !pidIsAlive(current.pid, kill);
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        stale = true;
      }
      if (!stale) throw new SecurityError("Session already has an active writer", 409, "WRITER_LOCKED");
      try { await fs.unlink(lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
    }
  }
  throw new SecurityError("Unable to acquire writer lock", 409, "WRITER_LOCKED");
}

export const createExclusiveWriterLock = acquireWriterLock;

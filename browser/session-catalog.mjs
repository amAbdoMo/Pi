import { createHash, createHmac } from "node:crypto";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULTS = Object.freeze({ maxDepth: 8, maxEntries: 2_000, maxFiles: 1_000, maxFileBytes: 16 * 1024 * 1024, maxScanBytes: 256 * 1024 });

function boundedText(value, max = 240) {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function safeCwdLabel(value) {
  if (typeof value !== "string" || !value) return undefined;
  const segments = value.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return undefined;
  const homeIndex = segments.findIndex((segment) => /^(?:users|home)$/i.test(segment));
  if (homeIndex >= 0 && segments.length === homeIndex + 2) return "Home";
  return boundedText(segments.at(-1), 100);
}

function within(root, candidate, pathImpl = path) {
  const relative = pathImpl.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(relative));
}

async function readPrefix(file, limit) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function parseMetadata(prefix, fallbackName, pathImpl = path) {
  let name;
  let cwd;
  let cwdScope;
  let sessionHeaderFound = false;
  for (const line of prefix.split("\n")) {
    if (!line || line.length > 128 * 1024) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.type === "session") {
      sessionHeaderFound = true;
      if (typeof entry.cwd === "string" && entry.cwd.length <= 4096) cwdScope ??= entry.cwd;
      cwd ??= safeCwdLabel(entry.cwd);
      name ??= boundedText(entry.name, 120);
    }
    if (entry.type === "session_info") name = boundedText(entry.name, 120) ?? name;
  }
  if (!sessionHeaderFound) return null;
  const stem = pathImpl.basename(fallbackName, pathImpl.extname(fallbackName));
  return { name: name ?? boundedText(stem, 80) ?? "Session", cwd, cwdScope };
}

function workspaceId(cwd, secret) {
  if (!cwd) return undefined;
  const normalized = cwd.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const digest = secret
    ? createHmac("sha256", secret).update(`workspace\0${normalized}`).digest("base64url")
    : createHash("sha256").update(`pi-browser-workspace\0${normalized}`).digest("base64url");
  return `g_${digest.slice(0, 32)}`;
}

function sessionId(relativePath, secret) {
  const normalized = relativePath.split(path.sep).join("/");
  const digest = secret
    ? createHmac("sha256", secret).update(normalized).digest("base64url")
    : createHash("sha256").update(`pi-browser-session\0${normalized}`).digest("base64url");
  return `s_${digest.slice(0, 32)}`;
}

export class SessionCatalog {
  #options;
  #records = new Map();
  #rootReal;

  constructor(sessionRoot, options = {}) {
    if (typeof sessionRoot !== "string" || !sessionRoot) throw new TypeError("sessionRoot is required");
    this.sessionRoot = sessionRoot;
    this.#options = { ...DEFAULTS, ...options };
    for (const key of Object.keys(DEFAULTS)) {
      const value = this.#options[key];
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid ${key}`);
    }
    if (this.#options.maxScanBytes > this.#options.maxFileBytes) this.#options.maxScanBytes = this.#options.maxFileBytes;
  }

  async refresh() {
    const root = await realpath(this.sessionRoot);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) throw new TypeError("sessionRoot must be a directory");
    const files = [];
    let visited = 0;
    const walk = async (directory, depth) => {
      if (depth > this.#options.maxDepth || files.length >= this.#options.maxFiles || visited >= this.#options.maxEntries) return;
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++visited > this.#options.maxEntries || files.length >= this.#options.maxFiles) break;
        if (entry.isSymbolicLink()) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) files.push(full);
      }
    };
    await walk(root, 0);

    const next = new Map();
    for (const file of files) {
      try {
        const fileReal = await realpath(file);
        if (!within(root, fileReal)) continue;
        const info = await stat(fileReal);
        if (!info.isFile() || info.size > this.#options.maxFileBytes) continue;
        const relative = path.relative(root, fileReal);
        const metadata = parseMetadata(await readPrefix(fileReal, this.#options.maxScanBytes), fileReal);
        if (!metadata) continue;
        const id = sessionId(relative, this.#options.idSecret);
        next.set(id, {
          file: fileReal,
          cwdScope: metadata.cwdScope,
          public: Object.freeze({
            id,
            name: metadata.name,
            cwd: metadata.cwd,
            workspaceId: workspaceId(metadata.cwdScope, this.#options.idSecret),
            updatedAt: info.mtime.toISOString(),
          }),
        });
      } catch {
        // A concurrently removed, unreadable, or malformed session is simply omitted.
      }
    }
    this.#rootReal = root;
    this.#records = next;
    return this.list();
  }

  list() {
    return [...this.#records.values()].map((record) => record.public).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async resolve(id) {
    if (typeof id !== "string" || id.length > 64) return null;
    const record = this.#records.get(id);
    if (!record || !this.#rootReal) return null;
    try {
      const resolved = await realpath(record.file);
      if (resolved !== record.file || !within(this.#rootReal, resolved)) return null;
      const info = await stat(resolved);
      return info.isFile() ? resolved : null;
    } catch {
      return null;
    }
  }

  async cwdFor(id) {
    if (typeof id !== "string" || id.length > 64) return null;
    const cwdScope = this.#records.get(id)?.cwdScope;
    if (!cwdScope) return null;
    try {
      const resolved = await realpath(cwdScope);
      const info = await stat(resolved);
      return info.isDirectory() ? resolved : null;
    } catch {
      return null;
    }
  }

  async idForFile(file) {
    if (typeof file !== "string" || !this.#rootReal) return null;
    let resolved;
    try { resolved = await realpath(file); } catch { return null; }
    if (!within(this.#rootReal, resolved)) return null;
    for (const [id, record] of this.#records) {
      if (record.file === resolved) return id;
    }
    return null;
  }
}

export async function discoverSessions(sessionRoot, options) {
  const catalog = new SessionCatalog(sessionRoot, options);
  return catalog.refresh();
}

export function createSessionCatalog(options) {
  if (typeof options === "string") return new SessionCatalog(options);
  return new SessionCatalog(options?.sessionRoot, options);
}

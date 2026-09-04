import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SecurityError, acquireWriterLock, assertLoopbackRequest, createToken, loadOrCreatePrivateToken,
  readJsonBody, resolveStaticPath, setSecurityHeaders, tokensEqual,
} from "../browser/security.mjs";

test("loopback request validation rejects remote, misleading host, and cross-origin requests", () => {
  const request = { headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" }, socket: { remoteAddress: "::ffff:127.0.0.1" } };
  assert.equal(assertLoopbackRequest(request, { requireOrigin: true }), true);
  for (const bad of [
    { ...request, headers: { ...request.headers, host: "example.test:4173" } },
    { ...request, socket: { remoteAddress: "192.0.2.4" } },
    { ...request, headers: { ...request.headers, origin: "http://localhost:4173" } },
  ]) assert.throws(() => assertLoopbackRequest(bad, { requireOrigin: true }), SecurityError);
});

test("tokens are random and compared safely by value", () => {
  const first = createToken();
  const second = createToken();
  assert.notEqual(first, second);
  assert.equal(tokensEqual(first, first), true);
  assert.equal(tokensEqual(first, second), false);
  assert.equal(tokensEqual(first, `${first}x`), false);
  assert.equal(tokensEqual(undefined, first), false);
});

test("private browser tokens persist without being regenerated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-browser-token-"));
  const tokenPath = path.join(root, "session-id-secret");
  const first = await loadOrCreatePrivateToken(tokenPath);
  const second = await loadOrCreatePrivateToken(tokenPath);
  assert.equal(second, first);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(first, "base64url").length, 32);
});

test("security headers deny embedding and storage", () => {
  const values = new Map();
  setSecurityHeaders({ setHeader: (key, value) => values.set(key, value) });
  assert.match(values.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(values.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(values.get("X-Frame-Options"), "DENY");
});

test("JSON bodies must be bounded objects", async () => {
  const good = Readable.from([Buffer.from('{"message":"hello"}')]);
  good.headers = { "content-length": "19" };
  assert.deepEqual(await readJsonBody(good), { message: "hello" });
  const oversized = Readable.from([Buffer.alloc(20)]);
  oversized.headers = {};
  await assert.rejects(readJsonBody(oversized, { maxBytes: 8 }), (error) => error.code === "BODY_TOO_LARGE");
  const scalar = Readable.from(["true"]);
  scalar.headers = {};
  await assert.rejects(readJsonBody(scalar), (error) => error.code === "INVALID_JSON");
  const invalidLimit = Readable.from(["{}"]);
  invalidLimit.headers = {};
  await assert.rejects(readJsonBody(invalidLimit, { maxBytes: 9 * 1024 * 1024 }), /Invalid JSON body limit/);
});

test("static path resolution remains inside root and rejects symlink escapes", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "pi-browser-security-"));
  const root = path.join(parent, "public");
  await mkdir(root);
  await writeFile(path.join(root, "index.html"), "safe");
  await writeFile(path.join(parent, "private.txt"), "private");
  assert.equal(await readFile(await resolveStaticPath(root, "/"), "utf8"), "safe");
  assert.equal(await resolveStaticPath(root, "/../private.txt"), null);
  try {
    await symlink(path.join(parent, "private.txt"), path.join(root, "escape.txt"));
    assert.equal(await resolveStaticPath(root, "/escape.txt"), null);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("symlink creation unavailable");
  }
});

test("writer locks reject live owners, reclaim stale PIDs, and release only their file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-browser-lock-"));
  const lockPath = path.join(root, "writer.lock");
  const first = await acquireWriterLock(lockPath, { pid: 101, kill: (pid) => { if (pid === 101) return; throw Object.assign(new Error(), { code: "ESRCH" }); } });
  await assert.rejects(acquireWriterLock(lockPath, { pid: 202, kill: () => {} }), (error) => error.code === "WRITER_LOCKED");
  await first.release();
  await writeFile(lockPath, JSON.stringify({ pid: 303, owner: "old" }));
  const replacement = await acquireWriterLock(lockPath, { pid: 404, kill: () => { throw Object.assign(new Error(), { code: "ESRCH" }); } });
  const contents = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(contents.pid, 404);
  await replacement.release();
});

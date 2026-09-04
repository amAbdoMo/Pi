import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionCatalog, discoverSessions } from "../browser/session-catalog.mjs";

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), "pi-browser-catalog-"));
  const root = path.join(parent, "sessions");
  await mkdir(path.join(root, "nested"), { recursive: true });
  const session = path.join(root, "nested", "session-a.jsonl");
  await writeFile(session, [
    JSON.stringify({ type: "session", cwd: "/workspace/alpha", name: "Alpha work" }),
    "not-json",
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Please investigate the failing build." }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: "private transcript body" } }),
  ].join("\n"));
  return { parent, root, session };
}

test("catalog discovers bounded metadata without exposing paths or transcript bodies", async () => {
  const { root, session } = await fixture();
  const catalog = new SessionCatalog(root, { idSecret: "test-only-secret" });
  const sessions = await catalog.refresh();
  assert.equal(sessions.length, 1);
  assert.deepEqual({ ...sessions[0], id: "opaque" }, {
    id: "opaque",
    name: "Alpha work",
    cwd: "alpha",
    workspaceId: sessions[0].workspaceId,
    updatedAt: sessions[0].updatedAt,
  });
  assert.match(sessions[0].id, /^s_[A-Za-z0-9_-]{32}$/);
  assert.match(sessions[0].workspaceId, /^g_[A-Za-z0-9_-]{32}$/);
  const serialized = JSON.stringify(sessions);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("Please investigate the failing build."), false);
  assert.equal(serialized.includes("private transcript body"), false);
  assert.equal(await catalog.resolve(sessions[0].id) !== null, true);
  assert.equal(await catalog.idForFile(session), sessions[0].id);
  assert.equal(await catalog.idForFile(path.join(root, "missing.jsonl")), null);
  assert.equal(await catalog.resolve("s_unknown"), null);
});

test("catalog resolves a session workspace privately without exposing its absolute path", async () => {
  const { parent, root, session } = await fixture();
  const workspace = path.join(parent, "workspace");
  await mkdir(workspace);
  await writeFile(session, JSON.stringify({ type: "session", cwd: workspace, name: "Private workspace" }));
  const catalog = new SessionCatalog(root, { idSecret: "test-only-secret" });
  const [entry] = await catalog.refresh();
  assert.equal(await catalog.cwdFor(entry.id), await realpath(workspace));
  assert.equal(JSON.stringify(entry).includes(workspace), false);
  assert.equal(await catalog.cwdFor("s_unknown"), null);
});

test("opaque session and workspace IDs are deterministic", async () => {
  const { root } = await fixture();
  const first = await discoverSessions(root, { idSecret: "stable-secret" });
  const second = await discoverSessions(root, { idSecret: "stable-secret" });
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].workspaceId, second[0].workspaceId);
});

test("same-named workspace leaves retain distinct opaque grouping IDs", async () => {
  const { root } = await fixture();
  await writeFile(path.join(root, "other.jsonl"),
    JSON.stringify({ type: "session", cwd: "/different/alpha", name: "Other alpha" }));
  const sessions = await discoverSessions(root, { idSecret: "stable-secret" });
  assert.equal(new Set(sessions.map((session) => session.cwd)).size, 1);
  assert.equal(new Set(sessions.map((session) => session.workspaceId)).size, 2);
});

test("malformed, oversized, deep, and symlinked files do not escape discovery bounds", async (t) => {
  const { parent, root } = await fixture();
  await writeFile(path.join(root, "malformed.jsonl"), "{\n[]\nnull\n");
  await writeFile(path.join(root, "large.jsonl"), Buffer.alloc(128));
  const outside = path.join(parent, "outside.jsonl");
  await writeFile(outside, JSON.stringify({ cwd: "/outside", message: { role: "user", content: "secret" } }));
  try { await symlink(outside, path.join(root, "linked.jsonl")); }
  catch (error) { if (error.code !== "EPERM") throw error; t.diagnostic("symlink creation unavailable"); }
  const catalog = new SessionCatalog(root, { maxFileBytes: 64, maxScanBytes: 64, maxDepth: 2, maxFiles: 10, maxEntries: 20 });
  const sessions = await catalog.refresh();
  assert.equal(JSON.stringify(sessions).includes("secret"), false);
  assert.equal(sessions.some((entry) => entry.name === "large"), false);
});

test("resolve rechecks a catalogued file and rejects a later symlink swap", async (t) => {
  const { parent, root, session } = await fixture();
  const catalog = new SessionCatalog(root);
  const [entry] = await catalog.refresh();
  const moved = path.join(parent, "moved.jsonl");
  await rename(session, moved);
  try {
    await symlink(moved, session);
    assert.equal(await catalog.resolve(entry.id), null);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("symlink creation unavailable");
  }
});

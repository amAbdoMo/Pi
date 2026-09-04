import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { beginTaskEdits, completeTaskEdits, taskEditPatch, undoTaskEdits } from "../browser/task-edits.mjs";

const execFileAsync = promisify(execFile);

async function repository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-task-edits-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "committed\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
  await execFileAsync("git", ["-c", "user.name=Pi Test", "-c", "user.email=pi@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

test("task edit tracking stays unavailable outside a Git repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-task-edits-no-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await beginTaskEdits(root), null);
});

test("task edit summary excludes earlier working-tree edits and undo restores that exact baseline", async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, "tracked.txt"), "pre-existing\n", "utf8");
  const objectsBefore = (await execFileAsync("git", ["count-objects", "-v"], { cwd: root })).stdout;
  const capture = await beginTaskEdits(root);
  await writeFile(path.join(root, "tracked.txt"), "pre-existing\ntask line\n", "utf8");
  await writeFile(path.join(root, "created.txt"), "created by task\n", "utf8");

  const summary = await completeTaskEdits(capture);
  const objectsAfter = (await execFileAsync("git", ["count-objects", "-v"], { cwd: root })).stdout;
  assert.equal(objectsAfter, objectsBefore);
  assert.deepEqual(summary.files.map((file) => file.path), ["created.txt", "tracked.txt"]);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 0);
  const patch = await taskEditPatch(summary);
  assert.match(patch, /\+task line/);
  assert.doesNotMatch(patch, /-committed/);

  await undoTaskEdits(summary);
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "pre-existing\n");
  await assert.rejects(readFile(path.join(root, "created.txt"), "utf8"), { code: "ENOENT" });
});

test("task undo refuses to overwrite a file changed after the task", async (t) => {
  const root = await repository(t);
  const capture = await beginTaskEdits(root);
  await writeFile(path.join(root, "tracked.txt"), "task result\n", "utf8");
  const summary = await completeTaskEdits(capture);
  await writeFile(path.join(root, "tracked.txt"), "later work\n", "utf8");

  await assert.rejects(undoTaskEdits(summary), (error) => error.code === "TASK_EDIT_CONFLICT");
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "later work\n");
});

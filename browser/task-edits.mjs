import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_SUMMARY_FILES = 500;

async function git(cwd, args, options = {}) {
  const commandArgs = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args];
  const { stdout = "" } = await execFileAsync("git", commandArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
    ...options,
  });
  return stdout;
}

async function repositoryRoot(cwd) {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  return path.resolve(root);
}

function snapshotEnvironment(capture, indexPath) {
  return {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_OBJECT_DIRECTORY: capture.objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: capture.repositoryObjects,
  };
}

async function workingTreeSnapshot(capture) {
  const indexPath = path.join(capture.storageRoot, `index-${randomUUID()}`);
  const env = snapshotEnvironment(capture, indexPath);
  try {
    await git(capture.root, ["read-tree", "--empty"], { env });
    await git(capture.root, ["add", "-A", "--", "."], { env });
    return (await git(capture.root, ["write-tree"], { env })).trim();
  } finally {
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
  }
}

function parseNumstat(output) {
  if (!output) return [];
  const fields = output.split("\0").filter(Boolean);
  return fields.map((record) => {
    const [added, deleted, ...pathParts] = record.split("\t");
    const filePath = pathParts.join("\t");
    return {
      path: filePath,
      additions: added === "-" ? 0 : Number(added),
      deletions: deleted === "-" ? 0 : Number(deleted),
      binary: added === "-" || deleted === "-",
    };
  });
}

function summaryGitOptions(summary) {
  return { env: snapshotEnvironment(summary, path.join(summary.storageRoot, "unused-index")) };
}

async function changedFiles(summary, afterTree) {
  const output = await git(summary.root, ["diff", "--numstat", "-z", "--no-renames", summary.beforeTree, afterTree, "--"], summaryGitOptions(summary));
  const files = parseNumstat(output);
  if (files.length > MAX_SUMMARY_FILES) throw new Error("Task changed too many files to summarize safely");
  return files;
}

async function exactPatch(summary) {
  return git(summary.root, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames", summary.beforeTree, summary.afterTree, "--"], summaryGitOptions(summary));
}

export async function beginTaskEdits(cwd) {
  let root;
  try { root = await repositoryRoot(cwd); }
  catch (error) {
    if (error?.code === 128) return null;
    throw error;
  }
  const repositoryObjects = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "objects"])).trim());
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "pi-workbench-task-"));
  const capture = { root, storageRoot, objectDirectory: path.join(storageRoot, "objects"), repositoryObjects };
  try {
    await mkdir(capture.objectDirectory, { recursive: true, mode: 0o700 });
    capture.beforeTree = await workingTreeSnapshot(capture);
    return capture;
  } catch (error) {
    await rm(storageRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function completeTaskEdits(capture) {
  const afterTree = await workingTreeSnapshot(capture);
  const files = await changedFiles(capture, afterTree);
  if (files.length === 0) {
    await disposeTaskEdits(capture);
    return null;
  }
  return {
    id: randomUUID(),
    ...capture,
    afterTree,
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    undone: false,
  };
}

export function publicTaskEditSummary(summary) {
  return {
    id: summary.id,
    files: summary.files,
    additions: summary.additions,
    deletions: summary.deletions,
    undone: summary.undone,
  };
}

export async function taskEditPatch(summary) {
  return exactPatch(summary);
}

export async function disposeTaskEdits(summary) {
  if (summary?.storageRoot) await rm(summary.storageRoot, { recursive: true, force: true });
}

export async function undoTaskEdits(summary) {
  if (summary.undone) return publicTaskEditSummary(summary);
  const currentTree = await workingTreeSnapshot(summary);
  const changedPaths = (await git(summary.root, [
    "diff", "--name-only", "-z", "--no-renames", summary.afterTree, currentTree, "--",
  ], summaryGitOptions(summary))).split("\0").filter(Boolean);
  const taskPaths = new Set(summary.files.map((file) => file.path));
  if (changedPaths.some((filePath) => taskPaths.has(filePath))) {
    const error = new Error("These files changed after the task finished. Review them before undoing.");
    error.code = "TASK_EDIT_CONFLICT";
    throw error;
  }
  const patch = await exactPatch(summary);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pi-workbench-undo-"));
  const patchPath = path.join(temporaryDirectory, "task.patch");
  try {
    await writeFile(patchPath, patch, "utf8");
    await git(summary.root, ["apply", "--reverse", "--check", "--binary", patchPath]);
    await git(summary.root, ["apply", "--reverse", "--binary", patchPath]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  summary.undone = true;
  return publicTaskEditSummary(summary);
}

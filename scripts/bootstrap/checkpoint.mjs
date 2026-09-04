import fs from "node:fs";
import path from "node:path";
import { atomicCopy, atomicWrite, fileHash, readJson, safeAgentPath } from "./files.mjs";

const LATEST_CHECKPOINT_FILE = "latest.json";
const CHECKPOINT_MANIFEST_FILE = "checkpoint.json";

function checkpointRoot(agentDir) {
  return path.join(agentDir, "bootstrap-checkpoints");
}

function checkpointName(now) {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

function captureEntry({ agentDir, filesDirectory, relativePath }) {
  const sourcePath = safeAgentPath(agentDir, relativePath);
  if (!fs.existsSync(sourcePath)) return { relativePath, existed: false };
  if (!fs.statSync(sourcePath).isFile()) throw new Error(`Checkpoint target is not a file: ${sourcePath}`);
  const backupPath = path.join(filesDirectory, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sourcePath, backupPath);
  return { relativePath, existed: true, sha256: fileHash(backupPath) };
}

function checkpointDocument({ agentDir, manifest, now, previousPiVersion, managedPackageSources, managedPackagePresence, entries }) {
  return {
    schemaVersion: 1,
    release: manifest.release,
    createdAt: now.toISOString(),
    agentDir: path.resolve(agentDir),
    previousPiVersion,
    managedPackageSources: [...new Set(managedPackageSources.filter(Boolean))],
    managedPackagePresence,
    entries,
  };
}

export function createCheckpoint({
  agentDir,
  manifest,
  now = new Date(),
  previousPiVersion,
  managedPackageSources = [],
  managedPackagePresence,
}) {
  const root = checkpointRoot(agentDir);
  const directory = path.join(root, checkpointName(now));
  const filesDirectory = path.join(directory, "files");
  fs.mkdirSync(filesDirectory, { recursive: true });
  try {
    const entries = manifest.checkpointFiles.map((relativePath) =>
      captureEntry({ agentDir, filesDirectory, relativePath }));
    const checkpoint = checkpointDocument({
      agentDir,
      manifest,
      now,
      previousPiVersion,
      managedPackageSources,
      managedPackagePresence,
      entries,
    });
    atomicWrite(path.join(directory, CHECKPOINT_MANIFEST_FILE), `${JSON.stringify(checkpoint, null, 2)}\n`);
    atomicWrite(path.join(root, LATEST_CHECKPOINT_FILE), `${JSON.stringify({ directory }, null, 2)}\n`);
    return { directory, checkpoint };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function selectedCheckpointDirectory(agentDir, requestedDirectory) {
  const root = path.resolve(checkpointRoot(agentDir));
  const latestCheckpoint = requestedDirectory
    ? undefined
    : readJson(path.join(root, LATEST_CHECKPOINT_FILE)).directory;
  const directory = path.resolve(requestedDirectory || latestCheckpoint);
  const relation = path.relative(root, directory);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Checkpoint is outside ${root}: ${directory}`);
  }
  return directory;
}

function verifiedCheckpoint({ agentDir, manifest, directory }) {
  const checkpoint = readJson(path.join(directory, CHECKPOINT_MANIFEST_FILE));
  if (checkpoint.schemaVersion !== 1) throw new Error(`Unsupported checkpoint schema: ${checkpoint.schemaVersion}`);
  if (path.resolve(checkpoint.agentDir) !== path.resolve(agentDir)) {
    throw new Error(`Checkpoint belongs to another agent directory: ${checkpoint.agentDir}`);
  }
  const approvedFiles = new Set(manifest.checkpointFiles);
  for (const entry of checkpoint.entries ?? []) {
    if (!approvedFiles.has(entry.relativePath)) throw new Error(`Checkpoint contains an unapproved file: ${entry.relativePath}`);
  }
  return checkpoint;
}

function restoreEntry({ agentDir, directory, entry }) {
  const targetPath = safeAgentPath(agentDir, entry.relativePath);
  if (!entry.existed) {
    fs.rmSync(targetPath, { force: true });
    return;
  }
  const backupPath = path.join(directory, "files", entry.relativePath);
  if (!fs.existsSync(backupPath) || fileHash(backupPath) !== entry.sha256) {
    throw new Error(`Checkpoint file failed integrity verification: ${entry.relativePath}`);
  }
  atomicCopy(backupPath, targetPath);
}

export function restoreCheckpoint({ agentDir, manifest, directory }) {
  const selectedDirectory = selectedCheckpointDirectory(agentDir, directory);
  const checkpoint = verifiedCheckpoint({ agentDir, manifest, directory: selectedDirectory });
  for (const entry of checkpoint.entries ?? []) {
    restoreEntry({ agentDir, directory: selectedDirectory, entry });
  }
  return { directory: selectedDirectory, checkpoint };
}

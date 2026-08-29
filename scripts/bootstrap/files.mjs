import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${filePath}: ${errorMessage(error)}`);
  }
}

export function safeAgentPath(agentDir, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid checkpoint path: ${relativePath}`);
  }
  const agentRoot = path.resolve(agentDir);
  const targetPath = path.resolve(agentRoot, relativePath);
  const relation = path.relative(agentRoot, targetPath);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Checkpoint path escapes the agent directory: ${relativePath}`);
  }
  return targetPath;
}

export function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, contents);
  try {
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function atomicCopy(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(sourcePath, temporaryPath);
  try {
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

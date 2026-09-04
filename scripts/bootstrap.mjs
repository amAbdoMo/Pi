import path from "node:path";
import { createCheckpoint, restoreCheckpoint } from "./bootstrap/checkpoint.mjs";
import {
  bootstrapHelp,
  loadBootstrapManifest,
  parseBootstrapArguments,
  resolveAgentDir,
} from "./bootstrap/contracts.mjs";
import { atomicWrite, errorMessage } from "./bootstrap/files.mjs";
import {
  collectDiagnostics,
  ensurePiVersion,
  installedManagedSources,
  installedPi,
  managedPackagePresence,
  invokePlatformInstaller,
  reinstallPreviousState,
  verifyInstallation,
} from "./bootstrap/runtime.mjs";

export { createCheckpoint, restoreCheckpoint } from "./bootstrap/checkpoint.mjs";
export { loadBootstrapManifest, parseBootstrapArguments, resolveAgentDir } from "./bootstrap/contracts.mjs";

function printChecks(title, checks, json) {
  if (json) {
    console.log(JSON.stringify({ title, results: checks }, null, 2));
    return;
  }
  console.log(title);
  for (const currentCheck of checks) {
    const marker = currentCheck.status === "pass" ? "PASS" : currentCheck.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${marker}] ${currentCheck.id}: ${currentCheck.detail}`);
  }
}

function hasFailure(checks) {
  return checks.some((currentCheck) => currentCheck.status === "fail");
}

function runDiagnosis({ sourceRoot, manifest, agentDir, json }) {
  const checks = collectDiagnostics({ sourceRoot, manifest, agentDir });
  printChecks("Pi Workbench diagnosis", checks, json);
  return hasFailure(checks) ? 1 : 0;
}

function runVerification({ manifest, agentDir, json }) {
  const checks = verifyInstallation({ manifest, agentDir });
  printChecks("Pi Workbench verification", checks, json);
  return hasFailure(checks) ? 1 : 0;
}

function runRollback({ manifest, agentDir, checkpointDirectory, json }) {
  const restoredState = restoreCheckpoint({ agentDir, manifest, directory: checkpointDirectory });
  reinstallPreviousState(restoredState.checkpoint, { agentDir });
  restoreCheckpoint({ agentDir, manifest, directory: restoredState.directory });
  printChecks("Pi Workbench rollback", [{ id: "checkpoint", status: "pass", detail: restoredState.directory }], json);
  return 0;
}

function installBlockers({ sourceRoot, manifest, agentDir }) {
  return collectDiagnostics({ sourceRoot, manifest, agentDir })
    .filter((currentCheck) => currentCheck.status === "fail");
}

function installationCheckpoint({ agentDir, manifest }) {
  return createCheckpoint({
    agentDir,
    manifest,
    previousPiVersion: installedPi()?.version,
    managedPackageSources: installedManagedSources(agentDir),
    managedPackagePresence: managedPackagePresence(agentDir),
  });
}

function recordSuccessfulInstall(checkpointDirectory, release) {
  const completion = { completedAt: new Date().toISOString(), release };
  atomicWrite(path.join(checkpointDirectory, "install-result.json"), `${JSON.stringify(completion, null, 2)}\n`);
}

function runInstall({ sourceRoot, manifest, agentDir, options }) {
  const blockers = installBlockers({ sourceRoot, manifest, agentDir });
  if (blockers.length > 0) {
    printChecks("Pi Workbench diagnosis", blockers, options.json);
    throw new Error(`Install blocked by: ${blockers.map((blocker) => blocker.id).join(", ")}`);
  }
  const checkpoint = installationCheckpoint({ agentDir, manifest });
  console.log(`Created rollback checkpoint: ${checkpoint.directory}`);
  try {
    ensurePiVersion(manifest);
    invokePlatformInstaller({ sourceRoot, manifest, ...options });
    const verification = verifyInstallation({ manifest, agentDir });
    printChecks("Pi Workbench verification", verification, options.json);
    if (hasFailure(verification)) throw new Error("Installation verification failed");
    recordSuccessfulInstall(checkpoint.directory, manifest.release);
    return 0;
  } catch (error) {
    throw new Error(`${errorMessage(error)}. Rollback checkpoint: ${checkpoint.directory}`);
  }
}

export function runBootstrap({ argumentsList, sourceRoot }) {
  const options = parseBootstrapArguments(argumentsList);
  if (options.showHelp) {
    process.stdout.write(bootstrapHelp());
    return 0;
  }
  const manifest = loadBootstrapManifest(sourceRoot);
  const agentDir = resolveAgentDir();
  if (options.command === "diagnose") return runDiagnosis({ sourceRoot, manifest, agentDir, json: options.json });
  if (options.command === "verify") return runVerification({ manifest, agentDir, json: options.json });
  if (options.command === "rollback") {
    return runRollback({ manifest, agentDir, checkpointDirectory: options.checkpoint, json: options.json });
  }
  return runInstall({ sourceRoot, manifest, agentDir, options });
}

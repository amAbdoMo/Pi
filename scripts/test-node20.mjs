import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testsDirectory = fileURLToPath(new URL("../tests/", import.meta.url));
// These tests rely on node:module TypeScript hooks introduced in Node.js 22.15.
const node22OnlyTests = new Set([
  "browser-mcp-settings.test.mjs",
  "browser-mcp-setup.test.mjs",
]);
const tests = readdirSync(testsDirectory)
  .filter((name) => name.startsWith("browser-") && name.endsWith(".test.mjs") && !node22OnlyTests.has(name))
  .map((name) => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)));
tests.push(
  fileURLToPath(new URL("../tests/bootstrap.test.mjs", import.meta.url)),
  fileURLToPath(new URL("../tests/installer-security.test.mjs", import.meta.url)),
);

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

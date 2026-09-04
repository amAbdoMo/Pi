#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap.mjs";

async function main() {
  try {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const argumentsList = process.argv.slice(2);
    if (argumentsList[0] === "web" || argumentsList[0] === "browser") {
      const { runPiBrowser } = await import("../browser/server.mjs");
      await runPiBrowser();
      return;
    }
    process.exitCode = runBootstrap({ argumentsList, sourceRoot });
  } catch (error) {
    console.error(`Pi Workbench: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();

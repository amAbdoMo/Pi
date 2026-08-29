#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap.mjs";

function main() {
  try {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    process.exitCode = runBootstrap({
      argumentsList: process.argv.slice(2),
      sourceRoot,
    });
  } catch (error) {
    console.error(`Pi Workbench bootstrap: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();

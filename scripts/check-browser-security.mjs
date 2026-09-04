import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_ROOT = path.join(ROOT, "browser");
const SOURCE_EXTENSIONS = new Set([".html", ".js", ".mjs"]);
const DYNAMIC_EVALUATOR = /\beval\s*\(|\bnew\s+Function\s*\(/;

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(target));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(target);
  }
  return output;
}

const failures = [];
for (const file of await sourceFiles(BROWSER_ROOT)) {
  const source = await readFile(file, "utf8");
  source.split(/\r?\n/).forEach((line, index) => {
    if (DYNAMIC_EVALUATOR.test(line)) failures.push(`${path.relative(ROOT, file)}:${index + 1}: dynamic evaluator`);
  });
}

const index = await readFile(path.join(BROWSER_ROOT, "public", "index.html"), "utf8");
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(index)) failures.push("browser/public/index.html: inline script");
if (/\son\w+\s*=/i.test(index)) failures.push("browser/public/index.html: inline event handler");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("Browser CSP/evaluator scan passed.");

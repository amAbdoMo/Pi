import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYNTHETIC_MARKER = "public-scan: synthetic-credential";
const SYNTHETIC_FIXTURE_FILES = new Set(["extensions/ui-learning-loop/core.test.ts"]);
const SENSITIVE_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ["provider-token", /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["machine-user-path", /[A-Z]:\\Users\\[^\\\s"']+/i],
];
const RISKY_FILE = /(^|\/)(auth\.json|trust\.json|credentials?\.(?:json|ya?ml)|cookies?|login data|.*\.pem|.*\.key|sessions?\/.*\.jsonl)$/i;

export function scanText(contents, { allowSyntheticMarkers = false } = {}) {
  const findings = [];
  contents.split(/\r?\n/).forEach((line, lineIndex) => {
    if (allowSyntheticMarkers && line.includes(SYNTHETIC_MARKER)) return;
    for (const [pattern, expression] of SENSITIVE_PATTERNS) {
      if (expression.test(line)) findings.push({ pattern, line: lineIndex + 1 });
    }
  });
  return findings;
}

export function riskyPublicFilename(filePath) {
  return RISKY_FILE.test(filePath.replaceAll("\\", "/"));
}

function publicFiles(root) {
  const execution = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (execution.error) throw execution.error;
  if (execution.status !== 0) throw new Error(`git ls-files failed with exit code ${execution.status}`);
  return execution.stdout.split("\0").filter(Boolean);
}

function scanFile(root, relativePath) {
  if (riskyPublicFilename(relativePath)) return [{ pattern: "risky-filename", path: relativePath }];
  const contents = fs.readFileSync(path.join(root, relativePath));
  if (contents.includes(0) || contents.length > 2_000_000) return [];
  const scanOptions = { allowSyntheticMarkers: SYNTHETIC_FIXTURE_FILES.has(relativePath) };
  return scanText(contents.toString("utf8"), scanOptions)
    .map((finding) => ({ ...finding, path: relativePath }));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = publicFiles(root);
  const findings = files.flatMap((relativePath) => scanFile(root, relativePath));
  if (findings.length === 0) {
    console.log(`Public file scan passed (${files.length} files).`);
    return;
  }
  for (const finding of findings) {
    const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
    console.error(`${finding.pattern}: ${location}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

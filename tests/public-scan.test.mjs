import assert from "node:assert/strict";
import test from "node:test";
import { riskyPublicFilename, scanText } from "../scripts/scan-public-files.mjs";

const providerToken = "sk-proj-" + "1234567890abcdef";

test("public scan detects credential shapes and machine-specific paths", () => {
  const findings = scanText([
    `OPENAI_API_KEY=${providerToken}`,
    "home=C:\\Users\\private-user\\project",
    "safe=ordinary-value",
  ].join("\n"));
  assert.deepEqual(findings, [
    { pattern: "provider-token", line: 1 },
    { pattern: "machine-user-path", line: 2 },
  ]);
});

test("public scan permits markers only when the caller identifies an approved fixture", () => {
  const markedCredential = `OPENAI_API_KEY=${providerToken} // public-scan: synthetic-credential`;
  assert.equal(scanText(markedCredential).length, 1);
  assert.deepEqual(scanText(markedCredential, { allowSyntheticMarkers: true }), []);
  assert.equal(scanText(`OPENAI_API_KEY=${providerToken}`).length, 1);
});

test("public scan rejects credential and session filenames", () => {
  for (const filePath of ["auth.json", "config/credentials.yaml", "sessions/private.jsonl", "browser/Login Data"]) {
    assert.equal(riskyPublicFilename(filePath), true, filePath);
  }
  assert.equal(riskyPublicFilename("settings.example.json"), false);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeModelDefault, readModelDefault, writeModelDefault } from "../browser/model-default.mjs";

async function preferenceFile(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-browser-model-default-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "browser-model-default.json");
}

test("model default validates and normalizes the persisted browser selection", () => {
  assert.deepEqual(normalizeModelDefault({
    provider: " OpenAI-Codex ",
    modelId: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    thinkingLevel: "high",
  }), {
    provider: "openai-codex",
    modelId: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    thinkingLevel: "high",
  });
  assert.throws(() => normalizeModelDefault({ provider: "openai", modelId: "model", thinkingLevel: "extreme" }),
    (error) => error.code === "INVALID_MODEL_DEFAULT");
  assert.throws(() => normalizeModelDefault({ provider: "openai", modelId: "model", thinkingLevel: "high", token: "secret" }),
    (error) => error.code === "INVALID_MODEL_DEFAULT");
});

test("model default is absent until a successful selection is written", async (t) => {
  const file = await preferenceFile(t);
  assert.equal(await readModelDefault(file), null);
  const saved = await writeModelDefault(file, { provider: "openrouter", modelId: "anthropic/claude", thinkingLevel: "medium" });
  assert.deepEqual(await readModelDefault(file), saved);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), saved);
});

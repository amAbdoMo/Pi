import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeProviderRequest,
  providerSnapshot,
  removeProviderSettings,
  writeProviderSettings,
} from "../browser/provider-settings.mjs";

function providerRequest(overrides = {}) {
  return {
    provider: {
      id: "local-ai",
      baseUrl: "http://127.0.0.1:11434/v1/",
      api: "openai-completions",
      models: [{ id: "qwen2.5-coder", name: "Qwen Coder", reasoning: true, input: ["text"] }],
      ...overrides,
    },
    credentialAction: "replace",
    apiKey: "private-key",
  };
}

async function providerFiles(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-provider-settings-"));
  const modelsPath = path.join(root, "models.json");
  const authPath = path.join(root, "auth.json");
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { modelsPath, authPath };
}

test("guided provider input normalizes supported model fields and rejects executable credentials", () => {
  const normalized = normalizeProviderRequest(providerRequest());
  assert.equal(normalized.provider.baseUrl, "http://127.0.0.1:11434/v1");
  assert.deepEqual(normalized.provider.models[0].input, ["text"]);
  assert.throws(
    () => normalizeProviderRequest({ ...providerRequest(), apiKey: "!op read secret" }),
    (error) => error.code === "INVALID_PROVIDER" && /API key/.test(error.message),
  );
});

test("saving a provider preserves unrelated models config and returns only credential metadata", async (t) => {
  const files = await providerFiles(t);
  await writeFile(files.modelsPath, '{\n  // retained\n  "providers": { "existing": { "baseUrl": "http://localhost", "apiKey": "$EXISTING" } },\n  "other": true\n}\n');
  await writeFile(files.authPath, '{}\n');

  const providers = await writeProviderSettings(files.modelsPath, files.authPath, providerRequest());
  const modelsText = await readFile(files.modelsPath, "utf8");
  const auth = JSON.parse(await readFile(files.authPath, "utf8"));

  assert.match(modelsText, /\/\/ retained/);
  assert.match(modelsText, /"other": true/);
  assert.equal(auth["local-ai"].key, "private-key");
  assert.deepEqual(providers.find(({ id }) => id === "local-ai").credentialType, "api_key");
  assert.doesNotMatch(JSON.stringify(providers), /private-key/);
});

test("editing preserves advanced provider and matching model settings", async (t) => {
  const files = await providerFiles(t);
  await writeFile(files.modelsPath, JSON.stringify({ providers: { "local-ai": {
    baseUrl: "http://old.example/v1",
    api: "openai-completions",
    headers: { "x-team": "$TEAM" },
    compat: { supportsDeveloperRole: false },
    models: [{ id: "qwen2.5-coder", samplingParams: { temperature: 0.2 }, cost: { input: 1 } }],
  } } }));
  await writeFile(files.authPath, '{}\n');

  await writeProviderSettings(files.modelsPath, files.authPath, {
    ...providerRequest(),
    credentialAction: "preserve",
    apiKey: undefined,
  });
  const saved = JSON.parse(await readFile(files.modelsPath, "utf8")).providers["local-ai"];
  assert.deepEqual(saved.headers, { "x-team": "$TEAM" });
  assert.deepEqual(saved.compat, { supportsDeveloperRole: false });
  assert.deepEqual(saved.models[0].samplingParams, { temperature: 0.2 });
  assert.deepEqual(saved.models[0].cost, { input: 1 });
});

test("removing a provider keeps or deletes its credential according to the explicit choice", async (t) => {
  const files = await providerFiles(t);
  await writeProviderSettings(files.modelsPath, files.authPath, providerRequest());
  await removeProviderSettings(files.modelsPath, files.authPath, { providerId: "local-ai", deleteCredential: false });
  assert.equal(JSON.parse(await readFile(files.authPath, "utf8"))["local-ai"].key, "private-key");

  await writeProviderSettings(files.modelsPath, files.authPath, { ...providerRequest(), credentialAction: "preserve", apiKey: undefined });
  await removeProviderSettings(files.modelsPath, files.authPath, { providerId: "local-ai", deleteCredential: true });
  assert.equal(JSON.parse(await readFile(files.authPath, "utf8"))["local-ai"], undefined);
});

test("keeping a models.json credential migrates it to Pi credential storage before removal", async (t) => {
  const files = await providerFiles(t);
  await writeFile(files.modelsPath, JSON.stringify({ providers: { proxy: {
    baseUrl: "https://proxy.example/v1",
    api: "openai-responses",
    apiKey: "$PROXY_KEY",
    models: [{ id: "model" }],
  } } }));
  await writeFile(files.authPath, '{}\n');

  await removeProviderSettings(files.modelsPath, files.authPath, { providerId: "proxy", deleteCredential: false });
  assert.deepEqual(JSON.parse(await readFile(files.authPath, "utf8")).proxy, { type: "api_key", key: "$PROXY_KEY" });
});

test("provider snapshots never expose keys stored in either Pi configuration file", () => {
  const snapshot = providerSnapshot(
    JSON.stringify({ providers: { proxy: { baseUrl: "https://proxy.example/v1", api: "openai-responses", apiKey: "$PROXY_KEY", models: [{ id: "model" }] } } }),
    JSON.stringify({ proxy: { type: "api_key", key: "literal-secret" } }),
  );
  assert.equal(snapshot[0].credentialConfigured, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /PROXY_KEY|literal-secret/);

  const legacyUrl = providerSnapshot(JSON.stringify({ providers: { proxy: {
    baseUrl: "https://user:password@proxy.example/v1?api_key=secret#private",
    api: "openai-responses",
    models: [{ id: "model" }],
  } } }), "{}");
  assert.equal(legacyUrl[0].baseUrl, "https://proxy.example/v1");
  assert.doesNotMatch(JSON.stringify(legacyUrl), /password|api_key|secret|private/);
});

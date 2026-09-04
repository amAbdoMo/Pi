import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addMcpServer,
  migrateInlineMcpSecrets,
  readMcpSettings,
  removeMcpServer,
  renameMcpServer,
  testMcpServerConnection,
  toggleMcpServer,
  updateMcpServer,
} from "../browser/mcp-settings.mjs";
import { loadMcpConfiguration } from "../extensions/mcp/config.ts";

async function fixture(t, { includeProject = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-mcp-settings-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  const options = {
    cwd: path.join(root, "project"),
    homeDirectory: path.join(root, "home"),
    agentDirectory: path.join(root, "agent"),
    includeProject,
  };
  await mkdir(options.cwd, { recursive: true });
  return { root, options, authPath: path.join(options.agentDirectory, "mcp-auth.json") };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function localConfig(command = "example-mcp") {
  return { type: "local", command: [command], enabled: true };
}

test("snapshot reports precedence, shadows, safe sources, and managed metadata", async (t) => {
  const { options } = await fixture(t);
  const embeddedPath = `--config=${path.join(options.cwd, "private.json")}`;
  await writeJson(path.join(options.agentDirectory, "mcp.json"), { mcp: {
    shared: localConfig("agent-command"),
    browser: { ...localConfig("managed"), piWorkbenchManaged: true },
    privateConfig: { type: "local", command: ["server", embeddedPath], env: { "X-Auth": "must-not-leak" } },
  } });
  await writeJson(path.join(options.cwd, ".mcp.json"), { mcpServers: { shared: localConfig("project-command") } });

  const snapshot = await readMcpSettings(options);
  const shared = snapshot.servers.find(({ name }) => name === "shared");
  assert.equal(shared.duplicate, true);
  assert.equal(shared.shadowedCount, 1);
  assert.equal(shared.config.command[0], "project-command");
  assert.equal(shared.source.scope, "project");
  assert.equal(shared.definitions[0].effective, false);
  assert.equal(snapshot.servers.find(({ name }) => name === "browser").config.managed, true);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes(options.cwd), false);
  assert.match(snapshot.servers.find(({ name }) => name === "privateConfig").config.command[1], /PRIVATE_PATH/);
  assert.equal(JSON.stringify(snapshot).includes(options.agentDirectory), false);
  assert.equal(JSON.stringify(snapshot).includes(options.cwd), false);
});

test("snapshot fails closed for private ordinary keys, invalid URLs, quoted secrets, and embedded paths", async (t) => {
  const { options } = await fixture(t);
  const configPath = path.join(options.agentDirectory, "mcp.json");
  await writeJson(configPath, { mcp: {
    invalidUrl: { type: "remote", url: "file:///C:/private/secret-token" },
    legacy: { type: "local", command: ["server", '"--token=quoted-secret"', "--config:C:\\private\\secret.json", '"C:\\private\\quoted.json"', "prefix:C:\\private\\embedded.json", "--config=\\\\private-server\\secret-share\\credential.json", "--config=//private-server/secret-share/credential.json", "--header=Authorization: Bearer nested-auth-secret", "--header=Cookie: nested-cookie-secret"] },
  } });
  const privateEnv = await addMcpServer(options, {
    target: "global", name: "private-env", config: { type: "local", command: ["server"], env: { X_DATA: "inline-old" } },
    credentials: [{ location: "env", key: "X_DATA", action: "replace", value: "private-new" }],
  });
  assert.equal(JSON.stringify(privateEnv.snapshot).includes("inline-old"), false);
  const privateHeader = await addMcpServer(options, {
    target: "global", name: "private-header", config: { type: "remote", url: "https://example.test/mcp", headers: { "x-data": "inline-header" } },
    credentials: [{ location: "headers", key: "X-Data", action: "replace", value: "header-private-value" }],
  });
  const serialized = JSON.stringify(privateHeader.snapshot);
  assert.equal(serialized.includes("inline-header"), false);
  assert.equal(serialized.includes("header-private-value"), false);
  const runtime = await loadMcpConfiguration(options);
  const runtimeHeaders = runtime.servers.get("private-header").config.headers;
  assert.deepEqual(Object.keys(runtimeHeaders).filter((key) => key.toLowerCase() === "x-data"), ["X-Data"]);
  assert.equal(runtimeHeaders["X-Data"], "header-private-value");
  assert.deepEqual(runtime.servers.get("private-header").privateSecretValues, ["header-private-value"]);
  const snapshot = await readMcpSettings(options);
  assert.equal(snapshot.servers.find(({ name }) => name === "invalidUrl").config.url, "");
  assert.equal(snapshot.servers.find(({ name }) => name === "invalidUrl").config.urlMasked, true);
  const command = snapshot.servers.find(({ name }) => name === "legacy").config.command.join(" ");
  assert.equal(command.includes("quoted-secret"), false);
  assert.equal(command.includes("C:\\private"), false);
  assert.equal(command.includes("private-server"), false);
  assert.equal(command.includes("nested-auth-secret"), false);
  assert.equal(command.includes("nested-cookie-secret"), false);

  const changed = JSON.parse(await readFile(configPath, "utf8"));
  changed.mcp["private-header"].url = "http://example.test/mcp";
  await writeJson(configPath, changed);
  const insecureRuntime = await loadMcpConfiguration(options);
  assert.equal(insecureRuntime.servers.has("private-header"), false);
  assert.match(insecureRuntime.diagnostics.map(({ message }) => message).join("\n"), /credential headers require HTTPS/);
});

test("new servers default to the active project and preserve unrelated JSONC bytes", async (t) => {
  const { options } = await fixture(t);
  const projectConfig = path.join(options.cwd, ".pi", "mcp.json");
  await mkdir(path.dirname(projectConfig), { recursive: true });
  await writeFile(projectConfig, '{\n  // keep this comment exactly\n  "mcp": {},\n  "installer": { "unknown": true }\n}\n');

  await addMcpServer(options, { name: "tools", config: localConfig() });
  const text = await readFile(projectConfig, "utf8");
  assert.match(text, /\/\/ keep this comment exactly/);
  assert.match(text, /"installer": \{ "unknown": true \}/);
  assert.match(text, /"tools"/);
  assert.equal((await readMcpSettings(options)).servers[0].source.scope, "project");
});

test("updates preserve comments and unknown fields inside a server definition", async (t) => {
  const { options } = await fixture(t);
  const configPath = path.join(options.agentDirectory, "mcp.jsonc");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `{
    "mcp": {
      "tools": {
        // installer extension metadata must survive
        "extensionMetadata": { "owner": "other" },
        "type": "local",
        "command": ["before"]
      }
    }
  }\n`);
  await updateMcpServer(options, { name: "tools", config: localConfig("after") });
  const updated = await readFile(configPath, "utf8");
  assert.match(updated, /\/\/ installer extension metadata must survive/);
  assert.match(updated, /"extensionMetadata": \{ "owner": "other" \}/);
  assert.match(updated, /"after"/);
});

test("same-request replacements take precedence over stale clear rows", async (t) => {
  const { options } = await fixture(t);
  await addMcpServer(options, { target: "global", name: "replace", config: { type: "local", command: ["server"], env: { FOO: "old" } } });
  const sourceId = (await readMcpSettings(options)).servers.find(({ name }) => name === "replace").source.id;
  await updateMcpServer(options, {
    name: "replace", sourceId,
    config: { transport: "stdio", env: { FOO: "new" } },
    clearValues: [{ location: "env", key: "FOO" }],
  });
  assert.match(await readFile(path.join(options.agentDirectory, "mcp.json"), "utf8"), /"FOO": "new"/);

  await addMcpServer(options, { target: "global", name: "header-case", config: { type: "remote", url: "https://example.test/mcp", headers: { "x-data": "old" } } });
  const headerSource = (await readMcpSettings(options)).servers.find(({ name }) => name === "header-case").source.id;
  await updateMcpServer(options, {
    name: "header-case", sourceId: headerSource,
    config: { transport: "streamable-http", headers: { "X-Data": "new" } },
    clearValues: [{ location: "headers", key: "x-data" }],
  });
  const stored = JSON.parse(await readFile(path.join(options.agentDirectory, "mcp.json"), "utf8")).mcp["header-case"].headers;
  assert.deepEqual(stored, { "X-Data": "new" });
});

test("private header identity is case-insensitive and browser connection tests replace stale header casing", async (t) => {
  const { options, authPath } = await fixture(t);
  await addMcpServer(options, {
    target: "global", name: "private-case", config: { type: "remote", url: "https://example.test/mcp" },
    credentials: [{ location: "headers", key: "x-data", action: "replace", value: "old-private-secret" }],
  });
  const sourceId = (await readMcpSettings(options)).servers.find(({ name }) => name === "private-case").source.id;
  await updateMcpServer(options, {
    name: "private-case", sourceId, config: { transport: "streamable-http" },
    credentials: [{ location: "headers", key: "X-Data", action: "replace", value: "new-private-secret" }],
  });
  let auth = JSON.parse(await readFile(authPath, "utf8"));
  let rows = Object.values(auth.credentials).filter(({ server }) => server === "private-case");
  assert.deepEqual(rows.map(({ key, value }) => [key, value]), [["X-Data", "new-private-secret"]]);
  await updateMcpServer(options, {
    name: "private-case", sourceId, config: { transport: "streamable-http" },
    credentials: [{ location: "headers", key: "x-data", action: "delete" }],
  });
  auth = JSON.parse(await readFile(authPath, "utf8"));
  rows = Object.values(auth.credentials).filter(({ server }) => server === "private-case");
  assert.deepEqual(rows, []);
  assert.deepEqual((await loadMcpConfiguration(options)).servers.get("private-case").config.headers, undefined);

  let resolveHeader;
  const observedHeader = new Promise((resolve) => { resolveHeader = resolve; });
  const server = createServer((request, response) => {
    if (request.url !== "/bearer") resolveHeader(request.headers["x-data"]);
    response.writeHead(500, request.url === "/bearer" ? "token-fragment" : "new%20private%2Fsecret", { "Content-Type": "text/plain" });
    response.end("fixture failure");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await addMcpServer(options, {
    target: "global", name: "hydrated-case",
    config: { type: "remote", url: `http://127.0.0.1:${port}/mcp`, headers: { "x-data": "old-inline-secret" } },
    credentials: [{ location: "headers", key: "X-Data", action: "replace", value: "new private/secret" }],
  });
  const hydratedSource = (await readMcpSettings(options)).servers.find(({ name }) => name === "hydrated-case").source.id;
  const result = await testMcpServerConnection(options, { name: "hydrated-case", sourceId: hydratedSource, timeoutMs: 2_000 });
  assert.equal(await observedHeader, "new private/secret");
  assert.equal(result.error.includes("new private/secret"), false);
  assert.equal(result.error.includes("new%20private%2Fsecret"), false);

  await addMcpServer(options, {
    target: "global", name: "bearer-fragment",
    config: { type: "remote", url: `http://127.0.0.1:${port}/bearer` },
    credentials: [{ location: "headers", key: "Authorization", action: "replace", value: "Bearer token-fragment" }],
  });
  const bearerSource = (await readMcpSettings(options)).servers.find(({ name }) => name === "bearer-fragment").source.id;
  const bearerResult = await testMcpServerConnection(options, { name: "bearer-fragment", sourceId: bearerSource, timeoutMs: 2_000 });
  assert.equal(bearerResult.error.includes("token-fragment"), false);
});

test("global is the default add target when project configuration is excluded", async (t) => {
  const { options } = await fixture(t, { includeProject: false });
  await addMcpServer(options, { name: "global", config: localConfig() });
  assert.match(await readFile(path.join(options.agentDirectory, "mcp.json"), "utf8"), /"global"/);
});

test("locked concurrent mutations do not lose either server", async (t) => {
  const { options } = await fixture(t);
  await Promise.all([
    addMcpServer(options, { name: "first", config: localConfig("one") }),
    addMcpServer(options, { name: "second", config: localConfig("two") }),
  ]);
  assert.deepEqual((await readMcpSettings(options)).servers.map(({ name }) => name), ["first", "second"]);
});

test("rollback refuses to overwrite a later successful mutation", async (t) => {
  const { options } = await fixture(t);
  const first = await addMcpServer(options, { name: "first", config: localConfig("one") });
  await addMcpServer(options, { name: "second", config: localConfig("two") });
  await assert.rejects(first.rollback(), (error) => error.code === "MCP_ROLLBACK_CONFLICT");
  assert.deepEqual((await readMcpSettings(options)).servers.map(({ name }) => name), ["first", "second"]);
});

test("private credentials merge at runtime, remain mode 0600, and never enter config or snapshots", async (t) => {
  const { options, authPath } = await fixture(t);
  const secret = "distinct-private-token";
  await addMcpServer(options, {
    name: "remote",
    config: { type: "remote", url: "https://mcp.example.test/rpc", headers: { "x-team": "docs" } },
    credentials: [{ location: "headers", key: "Authorization", action: "replace", value: secret }],
  });

  const configPath = path.join(options.cwd, ".pi", "mcp.json");
  assert.equal((await readFile(configPath, "utf8")).includes(secret), false);
  if (process.platform !== "win32") assert.equal((await stat(authPath)).mode & 0o777, 0o600);
  const snapshot = await readMcpSettings(options);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.equal(JSON.stringify(snapshot).includes(authPath), false);
  assert.deepEqual(snapshot.servers[0].config.headers.find(({ key }) => key === "Authorization"), {
    key: "Authorization", private: true, configured: true,
  });

  const loaded = await loadMcpConfiguration(options);
  assert.equal(loaded.servers.get("remote").config.headers.Authorization, secret);
});

test("one update can preserve masked fields, edit values, and rename atomically", async (t) => {
  const { options } = await fixture(t);
  const command = path.join(options.cwd, "private", "server-command");
  await writeJson(path.join(options.agentDirectory, "mcp.json"), { mcp: {
    original: { type: "local", command: [command, "--serve"], environment: { ORDINARY: "before", KEEP: "yes" }, enabled: true, unknown: { keep: true } },
  } });
  const server = (await readMcpSettings(options)).servers[0];
  assert.equal(server.config.commandMasked, true);
  assert.equal(server.config.envField, "environment");

  await updateMcpServer(options, {
    name: "original",
    sourceId: server.source.id,
    newName: "renamed",
    config: { transport: "stdio", disabled: true, environment: { ORDINARY: "after" } },
    credentials: [],
    clearFields: ["url", "headers"],
    clearValues: [],
  });
  const text = await readFile(path.join(options.agentDirectory, "mcp.json"), "utf8");
  assert.match(text, /"renamed"/);
  assert.match(text, /server-command/);
  assert.match(text, /"ORDINARY": "after"/);
  assert.match(text, /"KEEP": "yes"/);
  assert.match(text, /"enabled": false/);
  assert.doesNotMatch(text, /"disabled"/);
  assert.match(text, /"unknown": \{\s*"keep": true/);
});

test("rename transfers credentials atomically and rollback restores exact files", async (t) => {
  const { options, authPath } = await fixture(t);
  await addMcpServer(options, {
    name: "old-name",
    config: { type: "local", command: ["server"], env: {} },
    credentials: [{ location: "env", key: "API_TOKEN", action: "replace", value: "rename-secret" }],
  });
  const configPath = path.join(options.cwd, ".pi", "mcp.json");
  const beforeConfig = await readFile(configPath, "utf8");
  const beforeAuth = await readFile(authPath, "utf8");

  const transaction = await renameMcpServer(options, { name: "old-name", newName: "new-name" });
  const renamed = await loadMcpConfiguration(options);
  assert.equal(renamed.servers.has("old-name"), false);
  assert.equal(renamed.servers.get("new-name").config.env.API_TOKEN, "rename-secret");
  assert.equal((await readFile(authPath, "utf8")).includes('"server": "old-name"'), false);

  await transaction.rollback();
  assert.equal(await readFile(configPath, "utf8"), beforeConfig);
  assert.equal(await readFile(authPath, "utf8"), beforeAuth);
});

test("remove deletes only the effective source and reports the revealed lower definition", async (t) => {
  const { options } = await fixture(t);
  await writeJson(path.join(options.agentDirectory, "mcp.json"), { mcp: { shared: localConfig("lower") } });
  await writeJson(path.join(options.cwd, ".mcp.json"), { mcp: { shared: localConfig("higher") } });
  const sourceId = (await readMcpSettings(options)).servers.find(({ name }) => name === "shared").source.id;

  const transaction = await removeMcpServer(options, { name: "shared", sourceId, deleteCredentials: false });
  assert.equal(transaction.revealed.config.command[0], "lower");
  assert.equal(transaction.revealed.source.scope, "agent");
  assert.match(await readFile(path.join(options.agentDirectory, "mcp.json"), "utf8"), /"shared"/);
  assert.doesNotMatch(await readFile(path.join(options.cwd, ".mcp.json"), "utf8"), /"shared"/);
});

test("removal explicitly keeps or deletes private credentials", async (t) => {
  const { options, authPath } = await fixture(t);
  const request = {
    name: "credential-owner",
    config: { type: "local", command: ["server"], env: {} },
    credentials: [{ location: "env", key: "API_TOKEN", action: "replace", value: "kept-secret" }],
  };
  await addMcpServer(options, request);
  await removeMcpServer(options, { name: request.name, deleteCredentials: false });
  assert.match(await readFile(authPath, "utf8"), /kept-secret/);
  await addMcpServer(options, { name: request.name, config: request.config });
  assert.equal((await loadMcpConfiguration(options)).servers.get(request.name).config.env.API_TOKEN, "kept-secret");
  await removeMcpServer(options, { name: request.name, deleteCredentials: true });
  assert.doesNotMatch(await readFile(authPath, "utf8"), /kept-secret/);
});

test("shadowed definitions cannot be mutated directly", async (t) => {
  const { options } = await fixture(t);
  await writeJson(path.join(options.agentDirectory, "mcp.json"), { mcp: { shared: localConfig("lower") } });
  await writeJson(path.join(options.cwd, ".mcp.json"), { mcp: { shared: localConfig("higher") } });
  const snapshot = await readMcpSettings(options);
  const lowerSourceId = snapshot.servers[0].definitions.find(({ effective }) => !effective).source.id;
  await assert.rejects(
    removeMcpServer(options, { name: "shared", sourceId: lowerSourceId, deleteCredentials: true }),
    (error) => error.code === "MCP_SOURCE_SHADOWED",
  );
});

test("managed entries are toggle-only and preserve their enabled alias", async (t) => {
  const { options } = await fixture(t);
  const configPath = path.join(options.agentDirectory, "mcp.json");
  await writeJson(configPath, { mcp: { browser: { ...localConfig("managed"), piWorkbenchManaged: true } } });
  const sourceId = (await readMcpSettings(options)).servers[0].source.id;

  await assert.rejects(removeMcpServer(options, { name: "browser", sourceId, deleteCredentials: true }), (error) => error.code === "MCP_MANAGED_SERVER");
  await assert.rejects(updateMcpServer(options, { name: "browser", sourceId, config: localConfig("changed") }), (error) => error.code === "MCP_MANAGED_SERVER");
  await toggleMcpServer(options, { name: "browser", sourceId, enabled: false });
  const raw = JSON.parse(await readFile(configPath, "utf8")).mcp.browser;
  assert.equal(raw.enabled, false);
  assert.equal(raw.disabled, undefined);
  assert.equal(raw.piWorkbenchManaged, true);
});

test("a shadowed installer-managed name remains protected at higher precedence", async (t) => {
  const { options } = await fixture(t);
  await writeJson(path.join(options.agentDirectory, "mcp.json"), { mcp: { browser: { ...localConfig("managed"), piWorkbenchManaged: true } } });
  await writeJson(path.join(options.agentDirectory, "mcp.jsonc"), { mcp: { browser: localConfig("override") } });
  const server = (await readMcpSettings(options)).servers[0];
  assert.equal(server.config.managed, true);
  assert.equal(server.config.command[0], "override");
  await assert.rejects(removeMcpServer(options, { name: "browser", sourceId: server.source.id, deleteCredentials: true }),
    (error) => error.code === "MCP_MANAGED_SERVER");
  await toggleMcpServer(options, { name: "browser", sourceId: server.source.id, enabled: false });
});

test("inline credential migration is explicit and update never migrates automatically", async (t) => {
  const { options, authPath } = await fixture(t);
  const configPath = path.join(options.agentDirectory, "mcp.json");
  await writeJson(configPath, { mcp: { legacy: { type: "local", command: ["server"], env: { API_TOKEN: "legacy-secret" } } } });
  let snapshot = await readMcpSettings(options);
  const sourceId = snapshot.servers[0].source.id;
  assert.equal(snapshot.servers[0].config.env[0].inline, true);
  assert.equal(JSON.stringify(snapshot).includes("legacy-secret"), false);

  await updateMcpServer(options, { name: "legacy", sourceId, config: { type: "local", command: ["server"], disabled: false } });
  assert.match(await readFile(configPath, "utf8"), /legacy-secret/);
  await toggleMcpServer(options, { name: "legacy", sourceId, enabled: false });
  assert.match(await readFile(configPath, "utf8"), /legacy-secret/);
  await assert.rejects(migrateInlineMcpSecrets(options, { name: "legacy", sourceId, keys: [] }), /Explicit inline/);
  await migrateInlineMcpSecrets(options, { name: "legacy", sourceId, keys: [{ location: "env", key: "API_TOKEN" }] });
  assert.equal((await readFile(configPath, "utf8")).includes("legacy-secret"), false);
  assert.equal((await readFile(authPath, "utf8")).includes("legacy-secret"), true);
  assert.equal((await loadMcpConfiguration(options)).servers.get("legacy").config.env.API_TOKEN, "legacy-secret");
});

test("credential-like values require private storage and insecure remote credentials are rejected", async (t) => {
  const { options } = await fixture(t);
  await assert.rejects(addMcpServer(options, {
    name: "inline",
    config: { type: "local", command: ["server"], env: { API_TOKEN: "secret" } },
  }), /private credentials/);
  await addMcpServer(options, { name: "editable", config: localConfig() });
  await assert.rejects(updateMcpServer(options, {
    name: "editable",
    config: { type: "local", command: ["server"], env: { API_TOKEN: "new-inline-secret" } },
  }), /private credentials/);
  await assert.rejects(addMcpServer(options, {
    name: "nested-command-secret",
    config: { type: "local", command: ["server", "--header=Authorization: Bearer nested-secret"] },
  }), /Credential-like command arguments/);
  await assert.rejects(addMcpServer(options, {
    name: "insecure",
    config: { type: "remote", url: "http://example.test/mcp", headers: {} },
    credentials: [{ location: "headers", key: "Authorization", action: "replace", value: "secret" }],
  }), /require HTTPS/);
  await assert.rejects(addMcpServer(options, {
    name: "insecure-arbitrary-private",
    config: { type: "remote", url: "http://example.test/mcp", headers: {} },
    credentials: [{ location: "headers", key: "X-Data", action: "replace", value: "explicit-private-secret" }],
  }), /require HTTPS/);
  await addMcpServer(options, {
    name: "loopback",
    config: { type: "remote", url: "http://127.0.0.1:3000/mcp", headers: {} },
    credentials: [{ location: "headers", key: "Authorization", action: "replace", value: "secret" }],
  });
  await addMcpServer(options, {
    name: "preserved",
    config: { type: "remote", url: "https://example.test/mcp", headers: {} },
    credentials: [{ location: "headers", key: "Authorization", action: "replace", value: "secret" }],
  });
  await assert.rejects(updateMcpServer(options, {
    name: "preserved",
    config: { type: "remote", url: "http://example.test/mcp", headers: {} },
  }), /require HTTPS/);
});

test("live connection testing uses the MCP SDK with a bounded stdio lifecycle", async (t) => {
  const { root, options } = await fixture(t);
  const serverPath = path.join(root, "fixture-server.mjs");
  await writeFile(serverPath, `
    import readline from "node:readline";
    const input = readline.createInterface({ input: process.stdin });
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    input.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: {}, serverInfo: { name: "test", version: "1" } } });
      if (message.method === "tools/list") send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
    });
  `);
  await addMcpServer(options, { name: "live", config: { type: "local", command: [process.execPath, serverPath] } });
  assert.equal(JSON.stringify(await readMcpSettings(options)).includes(root), false);
  assert.deepEqual(await testMcpServerConnection(options, { name: "live", timeoutMs: 3000 }), {
    ok: true, kind: "live", server: "live", transport: "stdio", toolCount: 1,
  });
});

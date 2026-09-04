import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { routeMcpAction } from "../extensions/mcp/action-router.ts";
import {
  loadMcpConfiguration,
  safeConfigurationSummary,
} from "../extensions/mcp/config.ts";
import { searchMcpTools } from "../extensions/mcp/discovery.ts";
import { McpHub } from "../extensions/mcp/hub.ts";
import { isCachedMetadataFresh } from "../extensions/mcp/metadata-cache.ts";
import { guardMcpOutput } from "../extensions/mcp/output-guard.ts";
import { playwrightMcpArgsWithTemporaryOutput } from "../extensions/mcp/playwright-policy.ts";
import { redactServerSecrets } from "../extensions/mcp/security.ts";

async function writeJson(filePath, document) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(document), "utf8");
}

async function stdioServerFixture(environment = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-stdio-"));
  const agentDirectory = join(root, "agent");
  const serverPath = join(root, "server.mjs");
  await writeFile(serverPath, `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
const listDelay = Number(process.env.LIST_DELAY_MS || 0);
const emitListChanged = process.env.EMIT_LIST_CHANGED === "1";
const exposeBrowserTabs = process.env.EXPOSE_BROWSER_TABS === "1";
let generation = 0;
let notificationSent = false;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

lines.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "fixture", version: "1.0.0" }
    } });
    return;
  }
  if (message.method === "tools/list") {
    if (listDelay) await new Promise((resolve) => setTimeout(resolve, listDelay));
    const cursor = message.params?.cursor;
    if (!cursor) {
      const tools = generation === 0 ? [
        { name: "required_task", inputSchema: { type: "object" }, execution: { taskSupport: "required" } },
        { name: "structured", inputSchema: { type: "object" }, outputSchema: {
          type: "object", properties: { count: { type: "number" } }, required: ["count"]
        } },
        ...(exposeBrowserTabs ? [{ name: "browser_tabs", inputSchema: { type: "object" } }] : [])
      ] : [{ name: "refreshed", inputSchema: { type: "object" } }];
      send({ jsonrpc: "2.0", id: message.id, result: { tools, nextCursor: generation === 0 ? "page-2" : undefined } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [
      { name: "echo", description: "Echo text", inputSchema: {
        type: "object", properties: { text: { type: "string" } }, required: ["text"]
      } }
    ] } });
    if (emitListChanged && !notificationSent) {
      notificationSent = true;
      generation = 1;
      setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }), 25);
    }
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params.name;
    if (name === "echo") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: message.params.arguments.text }] } });
      return;
    }
    if (name === "structured") {
      send({ jsonrpc: "2.0", id: message.id, result: {
        content: [{ type: "text", text: "invalid" }], structuredContent: { count: "wrong" }
      } });
      return;
    }
    if (name === "browser_tabs" && message.params.arguments.action === "new") {
      fs.appendFileSync(process.env.BROWSER_CLAIM_LOG, "new\\n");
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "claimed" }] } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "unexpected call" }] } });
  }
});
`, "utf8");
  const browserClaimLog = join(root, "browser-claim.log");
  const command = [process.execPath, serverPath];
  const resolvedEnvironment = { ...environment };
  if (environment.EXPOSE_BROWSER_TABS === "1") {
    command.push(join(root, "pi-browser-mcp.ps1"));
    resolvedEnvironment.BROWSER_CLAIM_LOG = browserClaimLog;
  }
  await writeJson(join(agentDirectory, "mcp.json"), {
    mcp: {
      fixture: {
        type: "local",
        command,
        environment: resolvedEnvironment,
      },
    },
  });
  return { root, agentDirectory, browserClaimLog };
}

async function configFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  const agentDirectory = join(root, "agent");
  const cwd = join(root, "project");
  await writeJson(join(homeDirectory, ".config", "mcp", "mcp.json"), {
    mcpServers: {
      shared: { command: "global-command", env: { TOKEN: "global-secret" } },
      globalOnly: { command: "global-only" },
    },
  });
  await writeJson(join(agentDirectory, "mcp.json"), {
    servers: {
      shared: { command: "agent-command", env: { API_KEY: "agent-secret" } },
      agentOnly: { command: "agent-only" },
    },
  });
  await writeJson(join(cwd, ".mcp.json"), {
    mcpServers: {
      shared: { command: "project-command", env: { PASSWORD: "project-secret" } },
      projectOnly: { command: "project-only" },
    },
  });
  await writeJson(join(cwd, ".pi", "mcp.json"), {
    mcpServers: {
      shared: {
        type: "streamable-http",
        url: "https://mcp.example.test/rpc?version=1",
        headers: { Authorization: "Bearer header-secret" },
      },
    },
  });
  return { homeDirectory, agentDirectory, cwd };
}

test("MCP config merges standard locations in precedence order without leaking secrets", async (t) => {
  const fixture = await configFixture(t);
  const configuration = await loadMcpConfiguration({ ...fixture, includeProject: true });

  assert.deepEqual([...configuration.servers.keys()].sort(), [
    "agentOnly",
    "globalOnly",
    "projectOnly",
    "shared",
  ]);
  const shared = configuration.servers.get("shared");
  assert.equal(shared?.config.transport, "streamable-http");
  assert.equal(shared?.sourcePath, join(fixture.cwd, ".pi", "mcp.json"));

  const safeSummary = JSON.stringify(safeConfigurationSummary(configuration));
  for (const secret of [
    "global-secret",
    "agent-secret",
    "project-secret",
    "url-secret",
    "header-secret",
  ]) {
    assert.equal(safeSummary.includes(secret), false);
  }
  const redactedError = redactServerSecrets(
    "request token=url-secret failed with header-secret",
    shared,
  );
  assert.equal(redactedError.includes("url-secret"), false);
  assert.equal(redactedError.includes("header-secret"), false);

  const untrustedConfiguration = await loadMcpConfiguration({
    ...fixture,
    includeProject: false,
  });
  assert.equal(untrustedConfiguration.servers.get("shared")?.config.transport, "stdio");
  assert.equal(
    untrustedConfiguration.servers.get("shared")?.sourcePath,
    join(fixture.agentDirectory, "mcp.json"),
  );
  assert.equal(untrustedConfiguration.servers.has("projectOnly"), false);
});

test("MCP redaction covers encoded secrets without corrupting benign short values", () => {
  const remoteDefinition = {
    name: "remote",
    sourcePath: "fixture",
    sourceDirectory: ".",
    fingerprint: "fixture",
    config: {
      transport: "streamable-http",
      url: "https://example.test/api/encoded%20secret?value=long%2Fsecret%2Fvalue",
      headers: {},
      disabled: false,
      oauthConfigured: false,
    },
  };
  const encodedOutput = redactServerSecrets(
    "request encoded%20secret failed with long%2fsecret%2fvalue",
    remoteDefinition,
  );
  assert.equal(encodedOutput.includes("encoded%20secret"), false);
  assert.equal(encodedOutput.includes("long%2fsecret%2fvalue"), false);

  const localDefinition = {
    ...remoteDefinition,
    config: {
      transport: "stdio",
      command: "fixture",
      args: ['"--credential=quoted-credential-secret"', "--cookie:cookie-secret-value", "--auth", "auth-secret-value", "--header=Authorization: Bearer nested-auth-secret"],
      env: { OAUTH_ENABLED: "false", DEBUG: "1", API_TOKEN: "distinct-secret-value" },
      disabled: false,
      oauthConfigured: false,
    },
  };
  const localOutput = redactServerSecrets(
    '{"available":false,"version":"1.30.0","secret":"distinct-secret-value","credential":"quoted-credential-secret","cookie":"cookie-secret-value","auth":"auth-secret-value"}',
    localDefinition,
  );
  assert.match(localOutput, /"available":false/);
  assert.match(localOutput, /"version":"1\.30\.0"/);
  assert.equal(localOutput.includes("distinct-secret-value"), false);
  assert.equal(localOutput.includes("quoted-credential-secret"), false);
  assert.equal(localOutput.includes("cookie-secret-value"), false);
  assert.equal(localOutput.includes("auth-secret-value"), false);
  assert.equal(redactServerSecrets("nested-auth-secret", localDefinition).includes("nested-auth-secret"), false);

  const privateDefinition = {
    ...remoteDefinition,
    privateSecretValues: ["secret123", "short"],
  };
  const privateOutput = redactServerSecrets("server echoed secret123 and short", privateDefinition);
  assert.equal(privateOutput.includes("secret123"), false);
  assert.equal(privateOutput.includes("short"), false);
});

test("MCP config accepts JSONC and OpenCode-style server entries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-jsonc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDirectory = join(root, "agent");
  const sourcePath = join(agentDirectory, "mcp.jsonc");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(sourcePath, `{
    // OpenCode-compatible MCP shape
    "mcp": {
      "local-tools": {
        "type": "local",
        "command": ["npx", "-y", "example-mcp"],
        "environment": { "LOCAL_TOKEN": "local-secret" },
        "enabled": false,
      },
      "remote-tools": {
        "type": "remote",
        "url": "https://mcp.example.test/rpc",
        "headers": { "Authorization": "Bearer remote-secret" },
      },
    },
  }`, "utf8");

  const configuration = await loadMcpConfiguration({
    cwd: join(root, "project"),
    homeDirectory: join(root, "home"),
    agentDirectory,
    includeProject: false,
  });

  assert.deepEqual(configuration.servers.get("local-tools")?.config, {
    transport: "stdio",
    command: "npx",
    args: ["-y", "example-mcp"],
    env: { LOCAL_TOKEN: "local-secret" },
    cwd: undefined,
    disabled: true,
    oauthConfigured: false,
  });
  assert.deepEqual(configuration.servers.get("remote-tools")?.config, {
    transport: "streamable-http",
    url: "https://mcp.example.test/rpc",
    headers: { Authorization: "Bearer remote-secret" },
    disabled: false,
    oauthConfigured: false,
  });
  assert.deepEqual(configuration.loadedSources, [sourcePath]);
});

test("credential headers require HTTPS except on loopback MCP servers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-http-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDirectory = join(root, "agent");
  await writeJson(join(agentDirectory, "mcp.json"), {
    mcp: {
      insecure: {
        type: "remote",
        url: "http://example.test/mcp",
        headers: { Authorization: "Bearer distinct-secret-value" },
      },
      xAuthInsecure: {
        type: "remote",
        url: "http://example.test/mcp",
        headers: { "X-Auth": "distinct-x-auth-secret" },
      },
      userinfo: { type: "remote", url: "https://user:pass@example.test/mcp" },
      querySecret: { type: "remote", url: "https://example.test/mcp?token=distinct-query-secret" },
      loopback: {
        type: "remote",
        url: "http://127.0.0.1:3000/mcp",
        headers: { Authorization: "Bearer local-secret-value" },
      },
    },
  });

  const configuration = await loadMcpConfiguration({
    cwd: root,
    homeDirectory: join(root, "home"),
    agentDirectory,
    includeProject: false,
  });
  assert.equal(configuration.servers.has("insecure"), false);
  assert.equal(configuration.servers.has("xAuthInsecure"), false);
  assert.equal(configuration.servers.has("userinfo"), false);
  assert.equal(configuration.servers.has("querySecret"), false);
  assert.equal(configuration.servers.has("loopback"), true);
  const diagnostics = configuration.diagnostics.map(({ message }) => message).join("\n");
  assert.match(diagnostics, /credential headers require HTTPS/);
  assert.match(diagnostics, /must not include credentials/);
  assert.match(diagnostics, /credential-like URL parameters/);
});

test("Playwright MCP output defaults to a temporary artifact directory", () => {
  const outputDirectory = join(tmpdir(), "pi-playwright-policy-test");
  assert.deepEqual(
    playwrightMcpArgsWithTemporaryOutput(
      "npx",
      ["-y", "@playwright/mcp@latest", "--browser", "msedge"],
      outputDirectory,
    ),
    [
      "-y",
      "@playwright/mcp@latest",
      "--browser",
      "msedge",
      "--output-dir",
      outputDirectory,
    ],
  );
  assert.deepEqual(
    playwrightMcpArgsWithTemporaryOutput(
      "C:/tools/playwright-mcp.cmd",
      ["--browser", "msedge"],
      outputDirectory,
    ),
    [
      "--browser",
      "msedge",
      "--output-dir",
      outputDirectory,
    ],
  );
  assert.deepEqual(
    playwrightMcpArgsWithTemporaryOutput(
      "npx",
      ["@playwright/mcp", "--output-dir", "D:/explicit", "--output-mode=file"],
      outputDirectory,
    ),
    ["@playwright/mcp", "--output-dir", "D:/explicit", "--output-mode=file"],
  );
  assert.deepEqual(
    playwrightMcpArgsWithTemporaryOutput("npx", ["example-mcp"], outputDirectory),
    ["example-mcp"],
  );
});

test("global MCP search does not connect idle servers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-idle-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDirectory = join(root, "agent");
  await writeJson(join(agentDirectory, "mcp.json"), {
    mcp: {
      idle: {
        type: "local",
        command: ["definitely-missing-mcp-command"],
      },
    },
  });

  const hub = new McpHub(agentDirectory);
  t.after(() => hub.closeAll());
  await hub.startSession(root, false);

  assert.deepEqual(await hub.searchTools("anything"), []);
  assert.equal(hub.serverSummaries()[0]?.state, "disconnected");
});

test("stdio startup errors include bounded redacted server stderr", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-stderr-"));
  const agentDirectory = join(root, "agent");
  await writeJson(join(agentDirectory, "mcp.json"), {
    mcp: {
      failing: {
        type: "local",
        command: [
          process.execPath,
          "-e",
          'process.stderr.write("visible launch detail distinct-secret-value"); process.exit(1)',
        ],
        environment: { API_TOKEN: "distinct-secret-value" },
      },
    },
  });
  const hub = new McpHub(agentDirectory);
  t.after(async () => {
    await hub.closeAll();
    await rm(root, { recursive: true, force: true });
  });
  await hub.startSession(root, false);

  await assert.rejects(hub.connectServer("failing"), (error) => {
    assert.match(error.message, /visible launch detail/);
    assert.equal(error.message.includes("distinct-secret-value"), false);
    return true;
  });
});

test("the newest concurrent MCP session controls project trust and configuration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-session-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDirectory = join(root, "agent");
  const trustedProject = join(root, "trusted");
  const untrustedProject = join(root, "untrusted");
  await writeJson(join(agentDirectory, "mcp.json"), {
    mcp: { global: { type: "local", command: ["global-command"] } },
  });
  await writeJson(join(trustedProject, ".mcp.json"), {
    mcp: { projectOnly: { type: "local", command: ["project-command"] } },
  });
  await mkdir(untrustedProject, { recursive: true });

  const hub = new McpHub(agentDirectory);
  t.after(() => hub.closeAll());
  const trustedStart = hub.startSession(trustedProject, true);
  await new Promise((resolve) => setImmediate(resolve));
  const untrustedStart = hub.startSession(untrustedProject, false);
  await Promise.all([trustedStart, untrustedStart]);

  assert.deepEqual(hub.serverSummaries().map(({ name }) => name), ["global"]);
});

test("caller cancellation does not abort another shared MCP connection", async (t) => {
  const fixture = await stdioServerFixture({ LIST_DELAY_MS: "150" });
  const hub = new McpHub(fixture.agentDirectory);
  t.after(async () => {
    await hub.closeAll();
    await rm(fixture.root, { recursive: true, force: true });
  });
  await hub.startSession(fixture.root, false);
  const firstAbort = new AbortController();
  const firstConnection = hub.connectServer("fixture", firstAbort.signal);
  const secondConnection = hub.connectServer("fixture");
  firstAbort.abort();

  await assert.rejects(firstConnection, { name: "AbortError" });
  assert.equal((await secondConnection).length, 3);
  assert.equal(hub.serverSummaries()[0]?.state, "connected");
});

test("a managed shared browser claims a new tab when it connects", async (t) => {
  const fixture = await stdioServerFixture({ EXPOSE_BROWSER_TABS: "1" });
  const hub = new McpHub(fixture.agentDirectory);
  t.after(async () => {
    await hub.closeAll();
    await rm(fixture.root, { recursive: true, force: true });
  });
  await hub.startSession(fixture.root, false);

  const tools = await hub.connectServer("fixture");

  assert.equal(tools.some(({ name }) => name === "browser_tabs"), true);
  assert.equal(await readFile(fixture.browserClaimLog, "utf8"), "new\n");
});

test("MCP stdio lifecycle preserves paginated metadata and validates calls", async (t) => {
  const fixture = await stdioServerFixture();
  const hub = new McpHub(fixture.agentDirectory);
  await hub.startSession(fixture.root, false);

  const tools = await hub.connectServer("fixture");
  assert.equal(tools.length, 3);
  assert.equal(tools.find(({ name }) => name === "required_task")?.execution?.taskSupport, "required");
  assert.equal(tools.find(({ name }) => name === "structured")?.outputSchema?.type, "object");
  assert.deepEqual(await hub.callTool("fixture", "echo", { text: "hello" }), { text: "hello", isError: false });
  await assert.rejects(hub.callTool("fixture", "required_task", {}), /requires task-based execution/);
  await assert.rejects(hub.callTool("fixture", "structured", {}), /invalid structured content/);
  await hub.disconnectServer("fixture");
  assert.equal(hub.serverSummaries()[0]?.state, "disconnected");

  const cachedHub = new McpHub(fixture.agentDirectory);
  t.after(async () => {
    await cachedHub.closeAll();
    await hub.closeAll();
    await rm(fixture.root, { recursive: true, force: true });
  });
  await cachedHub.startSession(fixture.root, false);
  assert.equal(cachedHub.peekTools("fixture").find(({ name }) => name === "structured")?.outputSchema?.type, "object");
});

test("connected MCP servers refresh metadata after a tool-list notification", async (t) => {
  const fixture = await stdioServerFixture({ EMIT_LIST_CHANGED: "1" });
  const hub = new McpHub(fixture.agentDirectory);
  t.after(async () => {
    await hub.closeAll();
    await rm(fixture.root, { recursive: true, force: true });
  });
  await hub.startSession(fixture.root, false);
  await hub.connectServer("fixture");

  for (let attempt = 0; attempt < 40 && !hub.peekTools("fixture").some(({ name }) => name === "refreshed"); attempt += 1) {
    await delay(25);
  }
  assert.deepEqual(hub.peekTools("fixture").map(({ name }) => name), ["refreshed"]);
});

test("fuzzy discovery ranks abbreviated tool intent above unrelated tools", () => {
  const matches = searchMcpTools(
    [
      {
        server: "github",
        tools: [
          {
            name: "create_github_issue",
            description: "Create a repository issue",
            inputSchema: { type: "object" },
          },
          {
            name: "list_pull_requests",
            description: "List repository pull requests",
            inputSchema: { type: "object" },
          },
        ],
      },
      {
        server: "files",
        tools: [
          {
            name: "read_file",
            description: "Read local text",
            inputSchema: { type: "object" },
          },
        ],
      },
    ],
    "gthb isue",
  );

  assert.equal(matches[0]?.server, "github");
  assert.equal(matches[0]?.name, "create_github_issue");
  assert.equal(matches.some((match) => match.name === "read_file"), false);
});

test("output guard preserves full text privately and returns a byte-safe compact prefix", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fullText = "αβγ\nsecond line\nthird line";

  const guarded = await guardMcpOutput(fullText, {
    outputDirectory: root,
    label: "server/tool",
    maxBytes: 12,
    maxLines: 2,
  });

  assert.equal(guarded.truncated, true);
  assert.ok(guarded.fullOutputPath?.startsWith(root));
  assert.equal(await readFile(guarded.fullOutputPath, "utf8"), fullText);
  assert.equal(guarded.spillTruncated, false);
  assert.equal(guarded.text.includes("�"), false);
  assert.match(guarded.text, /Output truncated/);
});

test("output guard bounds private spill files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-mcp-spill-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const guarded = await guardMcpOutput("αβγδεζηθ", {
    outputDirectory: root,
    label: "bounded",
    maxBytes: 4,
    maxSpillBytes: 10,
  });

  assert.equal(guarded.spillTruncated, true);
  assert.equal(Buffer.byteLength(await readFile(guarded.fullOutputPath, "utf8"), "utf8"), 10);
  assert.match(guarded.text, /Saved output prefix/);
});

test("metadata cache freshness is bounded", () => {
  const now = Date.now();
  assert.equal(isCachedMetadataFresh({ fingerprint: "x", updatedAt: new Date(now).toISOString(), tools: [] }, now), true);
  assert.equal(
    isCachedMetadataFresh({ fingerprint: "x", updatedAt: new Date(now - 25 * 60 * 60 * 1_000).toISOString(), tools: [] }, now),
    false,
  );
  assert.equal(isCachedMetadataFresh({ fingerprint: "x", updatedAt: "invalid", tools: [] }, now), false);
});

test("action router validates required fields and decodes call arguments", () => {
  assert.deepEqual(routeMcpAction({ action: "status" }), { action: "status" });
  assert.deepEqual(routeMcpAction({ action: "list", server: " github " }), {
    action: "list",
    server: "github",
  });
  assert.deepEqual(
    routeMcpAction({
      action: "call",
      server: "github",
      tool: "create_issue",
      args: '{"title":"Bug","labels":["urgent"]}',
    }),
    {
      action: "call",
      server: "github",
      tool: "create_issue",
      arguments: { title: "Bug", labels: ["urgent"] },
    },
  );

  assert.throws(
    () => routeMcpAction({ action: "call", server: "github", tool: "create_issue", args: "[]" }),
    /JSON object/,
  );
  assert.throws(() => routeMcpAction({ action: "search" }), /query is required/);
  assert.throws(() => routeMcpAction({ action: "reload", server: "github" }), /not used/);
});

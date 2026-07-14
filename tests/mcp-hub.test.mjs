import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { routeMcpAction } from "../extensions/mcp/action-router.ts";
import {
  loadMcpConfiguration,
  safeConfigurationSummary,
} from "../extensions/mcp/config.ts";
import { searchMcpTools } from "../extensions/mcp/discovery.ts";
import { McpHub } from "../extensions/mcp/hub.ts";
import { guardMcpOutput } from "../extensions/mcp/output-guard.ts";
import { redactServerSecrets } from "../extensions/mcp/security.ts";

async function writeJson(filePath, document) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(document), "utf8");
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
        url: "https://mcp.example.test/rpc?token=url-secret",
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
  assert.equal(guarded.text.includes("�"), false);
  assert.match(guarded.text, /Output truncated/);
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

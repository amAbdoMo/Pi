import type { RoutedMcpAction } from "./action-router.ts";
import type { McpHub } from "./hub.ts";
import type { McpServerSummary, McpToolMetadata } from "./types.ts";

export interface McpActionResponse {
	text: string;
	summary: string;
	server?: string;
	tool?: string;
	isError?: boolean;
}

export async function executeMcpAction(
	hub: McpHub,
	routedAction: RoutedMcpAction,
	signal?: AbortSignal,
): Promise<McpActionResponse> {
	signal?.throwIfAborted();
	switch (routedAction.action) {
		case "status":
			return statusResponse(hub);
		case "list":
			return routedAction.server
				? toolListResponse(hub, routedAction.server, signal)
				: serverListResponse(hub);
		case "search":
			return searchResponse(hub, routedAction.query, routedAction.server, signal);
		case "describe":
			return describeResponse(hub, routedAction.server, routedAction.tool, signal);
		case "call":
			return callResponse(hub, routedAction, signal);
		case "connect":
			return connectResponse(hub, routedAction.server, signal);
		case "disconnect":
			await hub.disconnectServer(routedAction.server);
			return { text: `Disconnected MCP server: ${routedAction.server}`, summary: "Server disconnected", server: routedAction.server };
		case "reload": {
			const summary = await hub.reload();
			return {
				text: `Reloaded MCP config: ${summary.serverCount} server(s), ${summary.diagnosticCount} diagnostic(s).`,
				summary: "MCP config reloaded",
			};
		}
	}
}

function statusResponse(hub: McpHub): McpActionResponse {
	const servers = hub.serverSummaries();
	const connected = servers.filter((server) => server.state === "connected").length;
	const toolCount = servers.reduce((total, server) => total + server.toolCount, 0);
	const diagnostics = hub.diagnostics();
	const lines = [
		`MCP: ${servers.length} configured, ${connected} connected, ${toolCount} discovered tool(s).`,
		...servers.map(serverStatusLine),
	];
	if (diagnostics.length > 0) lines.push(`${diagnostics.length} config/cache diagnostic(s); open /mcp for status.`);
	return { text: lines.join("\n"), summary: `${servers.length} servers · ${connected} connected` };
}

function serverListResponse(hub: McpHub): McpActionResponse {
	const servers = hub.serverSummaries();
	if (servers.length === 0) return { text: "No MCP servers are configured.", summary: "No MCP servers" };
	return {
		text: servers.map(serverStatusLine).join("\n"),
		summary: `${servers.length} MCP server(s)`,
	};
}

async function toolListResponse(hub: McpHub, server: string, signal?: AbortSignal): Promise<McpActionResponse> {
	const tools = await hub.toolsForServer(server, signal);
	const lines = tools.length > 0 ? tools.map(toolListLine) : ["(no tools advertised)"];
	return {
		text: `${server}: ${tools.length} tool(s)\n${lines.join("\n")}`,
		summary: `${tools.length} tool(s) on ${server}`,
		server,
	};
}

async function searchResponse(
	hub: McpHub,
	query: string,
	server: string | undefined,
	signal?: AbortSignal,
): Promise<McpActionResponse> {
	const matches = await hub.searchTools(query, server, signal);
	if (matches.length === 0) {
		return { text: `No MCP tools matched: ${query}`, summary: "No matching MCP tools", ...(server && { server }) };
	}
	const lines = matches.map((match) => `- ${match.server}/${match.name}${descriptionSuffix(match.description)}`);
	return {
		text: `${matches.length} match(es)\n${lines.join("\n")}`,
		summary: `${matches.length} matching MCP tool(s)`,
		...(server && { server }),
	};
}

async function describeResponse(
	hub: McpHub,
	server: string,
	toolName: string,
	signal?: AbortSignal,
): Promise<McpActionResponse> {
	const tool = await hub.describeTool(server, toolName, signal);
	const lines = [
		`${server}/${tool.name}`,
		tool.description?.trim() || "(no description)",
		annotationLine(tool),
		"Input schema:",
		JSON.stringify(tool.inputSchema, null, 2),
	].filter(Boolean);
	return { text: lines.join("\n"), summary: `Described ${server}/${tool.name}`, server, tool: tool.name };
}

async function callResponse(
	hub: McpHub,
	call: Extract<RoutedMcpAction, { action: "call" }>,
	signal?: AbortSignal,
): Promise<McpActionResponse> {
	const outcome = await hub.callTool(call.server, call.tool, call.arguments, signal);
	return {
		text: outcome.text,
		summary: `${outcome.isError ? "Failed" : "Called"} ${call.server}/${call.tool}`,
		server: call.server,
		tool: call.tool,
		isError: outcome.isError,
	};
}

async function connectResponse(hub: McpHub, server: string, signal?: AbortSignal): Promise<McpActionResponse> {
	const tools = await hub.connectServer(server, signal);
	return {
		text: `Connected MCP server ${server}; discovered ${tools.length} tool(s).`,
		summary: `Connected ${server}`,
		server,
	};
}

function serverStatusLine(server: McpServerSummary): string {
	const tools = server.toolCount > 0 ? ` · ${server.toolCount} tools` : "";
	const failure = server.error ? ` · ${compactDescription(server.error, 100)}` : "";
	return `- ${server.name} · ${server.state} · ${server.transport}${tools}${failure}`;
}

function toolListLine(tool: McpToolMetadata): string {
	return `- ${tool.name}${descriptionSuffix(tool.description)}`;
}

function descriptionSuffix(description: string | undefined): string {
	return description ? ` — ${compactDescription(description, 140)}` : "";
}

function compactDescription(description: string, maxLength: number): string {
	const compact = description.replace(/\s+/g, " ").trim();
	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function annotationLine(tool: McpToolMetadata): string {
	const hints: string[] = [];
	if (tool.annotations?.readOnlyHint) hints.push("read-only");
	if (tool.annotations?.destructiveHint) hints.push("destructive");
	if (tool.annotations?.idempotentHint) hints.push("idempotent");
	if (tool.annotations?.openWorldHint) hints.push("open-world");
	return hints.length > 0 ? `Hints: ${hints.join(", ")}` : "";
}

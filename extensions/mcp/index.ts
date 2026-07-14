import { join } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { MCP_ACTIONS, routeMcpAction, type McpToolInput } from "./action-router.ts";
import { executeMcpAction } from "./actions.ts";
import { resolvePiAgentDirectory } from "./config.ts";
import { McpHub } from "./hub.ts";
import { guardMcpOutput } from "./output-guard.ts";
import { McpHubOverlay } from "./overlay.ts";
import { publishMcpStatus } from "./status.ts";
import { withWorkbenchModal } from "../ui/modalState.ts";

interface McpToolDetails {
	action: McpToolInput["action"];
	summary: string;
	server?: string;
	tool?: string;
	truncated: boolean;
	fullOutputPath?: string;
}

const MCP_PARAMETERS = Type.Object(
	{
		action: StringEnum(MCP_ACTIONS, {
			description: "MCP Hub action: status, list, search, describe, call, connect, disconnect, or reload",
		}),
		server: Type.Optional(Type.String({ description: "Configured MCP server name" })),
		query: Type.Optional(Type.String({ description: "Fuzzy tool search query" })),
		tool: Type.Optional(Type.String({ description: "MCP tool name" })),
		args: Type.Optional(Type.String({ description: "Tool arguments encoded as a JSON object string" })),
	},
	{ additionalProperties: false },
);

export default function mcpHubExtension(pi: ExtensionAPI): void {
	const agentDirectory = resolvePiAgentDirectory();
	const hub = new McpHub(agentDirectory);
	const publishStatus = () => publishMcpStatus(hub.serverSummaries());
	const unsubscribeStatus = hub.subscribe(publishStatus);
	publishStatus();

	pi.registerTool({
		name: "mcp",
		label: "MCP Hub",
		description:
			"Discover, inspect, connect to, and call configured MCP servers through one low-context proxy. Use action=list with a server to list tools. Tool-call args must be a JSON object string. Output is guarded and large text spills to a private file.",
		promptSnippet: "Search and call configured Model Context Protocol servers through a low-context proxy",
		promptGuidelines: [
			"Use mcp search before describe or call when the server/tool name is unknown.",
			"Use mcp describe to inspect a tool schema before mcp call, and encode call args as a JSON object string.",
		],
		parameters: MCP_PARAMETERS,
		async execute(_toolCallId, params, signal) {
			const routedAction = routeMcpAction(params);
			const response = await executeMcpAction(hub, routedAction, signal);
			const guarded = await guardMcpOutput(response.text, {
				outputDirectory: join(agentDirectory, "mcp-output"),
				label: [response.server, response.tool ?? response.summary].filter(Boolean).join("-") || "mcp",
			});
			if (response.isError) throw new Error(guarded.text);
			return {
				content: [{ type: "text", text: guarded.text }],
				details: {
					action: params.action,
					summary: response.summary,
					server: response.server,
					tool: response.tool,
					truncated: guarded.truncated,
					fullOutputPath: guarded.fullOutputPath,
				} satisfies McpToolDetails,
			};
		},
		renderCall(args, theme) {
			const target = [args.server, args.tool].filter(Boolean).join("/");
			const suffix = target ? ` ${target}` : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("mcp ")) + theme.fg("accent", args.action) + theme.fg("muted", suffix),
				0,
				0,
			);
		},
		renderResult(toolResult, { expanded, isPartial }, theme, context) {
			if (isPartial) return new Text(theme.fg("warning", "MCP operation in progress…"), 0, 0);
			const details = toolResult.details as McpToolDetails | undefined;
			if (!details) {
				const firstPart = toolResult.content[0];
				const fallback = firstPart?.type === "text" ? compactRenderText(firstPart.text) : "MCP operation failed";
				return new Text(theme.fg(context.isError ? "error" : "muted", fallback), 0, 0);
			}
			let rendered = theme.fg("success", `✓ ${details.summary}`);
			if (details.truncated) rendered += theme.fg("warning", " · truncated");
			if (expanded) {
				const firstPart = toolResult.content[0];
				if (firstPart?.type === "text") {
					const preview = firstPart.text.split("\n").slice(0, 12).join("\n");
					rendered += `\n${theme.fg("toolOutput", preview)}`;
				}
			}
			return new Text(rendered, 0, 0);
		},
	});

	pi.registerCommand("mcp", {
		description: "Open the MCP server and tool hub",
		handler: async (_args, ctx) => openMcpOverlay(hub, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		await hub.startSession(ctx.cwd, ctx.isProjectTrusted());
	});

	pi.on("session_shutdown", async () => {
		unsubscribeStatus();
		await hub.closeAll();
		publishMcpStatus([]);
	});
}

function compactRenderText(text: string): string {
	const firstLine = text.split("\n")[0]?.trim() || "MCP response";
	return firstLine.length > 180 ? `${firstLine.slice(0, 179)}…` : firstLine;
}

async function openMcpOverlay(hub: McpHub, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/mcp requires interactive TUI mode", "error");
		return;
	}
	await withWorkbenchModal(() => ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) =>
			new McpHubOverlay(
				theme,
				hub,
				done,
				() => tui.requestRender(),
				() => Math.max(10, Math.floor(tui.terminal.rows * 0.82) - 4),
			),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "82%",
				maxHeight: "82%",
				margin: 1,
			},
			onHandle: (overlayHandle) => overlayHandle.focus(),
		},
	));
}

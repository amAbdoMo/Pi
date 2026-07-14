import type { McpServerSummary } from "./types.ts";

const MCP_STATUS_KEY = "__amabdomo_pi_mcp_status_v1";

interface SharedMcpStatus {
	servers: McpServerSummary[];
	listeners: Set<() => void>;
}

function sharedStatus(): SharedMcpStatus {
	const root = globalThis as typeof globalThis & {
		[MCP_STATUS_KEY]?: SharedMcpStatus;
	};
	root[MCP_STATUS_KEY] ??= { servers: [], listeners: new Set() };
	return root[MCP_STATUS_KEY];
}

export function publishMcpStatus(servers: readonly McpServerSummary[]): void {
	const status = sharedStatus();
	status.servers = servers.map((server) => ({ ...server }));
	for (const listener of status.listeners) listener();
}

export function getMcpStatus(): McpServerSummary[] {
	return sharedStatus().servers.map((server) => ({ ...server }));
}

export function subscribeMcpStatus(listener: () => void): () => void {
	const status = sharedStatus();
	status.listeners.add(listener);
	return () => status.listeners.delete(listener);
}

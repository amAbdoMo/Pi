export type McpTransportKind = "stdio" | "streamable-http";

interface BaseServerConfig {
	transport: McpTransportKind;
	disabled: boolean;
	oauthConfigured: boolean;
}

export interface StdioServerConfig extends BaseServerConfig {
	transport: "stdio";
	command: string;
	args: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface HttpServerConfig extends BaseServerConfig {
	transport: "streamable-http";
	url: string;
	headers?: Record<string, string>;
}

export type McpServerConfig = StdioServerConfig | HttpServerConfig;

export interface McpServerDefinition {
	name: string;
	config: McpServerConfig;
	sourcePath: string;
	sourceDirectory: string;
	fingerprint: string;
}

export interface McpToolMetadata {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
}

export type McpServerState = "disconnected" | "connecting" | "connected" | "error" | "disabled";

export interface McpServerSummary {
	name: string;
	state: McpServerState;
	transport: McpTransportKind;
	toolCount: number;
	error?: string;
}

export interface McpConfigDiagnostic {
	sourcePath: string;
	message: string;
}

export interface LoadedMcpConfiguration {
	servers: Map<string, McpServerDefinition>;
	diagnostics: McpConfigDiagnostic[];
	loadedSources: string[];
}

export interface McpToolCatalog {
	server: string;
	tools: McpToolMetadata[];
}

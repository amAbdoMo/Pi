import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir as systemHomeDirectory } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import type {
	HttpServerConfig,
	LoadedMcpConfiguration,
	McpConfigDiagnostic,
	McpServerConfig,
	McpServerDefinition,
	StdioServerConfig,
} from "./types.ts";

export interface McpConfigLoadOptions {
	cwd: string;
	homeDirectory?: string;
	agentDirectory?: string;
	includeProject: boolean;
}

export interface SafeMcpConfigurationSummary {
	servers: Array<{
		name: string;
		transport: McpServerConfig["transport"];
		disabled: boolean;
		sourcePath: string;
	}>;
	diagnostics: McpConfigDiagnostic[];
	loadedSources: string[];
}

interface ParsedConfigFile {
	servers: McpServerDefinition[];
	invalidServerNames: string[];
	diagnostics: McpConfigDiagnostic[];
}

class McpConfigError extends Error {}

export function resolvePiAgentDirectory(homeDirectory = systemHomeDirectory()): string {
	return process.env.PI_CODING_AGENT_DIR || join(homeDirectory, ".pi", "agent");
}

export function mcpConfigPaths(options: McpConfigLoadOptions): string[] {
	const homeDirectory = options.homeDirectory ?? systemHomeDirectory();
	const agentDirectory = options.agentDirectory ?? resolvePiAgentDirectory(homeDirectory);
	const paths = [
		join(homeDirectory, ".config", "mcp", "mcp.json"),
		join(homeDirectory, ".config", "mcp", "mcp.jsonc"),
		join(agentDirectory, "mcp.json"),
		join(agentDirectory, "mcp.jsonc"),
	];
	if (options.includeProject) {
		paths.push(
			join(options.cwd, ".mcp.json"),
			join(options.cwd, ".mcp.jsonc"),
			join(options.cwd, ".pi", "mcp.json"),
			join(options.cwd, ".pi", "mcp.jsonc"),
		);
	}
	return paths;
}

export async function loadMcpConfiguration(options: McpConfigLoadOptions): Promise<LoadedMcpConfiguration> {
	const mergedServers = new Map<string, McpServerDefinition>();
	const diagnostics: McpConfigDiagnostic[] = [];
	const loadedSources: string[] = [];

	for (const sourcePath of mcpConfigPaths(options)) {
		const parsedFile = await readConfigFile(sourcePath);
		if (!parsedFile) continue;
		loadedSources.push(sourcePath);
		diagnostics.push(...parsedFile.diagnostics);
		for (const serverName of parsedFile.invalidServerNames) mergedServers.delete(serverName);
		for (const definition of parsedFile.servers) mergedServers.set(definition.name, definition);
	}

	return { servers: mergedServers, diagnostics, loadedSources };
}

export function safeConfigurationSummary(configuration: LoadedMcpConfiguration): SafeMcpConfigurationSummary {
	const servers = Array.from(configuration.servers.values())
		.map((definition) => ({
			name: definition.name,
			transport: definition.config.transport,
			disabled: definition.config.disabled,
			sourcePath: definition.sourcePath,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
	return {
		servers,
		diagnostics: configuration.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		loadedSources: [...configuration.loadedSources],
	};
}

async function readConfigFile(sourcePath: string): Promise<ParsedConfigFile | undefined> {
	let sourceText: string;
	try {
		sourceText = await readFile(sourcePath, "utf8");
	} catch (error) {
		if (isFileNotFound(error)) return undefined;
		return configReadFailure(sourcePath, error);
	}

	const parseErrors: ParseError[] = [];
	const document: unknown = parseJsonc(sourceText, parseErrors, { allowTrailingComma: true });
	if (parseErrors.length > 0) return configFailure(sourcePath, "Invalid JSON/JSONC");
	return parseConfigDocument(document, sourcePath);
}

function parseConfigDocument(document: unknown, sourcePath: string): ParsedConfigFile {
	if (!isRecord(document)) return configFailure(sourcePath, "Config root must be an object");
	let serverContainer: Record<string, unknown> | undefined;
	try {
		serverContainer = configuredServers(document);
	} catch (error) {
		return configFailure(sourcePath, configErrorMessage(error));
	}
	if (!serverContainer) return configFailure(sourcePath, "Expected a top-level mcp, mcpServers, or servers object");

	const parsed: ParsedConfigFile = { servers: [], invalidServerNames: [], diagnostics: [] };
	for (const [serverName, rawConfig] of Object.entries(serverContainer)) {
		try {
			parsed.servers.push(serverDefinition(serverName, rawConfig, sourcePath));
		} catch (error) {
			parsed.invalidServerNames.push(serverName);
			parsed.diagnostics.push({
				sourcePath,
				message: `${serverName}: ${configErrorMessage(error)}`,
			});
		}
	}
	return parsed;
}

function configuredServers(document: Record<string, unknown>): Record<string, unknown> | undefined {
	if (document.mcpServers !== undefined) {
		if (!isRecord(document.mcpServers)) throw new McpConfigError("mcpServers must be an object");
		return document.mcpServers;
	}
	if (document.servers !== undefined) {
		if (!isRecord(document.servers)) throw new McpConfigError("servers must be an object");
		return document.servers;
	}
	if (document.mcp !== undefined) {
		if (!isRecord(document.mcp)) throw new McpConfigError("mcp must be an object");
		return document.mcp;
	}
	return undefined;
}

function serverDefinition(serverName: string, rawConfig: unknown, sourcePath: string): McpServerDefinition {
	if (!serverName.trim()) throw new McpConfigError("Server name must not be empty");
	if (!isRecord(rawConfig)) throw new McpConfigError("Server config must be an object");
	const config = normalizeServerConfig(rawConfig);
	return {
		name: serverName,
		config,
		sourcePath,
		sourceDirectory: dirname(sourcePath),
		fingerprint: createHash("sha256").update(JSON.stringify({ config, sourcePath })).digest("hex"),
	};
}

function normalizeServerConfig(rawConfig: Record<string, unknown>): McpServerConfig {
	const disabled = disabledState(rawConfig);
	const oauthConfigured = hasOauthConfiguration(rawConfig);
	const transport = transportKind(rawConfig);
	if (transport === "stdio") return stdioConfig(rawConfig, disabled, oauthConfigured);
	return httpConfig(rawConfig, disabled, oauthConfigured);
}

function disabledState(rawConfig: Record<string, unknown>): boolean {
	const disabled = optionalBoolean(rawConfig.disabled, "disabled");
	const enabled = optionalBoolean(rawConfig.enabled, "enabled");
	if (disabled !== undefined && enabled !== undefined) {
		throw new McpConfigError("Use either enabled or disabled, not both");
	}
	return disabled ?? (enabled === undefined ? false : !enabled);
}

function transportKind(rawConfig: Record<string, unknown>): McpServerConfig["transport"] {
	const declaredTransport = rawConfig.transport ?? rawConfig.type;
	if (declaredTransport !== undefined && typeof declaredTransport !== "string") {
		throw new McpConfigError("transport/type must be a string");
	}
	if (declaredTransport === "stdio" || declaredTransport === "local") return "stdio";
	if (["http", "streamable-http", "remote"].includes(declaredTransport ?? "")) return "streamable-http";
	if (declaredTransport !== undefined) {
		throw new McpConfigError("Unsupported transport; use stdio/local or streamable-http/remote");
	}
	if (typeof rawConfig.command === "string" || Array.isArray(rawConfig.command)) return "stdio";
	if (typeof rawConfig.url === "string") return "streamable-http";
	throw new McpConfigError("Server must define command or url");
}

function stdioConfig(
	rawConfig: Record<string, unknown>,
	disabled: boolean,
	oauthConfigured: boolean,
): StdioServerConfig {
	const { command, args } = stdioCommand(rawConfig);
	if (rawConfig.env !== undefined && rawConfig.environment !== undefined) {
		throw new McpConfigError("Use either env or environment, not both");
	}
	const envField = rawConfig.env !== undefined ? "env" : "environment";
	const env = optionalStringRecord(rawConfig[envField], envField);
	const cwd = optionalNonEmptyString(rawConfig.cwd, "cwd");
	return { transport: "stdio", command, args, env, cwd, disabled, oauthConfigured };
}

function stdioCommand(rawConfig: Record<string, unknown>): { command: string; args: string[] } {
	if (!Array.isArray(rawConfig.command)) {
		return {
			command: requiredNonEmptyString(rawConfig.command, "command"),
			args: optionalStringArray(rawConfig.args, "args") ?? [],
		};
	}
	if (rawConfig.args !== undefined) throw new McpConfigError("args cannot be used when command is an array");
	const commandParts = optionalStringArray(rawConfig.command, "command");
	if (!commandParts?.length || !commandParts[0]?.trim()) {
		throw new McpConfigError("command must be a non-empty array of strings");
	}
	const [command, ...args] = commandParts;
	return { command, args };
}

function httpConfig(
	rawConfig: Record<string, unknown>,
	disabled: boolean,
	oauthConfigured: boolean,
): HttpServerConfig {
	const url = requiredNonEmptyString(rawConfig.url, "url");
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		throw new McpConfigError("url must be an absolute HTTP(S) URL");
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new McpConfigError("url must use HTTP or HTTPS");
	}
	const headers = optionalStringRecord(rawConfig.headers, "headers");
	return { transport: "streamable-http", url, headers, disabled, oauthConfigured };
}

function hasOauthConfiguration(rawConfig: Record<string, unknown>): boolean {
	if (rawConfig.oauth !== undefined || rawConfig.oauthProvider !== undefined) return true;
	if (!isRecord(rawConfig.auth)) return false;
	return typeof rawConfig.auth.type === "string" && rawConfig.auth.type.toLowerCase() === "oauth";
}

function requiredNonEmptyString(rawField: unknown, fieldName: string): string {
	if (typeof rawField !== "string" || !rawField.trim()) {
		throw new McpConfigError(`${fieldName} must be a non-empty string`);
	}
	return rawField;
}

function optionalNonEmptyString(rawField: unknown, fieldName: string): string | undefined {
	if (rawField === undefined) return undefined;
	return requiredNonEmptyString(rawField, fieldName);
}

function optionalBoolean(rawField: unknown, fieldName: string): boolean | undefined {
	if (rawField === undefined) return undefined;
	if (typeof rawField !== "boolean") throw new McpConfigError(`${fieldName} must be a boolean`);
	return rawField;
}

function optionalStringArray(rawField: unknown, fieldName: string): string[] | undefined {
	if (rawField === undefined) return undefined;
	if (!Array.isArray(rawField) || !rawField.every((entry) => typeof entry === "string")) {
		throw new McpConfigError(`${fieldName} must be an array of strings`);
	}
	return [...rawField];
}

function optionalStringRecord(rawField: unknown, fieldName: string): Record<string, string> | undefined {
	if (rawField === undefined) return undefined;
	if (!isRecord(rawField) || !Object.values(rawField).every((entry) => typeof entry === "string")) {
		throw new McpConfigError(`${fieldName} must contain only string values`);
	}
	return { ...rawField } as Record<string, string>;
}

function configReadFailure(sourcePath: string, error: unknown): ParsedConfigFile {
	const code = errorCode(error);
	return configFailure(sourcePath, code ? `Unable to read config (${code})` : "Unable to read config");
}

function configFailure(sourcePath: string, message: string): ParsedConfigFile {
	return { servers: [], invalidServerNames: [], diagnostics: [{ sourcePath, message }] };
}

function configErrorMessage(error: unknown): string {
	return error instanceof McpConfigError ? error.message : "Invalid server configuration";
}

function isFileNotFound(error: unknown): boolean {
	return errorCode(error) === "ENOENT";
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

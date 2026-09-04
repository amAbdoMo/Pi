import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir as systemHomeDirectory } from "node:os";
import { dirname, join, resolve } from "node:path";

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

interface PrivateCredential {
	source: string;
	server: string;
	location: "env" | "headers";
	key: string;
	value: string;
}

interface PrivateCredentialLoad {
	credentials: PrivateCredential[];
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
	const agentDirectory = options.agentDirectory ?? resolvePiAgentDirectory(options.homeDirectory);
	const privateLoad = await readPrivateCredentials(join(agentDirectory, "mcp-auth.json"));
	const diagnostics: McpConfigDiagnostic[] = [...privateLoad.diagnostics];
	const loadedSources: string[] = [];

	for (const sourcePath of mcpConfigPaths(options)) {
		const sourceCredentials = privateLoad.credentials.filter(
			(credential) => credential.source === mcpCredentialSourceId(sourcePath),
		);
		const parsedFile = await readConfigFile(sourcePath, sourceCredentials);
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

export function mcpCredentialSourceId(sourcePath: string): string {
	const absolute = resolve(sourcePath);
	const normalized = process.platform === "win32" ? absolute.replaceAll("\\", "/").toLowerCase() : absolute;
	return createHash("sha256").update(normalized).digest("base64url");
}

async function readPrivateCredentials(authPath: string): Promise<PrivateCredentialLoad> {
	let sourceText: string;
	try {
		sourceText = await readFile(authPath, "utf8");
	} catch (error) {
		if (isFileNotFound(error)) return { credentials: [], diagnostics: [] };
		return { credentials: [], diagnostics: [{ sourcePath: authPath, message: "Unable to read private MCP credentials" }] };
	}
	try {
		const document: unknown = JSON.parse(sourceText);
		if (!isRecord(document) || (document.version !== undefined && document.version !== 1) || !isRecord(document.credentials)) {
			throw new Error("invalid");
		}
		const credentials = Object.entries(document.credentials).map(([id, value]) => privateCredential(id, value));
		return { credentials, diagnostics: [] };
	} catch {
		return { credentials: [], diagnostics: [{ sourcePath: authPath, message: "Private MCP credentials are invalid" }] };
	}
}

function privateCredential(id: string, value: unknown): PrivateCredential {
	if (!isRecord(value)
		|| typeof value.source !== "string"
		|| !/^[A-Za-z0-9_-]{20,128}$/.test(value.source)
		|| typeof value.server !== "string"
		|| !value.server.trim()
		|| (value.location !== "env" && value.location !== "headers")
		|| typeof value.key !== "string"
		|| !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value.key)
		|| typeof value.value !== "string"
		|| value.value.length === 0
		|| value.value.length > 16 * 1024
		|| id !== privateCredentialId(value.source, value.server, value.location, value.key)) {
		throw new Error("invalid");
	}
	return {
		source: value.source,
		server: value.server,
		location: value.location,
		key: value.key,
		value: value.value,
	};
}

function privateCredentialId(source: string, server: string, location: string, key: string): string {
	return createHash("sha256").update(JSON.stringify([source, server, location, key])).digest("base64url");
}

async function readConfigFile(
	sourcePath: string,
	privateCredentials: PrivateCredential[],
): Promise<ParsedConfigFile | undefined> {
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
	return parseConfigDocument(document, sourcePath, privateCredentials);
}

function parseConfigDocument(
	document: unknown,
	sourcePath: string,
	privateCredentials: PrivateCredential[],
): ParsedConfigFile {
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
			const credentials = privateCredentials.filter((credential) => credential.server === serverName);
			parsed.servers.push(serverDefinition(serverName, applyPrivateCredentials(rawConfig, credentials), sourcePath, credentials));
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

function applyPrivateCredentials(rawConfig: unknown, credentials: PrivateCredential[]): unknown {
	if (!isRecord(rawConfig) || credentials.length === 0) return rawConfig;
	const merged = { ...rawConfig };
	for (const location of ["env", "headers"] as const) {
		const matching = credentials.filter((credential) => credential.location === location);
		if (matching.length === 0) continue;
		const target = location === "env" && merged.env === undefined && merged.environment !== undefined
			? "environment"
			: location;
		const current = isRecord(merged[target]) ? { ...merged[target] } : {};
		for (const credential of matching) {
			const caseInsensitive = location === "headers" || (location === "env" && process.platform === "win32");
			if (caseInsensitive) {
				for (const key of Object.keys(current)) if (key.toLowerCase() === credential.key.toLowerCase()) delete current[key];
			}
			current[credential.key] = credential.value;
		}
		merged[target] = current;
	}
	return merged;
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

function serverDefinition(
	serverName: string,
	rawConfig: unknown,
	sourcePath: string,
	privateCredentials: PrivateCredential[],
): McpServerDefinition {
	if (!serverName.trim()) throw new McpConfigError("Server name must not be empty");
	if (!isRecord(rawConfig)) throw new McpConfigError("Server config must be an object");
	const config = normalizeServerConfig(rawConfig, privateCredentials);
	return {
		name: serverName,
		config,
		sourcePath,
		sourceDirectory: dirname(sourcePath),
		fingerprint: createHash("sha256").update(JSON.stringify({ config, sourcePath })).digest("hex"),
		privateSecretValues: privateCredentials.map(({ value }) => value),
	};
}

function normalizeServerConfig(rawConfig: Record<string, unknown>, privateCredentials: PrivateCredential[]): McpServerConfig {
	const disabled = disabledState(rawConfig);
	const oauthConfigured = hasOauthConfiguration(rawConfig);
	const transport = transportKind(rawConfig);
	if (transport === "stdio") return stdioConfig(rawConfig, disabled, oauthConfigured);
	return httpConfig(rawConfig, disabled, oauthConfigured, privateCredentials.some(({ location }) => location === "headers"));
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
	hasPrivateHeaders: boolean,
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
	if (parsedUrl.username || parsedUrl.password) {
		throw new McpConfigError("url must not include credentials");
	}
	if ([...parsedUrl.searchParams.keys()].some(isSensitiveName)) {
		throw new McpConfigError("credential-like URL parameters are not supported; use headers");
	}
	const headers = optionalStringRecord(rawConfig.headers, "headers");
	if (parsedUrl.protocol === "http:" && (hasPrivateHeaders || hasCredentialHeaders(headers)) && !isLoopbackHostname(parsedUrl.hostname)) {
		throw new McpConfigError("credential headers require HTTPS unless the MCP server is loopback-only");
	}
	return { transport: "streamable-http", url, headers, disabled, oauthConfigured };
}

function isSensitiveName(name: string): boolean {
	return /(?:authorization|auth|cookie|credential|token|api[-_]?key|secret|password)/i.test(name);
}

function hasCredentialHeaders(headers: Record<string, string> | undefined): boolean {
	return Object.keys(headers ?? {}).some(isSensitiveName);
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (normalized === "localhost" || normalized === "::1") return true;
	const octets = normalized.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every(isIpv4Octet);
}

function isIpv4Octet(octet: string): boolean {
	if (!/^\d{1,3}$/.test(octet)) return false;
	const value = Number(octet);
	return value >= 0 && value <= 255;
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

import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { loadMcpConfiguration } from "./config.ts";
import { findMcpTool, searchMcpTools, type McpToolMatch } from "./discovery.ts";
import {
	emptyMetadataCache,
	loadMetadataCache,
	saveMetadataCache,
	type McpMetadataCache,
} from "./metadata-cache.ts";
import { mcpToolResultText } from "./output-guard.ts";
import { redactServerSecrets, redactedToolMetadata, safeRuntimeError } from "./security.ts";
import type {
	McpConfigDiagnostic,
	McpServerDefinition,
	McpServerState,
	McpServerSummary,
	McpToolCatalog,
	McpToolMetadata,
} from "./types.ts";

interface McpServerRuntime {
	definition: McpServerDefinition;
	state: McpServerState;
	client?: Client;
	tools: McpToolMetadata[];
	metadataKnown: boolean;
	error?: string;
	connectPromise?: Promise<McpToolMetadata[]>;
	connectAbort?: AbortController;
	activeCalls: Set<Promise<unknown>>;
	callAborts: Set<AbortController>;
}

export interface McpToolCallOutcome {
	text: string;
	isError: boolean;
}

export interface McpHubReloadSummary {
	serverCount: number;
	diagnosticCount: number;
}

export class McpHub {
	readonly agentDirectory: string;
	private cwd?: string;
	private includeProject = false;
	private servers = new Map<string, McpServerRuntime>();
	private configDiagnostics: McpConfigDiagnostic[] = [];
	private metadataCache: McpMetadataCache = emptyMetadataCache();
	private cacheWriteTail: Promise<void> = Promise.resolve();
	private reloadPromise?: Promise<McpHubReloadSummary>;
	private readonly listeners = new Set<() => void>();

	constructor(agentDirectory: string) {
		this.agentDirectory = agentDirectory;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async startSession(cwd: string, includeProject: boolean): Promise<McpHubReloadSummary> {
		this.cwd = cwd;
		this.includeProject = includeProject;
		return this.reload();
	}

	reload(): Promise<McpHubReloadSummary> {
		if (!this.cwd) return Promise.reject(new Error("MCP Hub has not started a session"));
		if (this.reloadPromise) return this.reloadPromise;
		const pendingReload = this.reloadConfiguration();
		const trackedReload = pendingReload.finally(() => {
			if (this.reloadPromise === trackedReload) this.reloadPromise = undefined;
		});
		this.reloadPromise = trackedReload;
		return trackedReload;
	}

	serverSummaries(): McpServerSummary[] {
		return Array.from(this.servers.values())
			.map((runtime) => ({
				name: runtime.definition.name,
				state: runtime.state,
				transport: runtime.definition.config.transport,
				toolCount: runtime.metadataKnown ? runtime.tools.length : 0,
				error: runtime.error,
			}))
			.sort((left, right) => left.name.localeCompare(right.name));
	}

	diagnostics(): McpConfigDiagnostic[] {
		return this.configDiagnostics.map((diagnostic) => ({ ...diagnostic }));
	}

	peekTools(serverName: string): McpToolMetadata[] {
		const runtime = this.servers.get(serverName);
		return runtime?.metadataKnown ? runtime.tools.map(cloneTool) : [];
	}

	async connectServer(serverName: string, signal?: AbortSignal): Promise<McpToolMetadata[]> {
		await this.waitForReload(signal);
		const runtime = this.requiredServer(serverName);
		if (runtime.state === "connected") return runtime.tools.map(cloneTool);
		if (runtime.connectPromise) return abortablePromise(runtime.connectPromise, signal);
		const connectAbort = new AbortController();
		const connectSignal = signal ? AbortSignal.any([signal, connectAbort.signal]) : connectAbort.signal;
		const pendingConnection = this.openConnection(runtime, connectSignal);
		const trackedConnection = pendingConnection.finally(() => {
			if (runtime.connectPromise === trackedConnection) runtime.connectPromise = undefined;
			if (runtime.connectAbort === connectAbort) runtime.connectAbort = undefined;
		});
		runtime.connectAbort = connectAbort;
		runtime.connectPromise = trackedConnection;
		return trackedConnection;
	}

	async disconnectServer(serverName: string): Promise<void> {
		await this.waitForReload();
		const runtime = this.requiredServer(serverName);
		await this.stopRuntimeOperations(runtime);
		const client = runtime.client;
		runtime.client = undefined;
		runtime.error = undefined;
		runtime.state = runtime.definition.config.disabled ? "disabled" : "disconnected";
		this.emitChange();
		if (!client) return;
		await terminateHttpSessionQuietly(client);
		try {
			await client.close();
		} catch (error) {
			throw new Error(safeRuntimeError(error, runtime.definition));
		}
	}

	async toolsForServer(serverName: string, signal?: AbortSignal): Promise<McpToolMetadata[]> {
		await this.waitForReload(signal);
		const runtime = this.requiredServer(serverName);
		if (runtime.metadataKnown) return runtime.tools.map(cloneTool);
		return this.connectServer(serverName, signal);
	}

	async searchTools(query: string, serverName?: string, signal?: AbortSignal): Promise<McpToolMatch[]> {
		await this.waitForReload(signal);
		const catalogs = serverName
			? [{ server: serverName, tools: await this.toolsForServer(serverName, signal) }]
			: this.knownCatalogs();
		return searchMcpTools(catalogs, query);
	}

	async describeTool(serverName: string, toolName: string, signal?: AbortSignal): Promise<McpToolMetadata> {
		const tools = await this.toolsForServer(serverName, signal);
		const tool = findMcpTool([{ server: serverName, tools }], serverName, toolName);
		if (!tool) throw new Error(`Unknown MCP tool: ${serverName}/${toolName}`);
		return cloneTool(tool);
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpToolCallOutcome> {
		await this.connectServer(serverName, signal);
		const runtime = this.requiredServer(serverName);
		if (!findMcpTool([{ server: serverName, tools: runtime.tools }], serverName, toolName)) {
			throw new Error(`Unknown MCP tool: ${serverName}/${toolName}`);
		}
		const client = runtime.client;
		if (!client) throw new Error(`MCP server disconnected before call: ${serverName}`);
		const callAbort = new AbortController();
		const callSignal = signal ? AbortSignal.any([signal, callAbort.signal]) : callAbort.signal;
		let pendingCall: Promise<unknown> | undefined;
		runtime.callAborts.add(callAbort);
		try {
			pendingCall = client.callTool(
				{ name: toolName, arguments: toolArguments },
				undefined,
				{ signal: callSignal },
			);
			runtime.activeCalls.add(pendingCall);
			const response = await pendingCall;
			const text = redactServerSecrets(mcpToolResultText(response), runtime.definition);
			return { text, isError: isRecord(response) && response.isError === true };
		} catch (error) {
			if (callSignal.aborted || isAbortError(error)) throw cancelledError("MCP tool call cancelled");
			throw new Error(safeRuntimeError(error, runtime.definition));
		} finally {
			runtime.callAborts.delete(callAbort);
			if (pendingCall) runtime.activeCalls.delete(pendingCall);
		}
	}

	async closeAll(): Promise<void> {
		if (this.reloadPromise) await this.reloadPromise.catch(() => undefined);
		await this.closeEveryConnection();
		await this.cacheWriteTail.catch(() => undefined);
	}

	publicError(error: unknown, serverName?: string): string {
		const definition = serverName ? this.servers.get(serverName)?.definition : undefined;
		return safeRuntimeError(error, definition);
	}

	private async reloadConfiguration(): Promise<McpHubReloadSummary> {
		await this.closeEveryConnection();
		const configuration = await loadMcpConfiguration({
			cwd: this.cwd!,
			agentDirectory: this.agentDirectory,
			includeProject: this.includeProject,
		});
		this.configDiagnostics = [...configuration.diagnostics];
		this.metadataCache = await this.readCache();
		this.servers = new Map(
			Array.from(configuration.servers.values()).map((definition) => [definition.name, this.runtimeFromDefinition(definition)]),
		);
		this.emitChange();
		return { serverCount: this.servers.size, diagnosticCount: this.configDiagnostics.length };
	}

	private runtimeFromDefinition(definition: McpServerDefinition): McpServerRuntime {
		const cached = this.metadataCache.servers[definition.name];
		const cacheMatches = cached?.fingerprint === definition.fingerprint;
		return {
			definition,
			state: definition.config.disabled ? "disabled" : "disconnected",
			tools: cacheMatches ? cached.tools.map(cloneTool) : [],
			metadataKnown: cacheMatches,
			activeCalls: new Set(),
			callAborts: new Set(),
		};
	}

	private async readCache(): Promise<McpMetadataCache> {
		try {
			return await loadMetadataCache(this.agentDirectory);
		} catch (error) {
			this.addDiagnosticOnce("Metadata cache is unavailable", errorCode(error));
			return emptyMetadataCache();
		}
	}

	private requiredServer(serverName: string): McpServerRuntime {
		const runtime = this.servers.get(serverName);
		if (!runtime) throw new Error(`Unknown MCP server: ${serverName}`);
		if (runtime.definition.config.disabled) throw new Error(`MCP server is disabled: ${serverName}`);
		return runtime;
	}

	private async openConnection(runtime: McpServerRuntime, signal?: AbortSignal): Promise<McpToolMetadata[]> {
		if (runtime.definition.config.oauthConfigured) {
			throw new Error("OAuth configuration is not supported by Pi MCP Hub yet.");
		}
		runtime.state = "connecting";
		runtime.error = undefined;
		this.emitChange();
		const client = new Client({ name: "pi-mcp-hub", version: "0.1.0" }, { capabilities: {} });
		client.onclose = () => this.connectionClosed(runtime, client);
		try {
			await client.connect(this.transportFor(runtime.definition), { signal });
			const tools = await this.fetchTools(client, runtime.definition, signal);
			runtime.client = client;
			runtime.tools = tools;
			runtime.metadataKnown = true;
			runtime.state = "connected";
			this.emitChange();
			await this.cacheTools(runtime);
			return tools.map(cloneTool);
		} catch (error) {
			await closeQuietly(client);
			if (signal?.aborted || isAbortError(error)) {
				runtime.state = "disconnected";
				runtime.error = undefined;
				this.emitChange();
				throw cancelledError("MCP connection cancelled");
			}
			const message = safeRuntimeError(error, runtime.definition);
			runtime.state = "error";
			runtime.error = message;
			this.emitChange();
			throw new Error(message);
		}
	}

	private transportFor(definition: McpServerDefinition): StdioClientTransport | StreamableHTTPClientTransport {
		const config = definition.config;
		if (config.transport === "streamable-http") {
			return new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: config.headers ? { headers: config.headers } : undefined,
			});
		}
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: { ...getDefaultEnvironment(), ...config.env },
			cwd: config.cwd ? resolve(definition.sourceDirectory, config.cwd) : this.cwd,
			stderr: "pipe",
		});
		transport.stderr?.on("data", () => undefined);
		return transport;
	}

	private async fetchTools(
		client: Client,
		definition: McpServerDefinition,
		signal?: AbortSignal,
	): Promise<McpToolMetadata[]> {
		const tools: McpToolMetadata[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 100; page += 1) {
			const response = await client.listTools(cursor ? { cursor } : undefined, { signal });
			for (const rawTool of response.tools) {
				const tool = redactedToolMetadata(rawTool, definition);
				if (tool) tools.push(tool);
			}
			cursor = response.nextCursor;
			if (!cursor) return tools.sort((left, right) => left.name.localeCompare(right.name));
		}
		throw new Error("MCP server returned too many tool-list pages");
	}

	private knownCatalogs(): McpToolCatalog[] {
		return Array.from(this.servers.values())
			.filter((runtime) => !runtime.definition.config.disabled && runtime.metadataKnown)
			.map((runtime) => ({ server: runtime.definition.name, tools: runtime.tools.map(cloneTool) }));
	}

	private async cacheTools(runtime: McpServerRuntime): Promise<void> {
		this.metadataCache.servers[runtime.definition.name] = {
			fingerprint: runtime.definition.fingerprint,
			updatedAt: new Date().toISOString(),
			tools: runtime.tools.map(cloneTool),
		};
		const cacheSnapshot = structuredClone(this.metadataCache);
		const writeCache = () => saveMetadataCache(this.agentDirectory, cacheSnapshot);
		this.cacheWriteTail = this.cacheWriteTail.then(writeCache, writeCache);
		try {
			await this.cacheWriteTail;
		} catch (error) {
			this.addDiagnosticOnce("Unable to write metadata cache", errorCode(error));
		}
	}

	private connectionClosed(runtime: McpServerRuntime, client: Client): void {
		if (runtime.client !== client) return;
		runtime.client = undefined;
		runtime.state = runtime.definition.config.disabled ? "disabled" : "disconnected";
		this.emitChange();
	}

	private async closeEveryConnection(): Promise<void> {
		const runtimes = Array.from(this.servers.values());
		await Promise.all(runtimes.map((runtime) => this.stopRuntimeOperations(runtime)));
		await Promise.all(
			runtimes.map(async (runtime) => {
				const client = runtime.client;
				runtime.client = undefined;
				runtime.state = runtime.definition.config.disabled ? "disabled" : "disconnected";
				if (client) await closeQuietly(client);
			}),
		);
	}

	private async stopRuntimeOperations(runtime: McpServerRuntime): Promise<void> {
		runtime.connectAbort?.abort();
		for (const callAbort of runtime.callAborts) callAbort.abort();
		await Promise.allSettled([
			runtime.connectPromise,
			...runtime.activeCalls,
		]);
	}

	private async waitForReload(signal?: AbortSignal): Promise<void> {
		const activeReload = this.reloadPromise;
		if (activeReload) await abortablePromise(activeReload, signal);
	}

	private addDiagnosticOnce(message: string, code?: string): void {
		const renderedMessage = code ? `${message} (${code})` : message;
		if (this.configDiagnostics.some((diagnostic) => diagnostic.message === renderedMessage)) return;
		this.configDiagnostics.push({ sourcePath: this.agentDirectory, message: renderedMessage });
	}

	private emitChange(): void {
		for (const listener of this.listeners) listener();
	}
}

async function closeQuietly(client: Client): Promise<void> {
	await terminateHttpSessionQuietly(client);
	try {
		await client.close();
	} catch {
		return;
	}
}

async function terminateHttpSessionQuietly(client: Client): Promise<void> {
	const transport = client.transport;
	if (!(transport instanceof StreamableHTTPClientTransport) || !transport.sessionId) return;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolveDeadline) => {
		timeout = setTimeout(resolveDeadline, 1_500);
		timeout.unref?.();
	});
	try {
		await Promise.race([transport.terminateSession(), deadline]);
	} catch {
		return;
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function abortablePromise<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return pending;
	signal.throwIfAborted();
	return new Promise<T>((resolvePromise, rejectPromise) => {
		const rejectOnAbort = () => rejectPromise(signal.reason);
		signal.addEventListener("abort", rejectOnAbort, { once: true });
		pending.then(
			resolved => {
				signal.removeEventListener("abort", rejectOnAbort);
				resolvePromise(resolved);
			},
			rejected => {
				signal.removeEventListener("abort", rejectOnAbort);
				rejectPromise(rejected);
			},
		);
	});
}

function cloneTool(tool: McpToolMetadata): McpToolMetadata {
	return structuredClone(tool);
}

function cancelledError(message: string): DOMException {
	return new DOMException(message, "AbortError");
}

function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === "AbortError";
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

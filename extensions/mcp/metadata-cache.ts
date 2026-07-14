import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { McpToolMetadata } from "./types.ts";

const CACHE_VERSION = 1;
const CACHE_FILENAME = "mcp-metadata-cache.json";

export interface CachedServerMetadata {
	fingerprint: string;
	updatedAt: string;
	tools: McpToolMetadata[];
}

export interface McpMetadataCache {
	version: number;
	servers: Record<string, CachedServerMetadata>;
}

export function emptyMetadataCache(): McpMetadataCache {
	return { version: CACHE_VERSION, servers: {} };
}

export function metadataCachePath(agentDirectory: string): string {
	return join(agentDirectory, CACHE_FILENAME);
}

export async function loadMetadataCache(agentDirectory: string): Promise<McpMetadataCache> {
	let cacheText: string;
	try {
		cacheText = await readFile(metadataCachePath(agentDirectory), "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return emptyMetadataCache();
		throw error;
	}

	try {
		return normalizedCache(JSON.parse(cacheText));
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof InvalidCacheError) return emptyMetadataCache();
		throw error;
	}
}

export async function saveMetadataCache(agentDirectory: string, cache: McpMetadataCache): Promise<void> {
	await mkdir(agentDirectory, { recursive: true, mode: 0o700 });
	const targetPath = metadataCachePath(agentDirectory);
	const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	try {
		await rename(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

function normalizedCache(rawCache: unknown): McpMetadataCache {
	if (!isRecord(rawCache) || rawCache.version !== CACHE_VERSION || !isRecord(rawCache.servers)) {
		throw new InvalidCacheError();
	}
	const servers: Record<string, CachedServerMetadata> = {};
	for (const [serverName, rawMetadata] of Object.entries(rawCache.servers)) {
		const metadata = normalizedServerMetadata(rawMetadata);
		if (metadata) servers[serverName] = metadata;
	}
	return { version: CACHE_VERSION, servers };
}

function normalizedServerMetadata(rawMetadata: unknown): CachedServerMetadata | undefined {
	if (!isRecord(rawMetadata)) return undefined;
	if (typeof rawMetadata.fingerprint !== "string" || typeof rawMetadata.updatedAt !== "string") return undefined;
	if (!Array.isArray(rawMetadata.tools)) return undefined;
	const tools = rawMetadata.tools.map(normalizedTool).filter((tool): tool is McpToolMetadata => tool !== undefined);
	return { fingerprint: rawMetadata.fingerprint, updatedAt: rawMetadata.updatedAt, tools };
}

function normalizedTool(rawTool: unknown): McpToolMetadata | undefined {
	if (!isRecord(rawTool) || typeof rawTool.name !== "string" || !isRecord(rawTool.inputSchema)) return undefined;
	const description = typeof rawTool.description === "string" ? rawTool.description : undefined;
	const annotations = normalizedAnnotations(rawTool.annotations);
	return { name: rawTool.name, description, inputSchema: rawTool.inputSchema, annotations };
}

function normalizedAnnotations(rawAnnotations: unknown): McpToolMetadata["annotations"] {
	if (!isRecord(rawAnnotations)) return undefined;
	const annotations: NonNullable<McpToolMetadata["annotations"]> = {};
	if (typeof rawAnnotations.title === "string") annotations.title = rawAnnotations.title;
	for (const field of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
		if (typeof rawAnnotations[field] === "boolean") annotations[field] = rawAnnotations[field];
	}
	return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

class InvalidCacheError extends Error {}

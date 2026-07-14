import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAX_BYTES = 24 * 1024;
const DEFAULT_MAX_LINES = 500;

export interface McpOutputGuardOptions {
	outputDirectory: string;
	label: string;
	maxBytes?: number;
	maxLines?: number;
}

export interface GuardedMcpOutput {
	text: string;
	truncated: boolean;
	fullOutputPath?: string;
	totalBytes: number;
	totalLines: number;
	outputBytes: number;
	outputLines: number;
}

export async function guardMcpOutput(text: string, options: McpOutputGuardOptions): Promise<GuardedMcpOutput> {
	const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES);
	const maxLines = positiveLimit(options.maxLines, DEFAULT_MAX_LINES);
	const totalBytes = Buffer.byteLength(text, "utf8");
	const totalLines = lineCount(text);
	const lineLimited = text.split("\n").slice(0, maxLines).join("\n");
	const outputPrefix = utf8Prefix(lineLimited, maxBytes);
	const outputBytes = Buffer.byteLength(outputPrefix, "utf8");
	const outputLines = lineCount(outputPrefix);
	const truncated = totalBytes > outputBytes || totalLines > outputLines;

	if (!truncated) {
		return { text, truncated, totalBytes, totalLines, outputBytes, outputLines };
	}

	const fullOutputPath = await spillOutput(text, options.outputDirectory, options.label);
	const notice = `\n\n[Output truncated: showing ${outputLines}/${totalLines} lines and ${outputBytes}/${totalBytes} bytes. Full output: ${fullOutputPath}]`;
	return {
		text: `${outputPrefix}${notice}`,
		truncated,
		fullOutputPath,
		totalBytes,
		totalLines,
		outputBytes,
		outputLines,
	};
}

export function mcpToolResultText(payload: unknown): string {
	if (!isRecord(payload)) return jsonText(payload);
	const contentText = Array.isArray(payload.content)
		? payload.content.map(contentPartText).filter(Boolean).join("\n")
		: "";
	if (contentText) return contentText;
	if (payload.structuredContent !== undefined) return jsonText(payload.structuredContent);
	if (payload.toolResult !== undefined) return jsonText(payload.toolResult);
	return jsonText(withoutMetadata(payload));
}

function contentPartText(rawPart: unknown): string {
	if (!isRecord(rawPart) || typeof rawPart.type !== "string") return "[unsupported MCP content]";
	if (rawPart.type === "text" && typeof rawPart.text === "string") return rawPart.text;
	if (rawPart.type === "image") return `[image content omitted${mimeSuffix(rawPart.mimeType)}]`;
	if (rawPart.type === "audio") return `[audio content omitted${mimeSuffix(rawPart.mimeType)}]`;
	if (rawPart.type === "resource") return embeddedResourceText(rawPart.resource);
	if (rawPart.type === "resource_link") return resourceLinkText(rawPart);
	return `[unsupported MCP content: ${rawPart.type}]`;
}

function embeddedResourceText(rawResource: unknown): string {
	if (!isRecord(rawResource)) return "[invalid embedded resource]";
	const uri = typeof rawResource.uri === "string" ? rawResource.uri : "resource";
	if (typeof rawResource.text === "string") return `${uri}\n${rawResource.text}`;
	return `[binary resource omitted: ${uri}${mimeSuffix(rawResource.mimeType)}]`;
}

function resourceLinkText(rawLink: Record<string, unknown>): string {
	const name = typeof rawLink.name === "string" ? rawLink.name : "resource";
	const uri = typeof rawLink.uri === "string" ? rawLink.uri : "unknown URI";
	return `[resource link: ${name} — ${uri}]`;
}

function mimeSuffix(rawMimeType: unknown): string {
	return typeof rawMimeType === "string" ? `, ${rawMimeType}` : "";
}

async function spillOutput(text: string, outputDirectory: string, label: string): Promise<string> {
	await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
	const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
	const outputPath = join(outputDirectory, `${safeLabel}-${randomUUID()}.txt`);
	await writeFile(outputPath, text, { encoding: "utf8", mode: 0o600 });
	return outputPath;
}

function utf8Prefix(text: string, maxBytes: number): string {
	const encoded = Buffer.from(text, "utf8");
	if (encoded.length <= maxBytes) return text;
	let end = maxBytes;
	while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
	return encoded.subarray(0, end).toString("utf8");
}

function positiveLimit(configuredLimit: number | undefined, fallback: number): number {
	return Number.isInteger(configuredLimit) && configuredLimit! > 0 ? configuredLimit! : fallback;
}

function lineCount(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

function jsonText(candidate: unknown): string {
	const serialized = JSON.stringify(candidate, null, 2);
	return serialized === undefined ? String(candidate) : serialized;
}

function withoutMetadata(payload: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(payload).filter(([field]) => field !== "_meta"));
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

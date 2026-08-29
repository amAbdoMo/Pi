import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	containsUiTerms,
	inferUiTags,
	isUiCorrection,
	sanitizeCorrection,
	type CaptureRequest,
} from "./core.ts";

export interface HistoryScanOptions {
	root: string;
	days: number;
	sessionPattern?: RegExp;
	maxFiles?: number;
	maxCandidates?: number;
}

export interface HistoryScanResult {
	filesScanned: number;
	sessionsMatched: number;
	candidates: CaptureRequest[];
}

interface ParsedSession {
	name: string;
	cwd: string;
	firstUserText: string;
	candidates: CaptureRequest[];
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block && typeof block === "object" && "text" in block
				? String((block as { text?: unknown }).text ?? "")
				: "",
		)
		.join("\n");
}

function filesystemErrorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function sessionFiles(root: string, cutoff: number, maxFiles: number): Promise<string[]> {
	const matches: Array<{ path: string; modified: number }> = [];
	async function walk(directory: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (filesystemErrorCode(error) === "ENOENT") return;
			throw error;
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "subagents") await walk(path);
				continue;
			}
			if (!entry.name.endsWith(".jsonl")) continue;
			try {
				const fileStats = await stat(path);
				if (fileStats.mtimeMs >= cutoff) matches.push({ path, modified: fileStats.mtimeMs });
			} catch (error) {
				if (filesystemErrorCode(error) !== "ENOENT") throw error;
			}
		}
	}
	await walk(root);
	return matches.sort((left, right) => right.modified - left.modified).slice(0, maxFiles).map((match) => match.path);
}

function parseSession(file: string, raw: string): ParsedSession {
	let name = "";
	let cwd = "";
	let firstUserText = "";
	let recentUiContext = false;
	const candidates: CaptureRequest[] = [];
	for (const line of raw.split(/\r?\n/)) {
		if (!line) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type === "session") cwd = String(entry.cwd ?? "");
		if (entry.type === "session_info" && entry.name) name = String(entry.name);
		if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const message = entry.message as { role?: string; content?: unknown };
		const text = contentText(message.content);
		if (message.role === "assistant") {
			recentUiContext = containsUiTerms(text);
			continue;
		}
		if (message.role !== "user" || !text) continue;
		firstUserText ||= text;
		if (!isUiCorrection(text, recentUiContext)) continue;
		const correction = sanitizeCorrection(text);
		if (correction) candidates.push({ text: correction, cwd, sessionFile: file, source: "history", tags: inferUiTags(correction) });
	}
	return { name, cwd, firstUserText, candidates };
}

function matchesSession(session: ParsedSession, pattern?: RegExp): boolean {
	if (!pattern) return true;
	return pattern.test(`${session.name}\n${session.cwd}\n${session.firstUserText}`);
}

export async function scanUiCorrectionHistory(options: HistoryScanOptions): Promise<HistoryScanResult> {
	const cutoff = Date.now() - options.days * 24 * 60 * 60 * 1_000;
	const files = await sessionFiles(options.root, cutoff, options.maxFiles ?? 500);
	const candidates: CaptureRequest[] = [];
	let sessionsMatched = 0;
	for (const file of files) {
		const session = parseSession(file, await readFile(file, "utf8"));
		if (!matchesSession(session, options.sessionPattern)) continue;
		sessionsMatched += 1;
		candidates.push(...session.candidates);
		if (candidates.length >= (options.maxCandidates ?? 500)) break;
	}
	return {
		filesScanned: files.length,
		sessionsMatched,
		candidates: candidates.slice(0, options.maxCandidates ?? 500),
	};
}

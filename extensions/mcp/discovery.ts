import type { McpToolCatalog, McpToolMetadata } from "./types.ts";

export interface McpToolMatch extends McpToolMetadata {
	server: string;
	score: number;
}

export function searchMcpTools(catalogs: McpToolCatalog[], query: string, limit = 20): McpToolMatch[] {
	const queryText = normalizedText(query);
	if (!queryText) return [];
	const matches: McpToolMatch[] = [];

	for (const catalog of catalogs) {
		for (const tool of catalog.tools) {
			const score = toolScore(catalog.server, tool, queryText);
			if (score > 0) matches.push({ ...tool, server: catalog.server, score });
		}
	}

	return matches
		.sort((left, right) => right.score - left.score || left.server.localeCompare(right.server) || left.name.localeCompare(right.name))
		.slice(0, Math.max(1, Math.min(limit, 50)));
}

export function findMcpTool(catalogs: McpToolCatalog[], serverName: string, toolName: string): McpToolMetadata | undefined {
	const catalog = catalogs.find((candidate) => candidate.server === serverName);
	return catalog?.tools.find((tool) => tool.name === toolName);
}

function toolScore(serverName: string, tool: McpToolMetadata, queryText: string): number {
	const normalizedName = normalizedText(tool.name);
	const qualifiedName = `${normalizedText(serverName)}/${normalizedName}`;
	if (queryText === qualifiedName) return 2_000;
	if (queryText === normalizedName) return 1_800;
	if (qualifiedName.startsWith(queryText)) return 1_500;
	if (normalizedName.startsWith(queryText)) return 1_400;
	if (normalizedName.includes(queryText)) return 1_200;

	const searchableText = normalizedText(
		`${serverName} ${tool.name} ${tool.annotations?.title ?? ""} ${tool.description ?? ""}`,
	);
	return tokenMatchScore(queryText, searchableText);
}

function tokenMatchScore(queryText: string, searchableText: string): number {
	const queryTokens = queryText.split(" ").filter(Boolean);
	const searchableTokens = searchableText.split(" ").filter(Boolean);
	let total = 0;
	for (const queryToken of queryTokens) {
		const score = Math.max(0, ...searchableTokens.map((candidateToken) => tokenScore(queryToken, candidateToken)));
		if (score === 0) return 0;
		total += score;
	}
	return total;
}

function tokenScore(queryToken: string, candidateToken: string): number {
	if (candidateToken === queryToken) return 160;
	if (candidateToken.startsWith(queryToken)) return 130 - Math.min(20, candidateToken.length - queryToken.length);
	if (candidateToken.includes(queryToken)) return 100 - Math.min(20, candidateToken.length - queryToken.length);
	return subsequenceScore(queryToken, candidateToken);
}

function subsequenceScore(queryToken: string, candidateToken: string): number {
	let queryIndex = 0;
	let firstMatch = -1;
	let lastMatch = -1;
	for (let candidateIndex = 0; candidateIndex < candidateToken.length && queryIndex < queryToken.length; candidateIndex += 1) {
		if (candidateToken[candidateIndex] !== queryToken[queryIndex]) continue;
		if (firstMatch === -1) firstMatch = candidateIndex;
		lastMatch = candidateIndex;
		queryIndex += 1;
	}
	if (queryIndex !== queryToken.length) return 0;
	const span = lastMatch - firstMatch + 1;
	const gapPenalty = span - queryToken.length;
	return Math.max(1, 70 - firstMatch * 3 - gapPenalty * 5 - (candidateToken.length - span));
}

function normalizedText(text: string): string {
	return text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

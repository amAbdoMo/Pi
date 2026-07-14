export const MCP_ACTIONS = [
	"status",
	"list",
	"search",
	"describe",
	"call",
	"connect",
	"disconnect",
	"reload",
] as const;

export type McpAction = (typeof MCP_ACTIONS)[number];

export interface McpToolInput {
	action: McpAction;
	server?: string;
	query?: string;
	tool?: string;
	args?: string;
}

export type RoutedMcpAction =
	| { action: "status" }
	| { action: "list"; server?: string }
	| { action: "search"; query: string; server?: string }
	| { action: "describe"; server: string; tool: string }
	| { action: "call"; server: string; tool: string; arguments: Record<string, unknown> }
	| { action: "connect"; server: string }
	| { action: "disconnect"; server: string }
	| { action: "reload" };

export class McpActionInputError extends Error {}

export function routeMcpAction(input: McpToolInput): RoutedMcpAction {
	const server = optionalText(input.server, "server");
	const query = optionalText(input.query, "query");
	const tool = optionalText(input.tool, "tool");

	switch (input.action) {
		case "status":
		case "reload":
			assertUnusedFields(input, ["server", "query", "tool", "args"]);
			return { action: input.action };
		case "list":
			assertUnusedFields(input, ["query", "tool", "args"]);
			return server ? { action: "list", server } : { action: "list" };
		case "search":
			assertUnusedFields(input, ["tool", "args"]);
			return { action: "search", query: requiredText(query, "query"), ...(server && { server }) };
		case "describe":
			assertUnusedFields(input, ["query", "args"]);
			return { action: "describe", server: requiredText(server, "server"), tool: requiredText(tool, "tool") };
		case "call":
			assertUnusedFields(input, ["query"]);
			return {
				action: "call",
				server: requiredText(server, "server"),
				tool: requiredText(tool, "tool"),
				arguments: parsedArguments(input.args),
			};
		case "connect":
		case "disconnect":
			assertUnusedFields(input, ["query", "tool", "args"]);
			return { action: input.action, server: requiredText(server, "server") };
	}
}

function parsedArguments(rawArguments: string | undefined): Record<string, unknown> {
	if (rawArguments === undefined || !rawArguments.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawArguments);
	} catch (error) {
		if (error instanceof SyntaxError) throw new McpActionInputError("args must be valid JSON");
		throw error;
	}
	if (!isRecord(parsed)) throw new McpActionInputError("args must decode to a JSON object");
	return parsed;
}

function optionalText(rawText: string | undefined, fieldName: string): string | undefined {
	if (rawText === undefined) return undefined;
	const normalized = rawText.trim();
	if (!normalized) throw new McpActionInputError(`${fieldName} must not be empty`);
	return normalized;
}

function requiredText(text: string | undefined, fieldName: string): string {
	if (!text) throw new McpActionInputError(`${fieldName} is required for this action`);
	return text;
}

function assertUnusedFields(input: McpToolInput, fieldNames: Array<keyof McpToolInput>): void {
	for (const fieldName of fieldNames) {
		if (input[fieldName] !== undefined) throw new McpActionInputError(`${fieldName} is not used by ${input.action}`);
	}
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

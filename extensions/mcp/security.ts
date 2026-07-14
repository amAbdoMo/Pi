import type { McpServerDefinition, McpToolMetadata } from "./types.ts";

const REDACTED = "[redacted]";
const OAUTH_UNSUPPORTED = "Server requires OAuth, which Pi MCP Hub does not support yet.";

export function configuredSecretValues(definition: McpServerDefinition): string[] {
	const secrets = new Set<string>();
	if (definition.config.transport === "stdio") {
		for (const [envName, envValue] of Object.entries(definition.config.env ?? {})) {
			addSecret(secrets, envValue);
			if (isSensitiveName(envName)) addSecret(secrets, envValue.replace(/^\S+\s+/, ""));
		}
		addSensitiveArguments(secrets, definition.config.args);
	} else {
		for (const [headerName, headerValue] of Object.entries(definition.config.headers ?? {})) {
			addSecret(secrets, headerValue);
			if (isSensitiveName(headerName)) addSecret(secrets, headerValue.replace(/^\S+\s+/, ""));
		}
		addUrlSecrets(secrets, definition.config.url);
	}
	return Array.from(secrets).sort((left, right) => right.length - left.length);
}

export function redactServerSecrets(text: string, definition?: McpServerDefinition): string {
	let redacted = text;
	for (const secret of definition ? configuredSecretValues(definition) : []) {
		redacted = redacted.split(secret).join(REDACTED);
	}
	redacted = redactTokenAssignments(redacted);
	redacted = redactUrlCredentials(redacted);
	return redacted;
}

export function safeRuntimeError(error: unknown, definition?: McpServerDefinition): string {
	if (isOauthError(error)) return OAUTH_UNSUPPORTED;
	const rawMessage = error instanceof Error ? error.message : "MCP operation failed";
	const redacted = redactServerSecrets(rawMessage, definition).trim() || "MCP operation failed";
	return redacted.length > 500 ? `${redacted.slice(0, 499)}…` : redacted;
}

export function redactedToolMetadata(rawTool: unknown, definition: McpServerDefinition): McpToolMetadata | undefined {
	if (!isRecord(rawTool) || typeof rawTool.name !== "string" || !isRecord(rawTool.inputSchema)) return undefined;
	const description = typeof rawTool.description === "string" ? redactServerSecrets(rawTool.description, definition) : undefined;
	const inputSchema = redactUnknown(rawTool.inputSchema, definition) as Record<string, unknown>;
	const annotations = redactedAnnotations(rawTool.annotations, definition);
	return { name: rawTool.name, description, inputSchema, annotations };
}

function redactedAnnotations(rawAnnotations: unknown, definition: McpServerDefinition): McpToolMetadata["annotations"] {
	if (!isRecord(rawAnnotations)) return undefined;
	const annotations: NonNullable<McpToolMetadata["annotations"]> = {};
	if (typeof rawAnnotations.title === "string") {
		annotations.title = redactServerSecrets(rawAnnotations.title, definition);
	}
	for (const field of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
		if (typeof rawAnnotations[field] === "boolean") annotations[field] = rawAnnotations[field];
	}
	return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function redactUnknown(candidate: unknown, definition: McpServerDefinition): unknown {
	if (typeof candidate === "string") return redactServerSecrets(candidate, definition);
	if (Array.isArray(candidate)) return candidate.map((entry) => redactUnknown(entry, definition));
	if (!isRecord(candidate)) return candidate;
	return Object.fromEntries(
		Object.entries(candidate).map(([field, fieldValue]) => [field, redactUnknown(fieldValue, definition)]),
	);
}

function addSensitiveArguments(secrets: Set<string>, args: string[]): void {
	for (let index = 0; index < args.length; index += 1) {
		const currentArg = args[index] ?? "";
		const assignment = /^(?:--?)?(?:api[-_]?key|token|secret|password|authorization)=(.+)$/i.exec(currentArg);
		if (assignment?.[1]) addSecret(secrets, assignment[1]);
		if (/^(?:--?)?(?:api[-_]?key|token|secret|password|authorization)$/i.test(currentArg)) {
			addSecret(secrets, args[index + 1] ?? "");
		}
	}
}

function addUrlSecrets(secrets: Set<string>, rawUrl: string): void {
	try {
		const parsedUrl = new URL(rawUrl);
		addSecret(secrets, parsedUrl.username);
		addSecret(secrets, parsedUrl.password);
		addSensitivePathSegments(secrets, parsedUrl.pathname);
		for (const queryValue of parsedUrl.searchParams.values()) addSecret(secrets, queryValue);
	} catch {
		return;
	}
}

function addSecret(secrets: Set<string>, secret: string): void {
	if (secret) secrets.add(secret);
}

function addSensitivePathSegments(secrets: Set<string>, pathname: string): void {
	const segments = pathname.split("/").filter(Boolean).map(decodedUrlPart);
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index] ?? "";
		const previousSegment = segments[index - 1] ?? "";
		if (segment.length >= 12 || isSensitiveName(previousSegment)) addSecret(secrets, segment);
	}
}

function decodedUrlPart(rawPart: string): string {
	try {
		return decodeURIComponent(rawPart);
	} catch (error) {
		if (error instanceof URIError) return rawPart;
		throw error;
	}
}

function redactTokenAssignments(text: string): string {
	const bearerRedacted = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`);
	return bearerRedacted.replace(
		/((?:authorization|token|api[-_]?key|secret|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
		`$1${REDACTED}`,
	);
}

function redactUrlCredentials(text: string): string {
	return text.replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
		try {
			const parsedUrl = new URL(rawUrl);
			parsedUrl.username = parsedUrl.username ? REDACTED : "";
			parsedUrl.password = parsedUrl.password ? REDACTED : "";
			for (const queryName of parsedUrl.searchParams.keys()) {
				if (isSensitiveName(queryName)) parsedUrl.searchParams.set(queryName, REDACTED);
			}
			return parsedUrl.toString();
		} catch {
			return "[redacted-url]";
		}
	});
}

function isSensitiveName(fieldName: string): boolean {
	return /(?:authorization|auth|token|api[-_]?key|secret|password)/i.test(fieldName);
}

function isOauthError(error: unknown): boolean {
	if (!isRecord(error)) return false;
	if (error.name === "UnauthorizedError") return true;
	return error.code === 401 || error.status === 401;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

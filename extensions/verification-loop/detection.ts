import { isUiPath, isVerifiablePath, isVerificationCommand, type VerificationBlocker } from "./state.ts";

export interface MutationEvidence {
	ui: boolean;
	path?: string;
}

export function mutationFromTool(toolName: string, input: Record<string, unknown>): MutationEvidence | undefined {
	if (["edit", "write"].includes(toolName)) return pathMutation(input.path);
	if (toolName === "apply_patch") return { ui: false };
	if (toolName === "image_gen") return { ui: true };
	if (toolName === "workflow_run") return { ui: false };
	if (toolName === "delegate") {
		const task = stringField(input.task);
		return /\b(?:do not edit|no edits?|read[ -]?only|investigat(?:e|ion)|review only)\b/i.test(task)
			? undefined
			: { ui: false };
	}
	if (toolName === "bash" || toolName === "hypa_shell") {
		return isMutatingShellCommand(stringField(input.command)) ? { ui: false } : undefined;
	}
	if (toolName === "ctx_execute") {
		return isMutatingCode(stringField(input.code)) ? { ui: false } : undefined;
	}
	return undefined;
}

export function verificationCommandFromTool(toolName: string, input: Record<string, unknown>): string | undefined {
	const candidate = toolName === "bash" || toolName === "hypa_shell"
		? stringField(input.command)
		: toolName === "ctx_execute"
			? stringField(input.code)
			: "";
	if (!candidate || !isVerificationCommand(candidate)) return undefined;
	return candidate.length > 500 ? `${candidate.slice(0, 499)}…` : candidate;
}

export function browserToolFromCall(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName.startsWith("browser_")) return toolName;
	if (toolName !== "mcp" || input.action !== "call") return undefined;
	const mcpTool = stringField(input.tool);
	return mcpTool.startsWith("browser_") ? mcpTool : undefined;
}

export function browserIssueFromResult(toolName: string, output: string): string | undefined {
	if (toolName !== "browser_console_messages" && toolName !== "browser_network_requests") return undefined;
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || /\b(?:no|zero)\s+(?:console\s+)?(?:errors?|messages?)\b|\b0\s+errors?\b/i.test(line)) continue;
		const isConsoleIssue = toolName === "browser_console_messages"
			&& /(?:\[error\]|\b(?:uncaught|typeerror|referenceerror|syntaxerror|exception|failed to load resource)\b)/i.test(line);
		const isNetworkIssue = toolName === "browser_network_requests"
			&& /(?:\b(?:4\d{2}|5\d{2})\b|net::err_|\b(?:request|fetch|resource)\s+failed\b)/i.test(line);
		if (isConsoleIssue || isNetworkIssue) {
			const source = isConsoleIssue ? "Browser console" : "Browser network";
			return `${source} issue: ${line.slice(0, 350)}`;
		}
	}
	return undefined;
}

export function browserBlockerFromResult(toolName: string, output: string): VerificationBlocker | undefined {
	if (!toolName.startsWith("browser_")) return undefined;
	if (/wp-login\.php|sign in to continue|authentication required/i.test(output)
		|| (/username or email address/i.test(output) && /password/i.test(output) && /\blog in\b/i.test(output))) {
		return { kind: "login-required", summary: "The browser reached a login screen.", sourceTool: toolName };
	}
	if (/missing (?:api )?(?:key|token|credentials?)|credentials? (?:are )?required/i.test(output)) {
		return { kind: "credentials-required", summary: "The target requires credentials that are not available in the browser session.", sourceTool: toolName };
	}
	if (/target page, context or browser has been closed|browser has been closed|no active browser/i.test(output)) {
		return { kind: "browser-unavailable", summary: "The existing browser session is unavailable.", sourceTool: toolName };
	}
	if (/err_connection_(?:refused|reset|timed_out)|net::err_|(?:site|page) can.?t be reached|connection refused|failed to connect|navigation timeout|timed out after/i.test(output)) {
		return { kind: "target-unavailable", summary: "The browser could not reach the target.", sourceTool: toolName };
	}
	if (/required (?:server|database|service) is not (?:available|running)|missing local (?:database|service|environment)/i.test(output)) {
		return { kind: "environment-missing", summary: "A required local service or environment dependency is unavailable.", sourceTool: toolName };
	}
	return undefined;
}

export function verificationHarnessFromTool(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName === "edit" || toolName === "write") {
		return isVerificationHarnessPath(stringField(input.path)) ? "a verification-only page or fixture" : undefined;
	}
	if (toolName === "bash" || toolName === "hypa_shell") {
		return isVerificationHarnessCommand(stringField(input.command)) ? "a verification-only page or fixture" : undefined;
	}
	if (toolName === "ctx_execute") {
		return isVerificationHarnessCommand(stringField(input.code)) ? "a verification-only page or fixture" : undefined;
	}
	return undefined;
}

export function isMutatingShellCommand(command: string): boolean {
	if (!command.trim()) return false;
	return [
		/(^|[;&|]\s*)(?:rm|del|erase|rmdir|mv|move|cp|copy|mkdir|md|touch)\b/i,
		/\b(?:set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item)\b/i,
		/\b(?:sed\s+-i|perl\s+-[^\s]*i|patch\b|git\s+(?:apply|checkout|restore|reset|clean|commit|merge|rebase|cherry-pick))\b/i,
		/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|uninstall|update)\b/i,
		/\b(?:echo|printf|cat|type)\b[^;&|]*\s>>?\s*[^&|]/i,
	].some((pattern) => pattern.test(command));
}

function isVerificationHarnessPath(filePath: string): boolean {
	const normalized = filePath.trim().replaceAll("\\", "/").toLowerCase();
	if (!/\.(?:html?|php|jsx|tsx)$/.test(normalized)) return false;
	return /(?:^|[/_.-])(?:verification|verify|proof|debug|temporary|temp|test[-_ ]?page|fixture)(?:[/_.-]|$)/.test(normalized);
}

function isVerificationHarnessCommand(command: string): boolean {
	if (!/\b(?:writeFile|writeFileSync|set-content|out-file|touch|echo|printf|cat)\b/i.test(command)) return false;
	return /(?:verification|verify|proof|debug|temporary|temp|test[-_ ]?page|fixture)[^\r\n"']*\.(?:html?|php|jsx|tsx)\b/i.test(command);
}

function isMutatingCode(code: string): boolean {
	return /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync)\s*\(/.test(code)
		|| /\b(?:fs|Deno)\.(?:write|remove|rename|copy)\b/.test(code);
}

function pathMutation(candidate: unknown): MutationEvidence | undefined {
	const filePath = stringField(candidate);
	if (!filePath || !isVerifiablePath(filePath)) return undefined;
	return { path: filePath, ui: isUiPath(filePath) };
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

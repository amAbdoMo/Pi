import { isUiPath, isVerifiablePath, isVerificationCommand } from "./state.ts";

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

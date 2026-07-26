import { mkdirSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ARTIFACT_DIRECTORY_NAME = "pi-verification-artifacts";
const SCREENSHOT_TOOL_NAME = "browser_take_screenshot";

export function redirectScreenshotToTemporaryFile(
	toolName: string,
	input: Record<string, unknown>,
	toolCallId: string,
	temporaryDirectory = tmpdir(),
): string | undefined {
	if (!isScreenshotCall(toolName, input)) return undefined;

	const artifactDirectory = join(temporaryDirectory, ARTIFACT_DIRECTORY_NAME);
	mkdirSync(artifactDirectory, { recursive: true });
	const safeCallId = toolCallId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "capture";
	const screenshotPath = join(artifactDirectory, `screenshot-${process.pid}-${safeCallId}.png`);

	if (toolName === SCREENSHOT_TOOL_NAME) {
		input.filename = screenshotPath;
		return screenshotPath;
	}

	const args = mcpArguments(input.args);
	if (!args) return undefined;
	args.filename = screenshotPath;
	input.args = JSON.stringify(args);
	return screenshotPath;
}

export function removeVerificationArtifacts(artifactPaths: Iterable<string>): void {
	const directories = new Set<string>();
	for (const artifactPath of artifactPaths) {
		directories.add(dirname(artifactPath));
		try {
			rmSync(artifactPath, { force: true });
		} catch {
			// Best-effort cleanup must not hide the verification result.
		}
	}
	for (const directory of directories) {
		try {
			rmdirSync(directory);
		} catch {
			// Keep shared/non-empty temp directories intact.
		}
	}
}

function isScreenshotCall(toolName: string, input: Record<string, unknown>): boolean {
	if (toolName === SCREENSHOT_TOOL_NAME) return true;
	return toolName === "mcp" && input.action === "call" && input.tool === SCREENSHOT_TOOL_NAME;
}

function mcpArguments(candidate: unknown): Record<string, unknown> | undefined {
	if (candidate === undefined || candidate === "") return {};
	if (isRecord(candidate)) return { ...candidate };
	if (typeof candidate !== "string") return undefined;
	try {
		const parsed: unknown = JSON.parse(candidate);
		return isRecord(parsed) ? { ...parsed } : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

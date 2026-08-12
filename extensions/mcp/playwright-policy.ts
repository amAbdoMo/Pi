import { tmpdir } from "node:os";
import { join } from "node:path";

const PLAYWRIGHT_MCP_PACKAGE = /^@playwright\/mcp(?:@[^\\/]+)?$/i;
const PLAYWRIGHT_MCP_EXECUTABLE = /(?:^|[\\/])playwright-mcp(?:\.(?:cmd|exe))?$/i;

export function playwrightMcpArgsWithTemporaryOutput(
	command: string,
	args: string[],
	outputDirectory = join(tmpdir(), "pi-playwright-mcp"),
): string[] {
	if (![command, ...args].some(isPlaywrightMcpPart)) return [...args];

	const nextArgs = [...args];
	if (!hasOption(nextArgs, "--output-dir")) nextArgs.push("--output-dir", outputDirectory);
	return nextArgs;
}

function isPlaywrightMcpPart(part: string): boolean {
	return PLAYWRIGHT_MCP_PACKAGE.test(part) || PLAYWRIGHT_MCP_EXECUTABLE.test(part);
}

function hasOption(args: string[], optionName: string): boolean {
	return args.some((argument) => argument === optionName || argument.startsWith(`${optionName}=`));
}

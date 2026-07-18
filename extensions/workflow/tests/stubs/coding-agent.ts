import * as os from "node:os";
import * as path from "node:path";

export const CONFIG_DIR_NAME = ".pi";
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;

export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function getMarkdownTheme(): Record<string, never> {
  return {};
}

export function truncateHead(text: string, options: { maxBytes: number; maxLines: number }) {
  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf8");
  let selected = lines.slice(0, options.maxLines);
  while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf8") > options.maxBytes) selected.pop();
  const content = selected.join("\n");
  return {
    content,
    truncated: selected.length < lines.length || Buffer.byteLength(content, "utf8") < totalBytes,
    outputLines: selected.length,
    totalLines: lines.length,
    outputBytes: Buffer.byteLength(content, "utf8"),
    totalBytes,
  };
}

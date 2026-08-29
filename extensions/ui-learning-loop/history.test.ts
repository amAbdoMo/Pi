import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanUiCorrectionHistory } from "./history.ts";

function entry(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

test("imports corrections from named UI sessions without assistant transcripts", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-ui-history-"));
	try {
		const sessionPath = join(root, "webapp.jsonl");
		const contents = [
			entry({ type: "session", cwd: "C:/plugins/webapp" }),
			entry({ type: "session_info", name: "webapp wizard" }),
			entry({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "I updated the plugin button layout." }] } }),
			entry({ type: "message", message: { role: "user", content: [{ type: "text", text: "It is still too low password=json-secret" }] } }),
			entry({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "SECRET ASSISTANT TRANSCRIPT" }] } }),
		].join("");
		await writeFile(sessionPath, contents, "utf8");
		const scan = await scanUiCorrectionHistory({ root, days: 1, sessionPattern: /webapp wizard/i });
		assert.equal(scan.sessionsMatched, 1);
		assert.equal(scan.candidates.length, 1);
		assert.equal(scan.candidates[0].text, "It is still too low password=[REDACTED]");
		assert.equal(scan.candidates[0].source, "history");
		assert.equal(scan.candidates[0].cwd, "C:/plugins/webapp");
		assert.equal(scan.candidates[0].sessionFile, sessionPath);
		assert.equal(scan.candidates[0].text.includes("json-secret"), false);
		assert.equal(scan.candidates[0].text.includes("SECRET"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("excludes subagent sessions and nonmatching named sessions", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-ui-history-"));
	try {
		await mkdir(join(root, "subagents", "child"), { recursive: true });
		const correction = entry({ type: "message", message: { role: "user", content: [{ type: "text", text: "The dropdown is still wrong" }] } });
		await writeFile(join(root, "subagents", "child", "ignored.jsonl"), correction, "utf8");
		await writeFile(
			join(root, "other.jsonl"),
			entry({ type: "session_info", name: "Database work" }) + correction,
			"utf8",
		);
		const scan = await scanUiCorrectionHistory({ root, days: 1, sessionPattern: /webapp wizard/i });
		assert.equal(scan.sessionsMatched, 0);
		assert.equal(scan.candidates.length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface WorkspaceSnapshot {
	fingerprint: string;
	changedPaths: string[];
}

type ExecApi = Pick<ExtensionAPI, "exec">;

export async function captureWorkspaceSnapshot(pi: ExecApi, cwd: string): Promise<WorkspaceSnapshot | undefined> {
	try {
		const status = await pi.exec(
			"git",
			["status", "--porcelain=v1", "-z", "--untracked-files=all"],
			{ cwd, timeout: 10_000 },
		);
		if (status.code !== 0) return undefined;

		const changedEntries = parsePorcelainStatus(status.stdout);
		const diff = await trackedDiff(pi, cwd);
		const hash = createHash("sha256");
		hash.update(status.stdout);
		hash.update("\0tracked-diff\0");
		hash.update(diff);

		for (const entry of changedEntries.filter((candidate) => candidate.untracked)) {
			hash.update(`\0untracked:${entry.path}\0`);
			const absolutePath = resolve(cwd, entry.path);
			if (!isWithinDirectory(cwd, absolutePath)) continue;
			try {
				hash.update(await readFile(absolutePath));
			} catch {
				// Status still fingerprints unreadable, removed, or special files.
			}
		}

		return {
			fingerprint: hash.digest("hex"),
			changedPaths: [...new Set(changedEntries.map((entry) => entry.path))],
		};
	} catch {
		return undefined;
	}
}

interface ChangedEntry {
	path: string;
	untracked: boolean;
}

export function parsePorcelainStatus(output: string): ChangedEntry[] {
	const fields = output.split("\0").filter(Boolean);
	const entries: ChangedEntry[] = [];
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index]!;
		if (field.length < 4) continue;
		const status = field.slice(0, 2);
		const filePath = field.slice(3);
		entries.push({ path: filePath, untracked: status === "??" });
		if (/[RC]/.test(status)) {
			const previousPath = fields[index + 1];
			if (previousPath) {
				entries.push({ path: previousPath, untracked: false });
				index += 1;
			}
		}
	}
	return entries;
}

async function trackedDiff(pi: ExecApi, cwd: string): Promise<string> {
	const againstHead = await pi.exec("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
		cwd,
		timeout: 20_000,
	});
	if (againstHead.code === 0) return againstHead.stdout;

	const [staged, unstaged] = await Promise.all([
		pi.exec("git", ["diff", "--binary", "--no-ext-diff", "--cached", "--"], { cwd, timeout: 20_000 }),
		pi.exec("git", ["diff", "--binary", "--no-ext-diff", "--"], { cwd, timeout: 20_000 }),
	]);
	return `${staged.stdout}\0${unstaged.stdout}`;
}

function isWithinDirectory(directory: string, candidate: string): boolean {
	const root = resolve(directory);
	return candidate === root || candidate.startsWith(`${root}${sep}`);
}

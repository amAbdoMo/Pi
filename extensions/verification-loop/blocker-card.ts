import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Image, Text } from "@earendil-works/pi-tui";

import type { VerificationBlocker } from "./state.ts";

export const BLOCKER_ENTRY_TYPE = "verification-blocker-card";

interface BlockerCardData {
	blocker: VerificationBlocker;
	image?: {
		data: string;
		mimeType: "image/png";
	};
}

export function registerBlockerCardRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<BlockerCardData>(BLOCKER_ENTRY_TYPE, (entry, _options, theme) => {
		const card = new Container();
		card.addChild(new Text(theme.fg("error", theme.bold("Verification paused")), 1, 0));
		card.addChild(new Text(theme.fg("customMessageText", entry.data.blocker.summary), 1, 0));
		card.addChild(new Text(theme.fg("muted", [
			"Choose what happens next:",
			"1. I’ll log in now — keep this browser open",
			"2. Continue with non-browser checks and report the limitation",
			"3. Stop and summarize what remains",
			"4. Let me type another instruction",
		].join("\n")), 1, 0));
		if (entry.data.image) {
			card.addChild(new Image(entry.data.image.data, entry.data.image.mimeType, theme, {
				maxWidthCells: 72,
				maxHeightCells: 24,
			}));
		}
		return card;
	});
}

export async function appendBlockerCard(
	pi: ExtensionAPI,
	blocker: VerificationBlocker,
	screenshotPath?: string,
): Promise<boolean> {
	const image = screenshotPath ? await imageFromFile(screenshotPath) : undefined;
	pi.appendEntry<BlockerCardData>(BLOCKER_ENTRY_TYPE, { blocker, image });
	return image !== undefined;
}

async function imageFromFile(screenshotPath: string): Promise<BlockerCardData["image"] | undefined> {
	try {
		const data = await readFile(screenshotPath);
		if (data.length === 0) return undefined;
		return { data: data.toString("base64"), mimeType: "image/png" };
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
}

function isMissingFileError(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EACCES");
}

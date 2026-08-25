/**
 * ask-user — OpenCode-style interactive questions for the pi harness.
 *
 * Gives the model an `ask_user` tool that pops native pi selectors:
 *   • numbered options with descriptions, "(Recommended)" first
 *   • arrow keys + enter, or press its number to pick instantly
 *   • "Type your own answer" free-text entry (like OpenCode's)
 *   • Esc dismisses a question ("dismissed by user")
 *
 * Commands:
 *   /grill [topic] — run the grilling interview with these option UIs;
 *                    loads ~/.agents/skills/grilling/SKILL.md when present.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	buildSelectOptions,
	fallbackPromptText,
	formatAnswerSummary,
	type AnsweredQuestion,
	type AskOption,
} from "./format.ts";

const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 8;

type RawQuestion = {
	question?: unknown;
	options?: unknown;
	allowCustom?: unknown;
};

function normalizeOptions(raw: unknown): AskOption[] {
	if (!Array.isArray(raw)) return [];
	const parsed: AskOption[] = [];
	for (const item of raw.slice(0, MAX_OPTIONS)) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) continue;
		parsed.push({
			label,
			description: typeof record.description === "string" ? record.description : undefined,
			recommended: record.recommended === true,
		});
	}
	return parsed;
}

function normalizeQuestions(raw: unknown): { question: string; options: AskOption[]; allowCustom: boolean }[] {
	if (!Array.isArray(raw)) return [];
	const parsed: { question: string; options: AskOption[]; allowCustom: boolean }[] = [];
	for (const item of raw.slice(0, MAX_QUESTIONS)) {
		if (!item || typeof item !== "object") continue;
		const record = item as RawQuestion;
		const question = typeof record.question === "string" ? record.question.trim() : "";
		if (!question) continue;
		parsed.push({
			question,
			options: normalizeOptions(record.options),
			allowCustom: record.allowCustom !== false,
		});
	}
	return parsed;
}

async function askOne(
	ctx: ExtensionContext,
	question: string,
	options: AskOption[],
	allowCustom: boolean,
): Promise<AnsweredQuestion> {
	const entry: AnsweredQuestion = { question, answer: "", custom: false, dismissed: false };

	if (!ctx.hasUI) {
		entry.answer = fallbackPromptText([{ question, options }]).split("\n").slice(2).join("\n");
		entry.dismissed = true;
		return entry;
	}

	// No options: plain text input (OpenCode shows an input-only tab too).
	if (options.length === 0) {
		const answer = await ctx.ui.input(question);
		if (answer === undefined) {
			entry.dismissed = true;
			return entry;
		}
		entry.answer = answer;
		entry.custom = true;
		return entry;
	}

	const ordered = buildSelectOptions(options, allowCustom);
	const picked = await ctx.ui.select(question, ordered.rows);
	if (picked === undefined) {
		entry.dismissed = true;
		return entry;
	}
	if (picked === ordered.customRow) {
		const typed = await ctx.ui.input(question);
		if (typed === undefined || typed.trim() === "") {
			entry.dismissed = true;
			return entry;
		}
		entry.answer = typed.trim();
		entry.custom = true;
		return entry;
	}

	// Map the rendered row back to the canonical option label.
	const rowIndex = ordered.rows.indexOf(picked);
	const chosen = ordered.orderedOptions[rowIndex];
	entry.answer = chosen?.label ?? picked.replace(/^\d+\.\s*/, "").replace(/\s+—.*$/, "").replace(/\s+\(Recommended\)$/, "");
	return entry;
}

export default function askUserExtension(pi: ExtensionAPI): void {
	let lastRoundSummary = "";

	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: [
			"Ask the user 1-6 questions with interactive multiple-choice pickers (arrow keys / number keys / enter), each with an optional 'Type your own answer' field.",
			"Each question: { question, options: [{ label, description?, recommended? }], allowCustom? }. With no options the user gets a free-text input.",
			"Returns the chosen answers verbatim. Use for clarifications, decisions, and grill-style interviews instead of asking in plain text.",
		].join("\n"),
		promptSnippet: "Ask the user structured questions with interactive choice UIs",
		promptGuidelines: [
			"When you need a decision or clarification, prefer ask_user over plain-text questions.",
			"Batch independent questions into one call; mark exactly one option recommended when you have a preference.",
			"After receiving answers, act on them — do not re-ask answered questions.",
		],
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The question to show" }),
					options: Type.Optional(
						Type.Array(
							Type.Object({
								label: Type.String({ description: "Short answer text" }),
								description: Type.Optional(Type.String({ description: "One-line explanation shown under the label" })),
								recommended: Type.Optional(Type.Boolean({ description: "Show as (Recommended) and list it first" })),
							}),
						),
					),
					allowCustom: Type.Optional(Type.Boolean({ description: "Add a 'Type your own answer' entry (default true)" })),
				}),
				{ description: `1-${MAX_QUESTIONS} questions` },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions);
			if (questions.length === 0) {
				return {
					content: [{ type: "text", text: "No valid questions provided." }],
					isError: true,
				};
			}

			const answers: AnsweredQuestion[] = [];
			for (const item of questions) {
				answers.push(await askOne(ctx, item.question, item.options, item.allowCustom));
				ctx.ui.setStatus("ask-user", `${answers.length}/${questions.length} answered`);
			}
			ctx.ui.setStatus("ask-user", undefined);

			const summary = formatAnswerSummary(answers);
			lastRoundSummary = summary;
			const dismissed = answers.filter((answer) => answer.dismissed).length;
			return {
				content: [
					{
						type: "text",
						text: dismissed > 0
							? `${summary}\n\n${dismissed} question(s) dismissed — proceed carefully without assuming dismissed answers.`
							: summary,
					},
				],
				details: { answers },
			};
		},
		renderCall(args, theme) {
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			return new Text(
				theme.fg("toolTitle", theme.bold("ask_user ")) +
					theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`),
				0,
				0,
			);
		},
	});

	pi.registerCommand("grill", {
		description: "Grill me — interactive grilling interview with choice UIs",
		handler: async (args, ctx) => {
			const topic = args.trim();
			const skillPath = path.join(os.homedir(), ".agents", "skills", "grilling", "SKILL.md");
			let skillText = "";
			try {
				skillText = fs.readFileSync(skillPath, "utf8");
			} catch {
				skillText = "";
			}

			const intro = [
				"# Grilling session",
				topic ? `Topic: ${topic}` : "Topic: the plan, decision, or idea I give you next.",
				"",
				skillText
					? `Follow the grilling method from this skill file:\n\n${skillText}`
					: "Interview me relentlessly in rounds: map decisions as a design tree, ask every currently-unblocked question per round, wait for my answers before the next round, and stop only when nothing is left assumed. Do not act until we confirm shared understanding.",
				"",
				"IMPORTANT: For every question, use the ask_user tool so I can answer with the interactive pickers. Number your questions across rounds (Q1, Q2, ... continuing the count), give each question 2-5 concrete options where possible, and mark exactly one as recommended unless there is genuinely no basis for a recommendation.",
			].join("\n");

			await ctx.ui.notify(topic ? `Grilling on: ${topic}` : "Grilling session started — answer the pickers.", "info");
			pi.sendUserMessage(intro, { deliverAs: "nextTurn" });
		},
	});

	pi.registerCommand("grill-last", {
		description: "Re-show the last grill round answers",
		handler: async (_args, ctx) => {
			ctx.ui.notify(lastRoundSummary || "No grill round recorded yet in this session.", "info");
		},
	});
}

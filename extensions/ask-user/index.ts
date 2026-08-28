/**
 * ask-user — native Pi-framed interactive questions.
 *
 * The `ask_user` tool presents automatically numbered questions with direct,
 * selectable answers. A recommended answer is moved to the first row, while
 * context and option descriptions remain available only when clarification is
 * genuinely necessary.
 *
 * Commands:
 *   /grill [topic] — grilling interview driven through these pickers;
 *                    loads ~/.agents/skills/grilling/SKILL.md when present.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { FramedQuestionPicker, type PickerImage, type PickerResult } from "./picker.ts";
import {
	buildSelectOptions,
	fallbackPromptText,
	formatAnswerSummary,
	type AnsweredQuestion,
	type AskOption,
} from "./format.ts";

const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 8;

function stripQuestionNumber(question: string): string {
	const unnumbered = question.replace(/^Q\d+\s*[.:·—–-]\s*/i, "").trim();
	return unnumbered || question;
}

function normalizeOptions(raw: unknown): AskOption[] {
	if (!Array.isArray(raw)) return [];
	const parsed: AskOption[] = [];
	for (const item of raw.slice(0, MAX_OPTIONS)) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) continue;
		const description = typeof record.description === "string" ? record.description.trim() : "";
		parsed.push({
			label,
			description: description || undefined,
			recommended: record.recommended === true,
		});
	}
	return buildSelectOptions(parsed, false).orderedOptions;
}

function normalizeQuestions(raw: unknown): {
	question: string;
	context?: string;
	options: AskOption[];
	allowCustom: boolean;
}[] {
	if (!Array.isArray(raw)) return [];
	const parsed: {
		question: string;
		context?: string;
		options: AskOption[];
		allowCustom: boolean;
	}[] = [];
	for (const item of raw.slice(0, MAX_QUESTIONS)) {
		if (!item || typeof item !== "object") continue;
		const record = item as Record<string, unknown>;
		const rawQuestion = typeof record.question === "string" ? record.question.trim() : "";
		if (!rawQuestion) continue;
		parsed.push({
			question: stripQuestionNumber(rawQuestion),
			context: typeof record.context === "string" && record.context.trim() ? record.context.trim() : undefined,
			options: normalizeOptions(record.options),
			allowCustom: record.allowCustom !== false,
		});
	}
	return parsed;
}

type FramedAnswer = {
	answer: AnsweredQuestion;
	images: PickerImage[];
};

async function askOneFramed(
	ctx: ExtensionContext,
	questionNumber: number,
	question: string,
	context: string | undefined,
	options: AskOption[],
	allowCustom: boolean,
): Promise<FramedAnswer> {
	const entry: AnsweredQuestion = { question, answer: "", custom: false, dismissed: false };

	if (!ctx.hasUI || ctx.mode !== "tui") {
		entry.answer = fallbackPromptText([{ question, context, options }], questionNumber - 1);
		entry.dismissed = true;
		return { answer: entry, images: [] };
	}

	const result = await ctx.ui.custom<PickerResult>(
		(tui, theme, keybindings, done) =>
			new FramedQuestionPicker(tui, theme as never, keybindings, {
				questionNumber,
				title: question,
				context,
				options: options.map((option) => ({
					label: option.label,
					description: option.description,
					recommended: option.recommended,
				})),
				allowCustom,
			}, done),
	);

	if (!result) {
		entry.dismissed = true;
		return { answer: entry, images: [] };
	}
	entry.answer = result.value;
	entry.custom = result.custom;
	return { answer: entry, images: result.images };
}

export default function askUserExtension(pi: ExtensionAPI): void {
	let roundCounter = 0;
	let questionCounter = 0;
	let lastRoundSummary = "";
	let pendingGrillBrief: string | undefined;

	const resetInterviewState = (): void => {
		roundCounter = 0;
		questionCounter = 0;
		lastRoundSummary = "";
		pendingGrillBrief = undefined;
	};

	const grillSkillText = (): string => {
		const skillPath = path.join(os.homedir(), ".agents", "skills", "grilling", "SKILL.md");
		try {
			return fs.readFileSync(skillPath, "utf8");
		} catch {
			return "";
		}
	};

	const buildGrillPrompt = (topic: string): string => {
		const skillText = grillSkillText();
		return [
			"# Grilling session",
			topic ? `Topic: ${topic}` : "Topic: the plan, decision, or idea I give you next.",
			"",
			skillText
				? `Follow the grilling method from this skill file, WITH ONE OVERRIDE:\n\n${skillText}\n\nOVERRIDE: deliver every round through the ask_user tool instead of plain-text ❓ blocks. Do not add Q numbers to question titles; the picker numbers them automatically. Put the complete question in the question field. For ordinary grilling, omit context and option descriptions. Write each option label as a direct, self-contained answer the user could naturally choose, using first-person wording when appropriate—not as a category heading. Mark exactly one recommended answer with recommended: true; the picker moves it to the first row. Ask only currently-unblocked questions per call, then call ask_user again to branch on my answers.`
				: "Interview me relentlessly in rounds through ask_user. Do not add Q numbers; the picker numbers questions automatically. Use complete questions and direct, self-contained answer choices. Omit context and descriptions unless genuinely necessary. Stop only when nothing is left assumed, and do not act until we confirm shared understanding.",
		].join("\n");
	};

	// Deterministic trigger for "grill me ...": the user's message stays
	// EXACTLY as typed (displayed and sent verbatim). The grilling brief is
	// injected as a hidden before-agent-start message so the model is forced
	// through the pickers without rewriting what the user said.
	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" };
		const match = event.text.match(/^\s*(?:grill(?:ing)?\s+(?:me\s+)?(?:about\s+)?|grill\s*$)(.*)$/i);
		if (!match) return { action: "continue" };
		resetInterviewState();
		pendingGrillBrief = buildGrillPrompt(match[1]?.trim() ?? "");
		return { action: "continue" };
	});

	pi.on("before_agent_start", () => {
		if (!pendingGrillBrief) return;
		const brief = pendingGrillBrief;
		pendingGrillBrief = undefined;
		return {
			message: {
				customType: "ask-user-grill-brief",
				content: [{ type: "text", text: brief }],
				display: false,
			},
		};
	});

	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: [
			"DEFAULT for ANY clarification, interview, decision, plan approval, or mid-task choice — use this instead of asking questions in plain text. Grill/interview rounds (grilling skill) MUST deliver every question through this tool.",
			"Native Pi-framed pickers number questions automatically and move the recommended answer to the first row. Do not prefix question titles with Q1, Q2, etc.",
			"Write the complete question in `question`. Make every option label a direct, self-contained answer the user could naturally select; use first-person wording when appropriate. Use `context` or option `description` only when essential clarification cannot fit naturally in the question or answer—not by default.",
			"FOLLOW-UP MODE: call this tool again to branch on settled answers. Ask only currently-unblocked questions, and prefer small batches over one giant upfront batch.",
			"Each question: { question, context?, options?: [{ label, description?, recommended? }], allowCustom? }. With no options the user gets a free-text input. Returns chosen answers verbatim; dismissed questions are marked — never assume an answer for them.",
		].join("\n"),
		promptSnippet: "Ask the user structured questions with interactive choice UIs (default for all clarifications)",
		promptGuidelines: [
			"DEFAULT to ask_user for any clarification or decision — never ask questions in plain text while this tool is available.",
			"Do not write Q numbers in question titles; ask_user numbers them automatically.",
			"Write complete questions and direct, self-contained answer choices. For ordinary interviews, omit context and descriptions; use them only for essential clarification.",
			"Mark exactly one recommended option when a recommendation is appropriate; ask_user displays it first.",
			"Use follow-up calls to branch on earlier answers instead of forcing all questions upfront.",
			"After receiving answers, act on them — do not re-ask answered questions.",
		],
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "Complete question; do not include a Q number" }),
					context: Type.Optional(
						Type.String({ description: "Optional essential clarification; omit for ordinary Q&A" }),
					),
					options: Type.Optional(
						Type.Array(
							Type.Object({
								label: Type.String({ description: "Direct, self-contained answer the user can select" }),
								description: Type.Optional(Type.String({ description: "Optional essential clarification; omit by default" })),
								recommended: Type.Optional(Type.Boolean({ description: "Marked (Recommended) and listed first" })),
							}),
						),
					),
					allowCustom: Type.Optional(Type.Boolean({ description: "Add a 'Type your own answer' entry (default true)" })),
				}),
				{ description: `1-${MAX_QUESTIONS} questions for THIS call; call again to branch on answers` },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions);
			if (questions.length === 0) {
				return { content: [{ type: "text", text: "No valid questions provided." }], isError: true };
			}

			roundCounter += 1;
			const baseNumber = questionCounter;
			questionCounter += questions.length;

			const answers: AnsweredQuestion[] = [];
			const attachedImages: PickerImage[] = [];
			for (let i = 0; i < questions.length; i++) {
				const item = questions[i];
				const framedAnswer = await askOneFramed(
					ctx,
					baseNumber + i + 1,
					item.question,
					item.context,
					item.options,
					item.allowCustom,
				);
				answers.push(framedAnswer.answer);
				attachedImages.push(...framedAnswer.images);
				ctx.ui.setStatus("ask-user", `${baseNumber + i + 1} · ${i + 1}/${questions.length} answered`);
			}
			ctx.ui.setStatus("ask-user", undefined);

			const summary = formatAnswerSummary(answers, baseNumber);
			lastRoundSummary = summary;
			const dismissedCount = answers.filter((answer) => answer.dismissed).length;
			const followUpHint =
				"\n\n(Follow-up mode: call ask_user again to branch on these answers; numbering continues automatically.)";
			const summaryText =
				summary +
				(dismissedCount > 0
					? `\n\n${dismissedCount} question(s) dismissed — proceed carefully without assuming dismissed answers.`
					: "") +
				followUpHint;
			return {
				content: [
					{ type: "text" as const, text: summaryText },
					...attachedImages.map((image) => ({ type: "image" as const, ...image })),
				],
				details: { round: roundCounter, answers },
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
			resetInterviewState();
			await ctx.ui.notify(topic ? `Grilling on: ${topic}` : "Grilling session started — answer the pickers.", "info");
			pi.sendUserMessage(buildGrillPrompt(topic), { deliverAs: "nextTurn" });
		},
	});

	pi.registerCommand("grill-last", {
		description: "Re-show the last grill round answers",
		handler: async (_args, ctx) => {
			ctx.ui.notify(lastRoundSummary || "No grill round recorded yet in this session.", "info");
		},
	});
}

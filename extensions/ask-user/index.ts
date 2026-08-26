/**
 * ask-user — OpenCode-style interactive questions for the pi harness, v2.
 *
 * The `ask_user` tool pops framed, workspace-style question pickers
 * (┌─ ❓ Q1 · title ─┐ … └──┘) with:
 *   • numbered options + descriptions, "(Recommended)" first
 *   • arrow keys / number keys / enter, "Type your own answer" free text
 *   • rich multi-sentence context under the question title (markdown-ish)
 *
 * Follow-up mode: call ask_user again with `followUp: true` to branch on
 * earlier answers ("you picked WordPress → here are 3 WP-specific options")
 * without re-stating settled decisions.
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
import { FramedQuestionPicker, type PickerResult } from "./picker.ts";
import {
	fallbackPromptText,
	formatAnswerSummary,
	type AnsweredQuestion,
	type AskOption,
} from "./format.ts";

const MAX_QUESTIONS = 6;
const MAX_OPTIONS = 8;

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
		const question = typeof record.question === "string" ? record.question.trim() : "";
		if (!question) continue;
		parsed.push({
			question,
			context: typeof record.context === "string" && record.context.trim() ? record.context.trim() : undefined,
			options: normalizeOptions(record.options),
			allowCustom: record.allowCustom !== false,
		});
	}
	return parsed;
}

async function askOneFramed(
	ctx: ExtensionContext,
	questionNumber: number,
	question: string,
	context: string | undefined,
	options: AskOption[],
	allowCustom: boolean,
): Promise<AnsweredQuestion> {
	const entry: AnsweredQuestion = { question, answer: "", custom: false, dismissed: false };

	if (!ctx.hasUI || ctx.mode !== "tui") {
		entry.answer = fallbackPromptText([{ question, options }]);
		entry.dismissed = true;
		return entry;
	}

	if (options.length === 0) {
		const answer = await ctx.ui.input(question);
		if (answer === undefined || answer.trim() === "") {
			entry.dismissed = true;
			return entry;
		}
		entry.answer = answer.trim();
		entry.custom = true;
		return entry;
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
			}),
		done,
	);

	if (!result) {
		entry.dismissed = true;
		return entry;
	}
	entry.answer = result.value;
	entry.custom = result.custom;
	return entry;
}

export default function askUserExtension(pi: ExtensionAPI): void {
	let roundCounter = 0;
	let lastRoundSummary = "";

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
				? `Follow the grilling method from this skill file, WITH ONE OVERRIDE:\n\n${skillText}\n\nOVERRIDE: deliver every round through the ask_user tool (framed pickers) instead of plain-text ❓ blocks. Keep the numbered titles (Q1, Q2, … continuing across rounds). Put the question body into ask_user's 'context' field, put each option's explanation into its 'description', and express your ➡️ recommendation by marking that option recommended: true. Ask only currently-unblocked questions per call, then call ask_user again to branch on my answers.`
				: "Interview me relentlessly in rounds: map decisions as a design tree, ask every currently-unblocked question per call through the ask_user tool (framed pickers), then call it again to branch on my answers. Stop only when nothing is left assumed. Do not act until we confirm shared understanding.",
		].join("\n");
	};

	// Deterministic trigger for "grill me ...": the user's message stays
	// EXACTLY as typed (displayed and sent verbatim). The grilling brief is
	// injected as a hidden before-agent-start message so the model is forced
	// through the pickers without rewriting what the user said.
	let pendingGrillBrief: string | undefined;

	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" };
		const match = event.text.match(/^\s*(?:grill(?:ing)?\s+(?:me\s+)?(?:about\s+)?|grill\s*$)(.*)$/i);
		if (!match) return { action: "continue" };
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
			"Framed workspace-style pickers: numbered options with descriptions and a (Recommended) marker, plus 'Type your own answer'. Rich multi-sentence context is supported via the `context` field — put long explanations there instead of squeezing them into the title.",
			"FOLLOW-UP MODE: you may call this tool repeatedly within one round. Ask the unblocking questions first, then call again branching on answers ('you picked WordPress → these 3 WP-specific options'). Prefer small batches that branch over one giant upfront batch.",
			"Each question: { question, context?, options?: [{ label, description?, recommended? }], allowCustom? }. With no options the user gets a free-text input. Returns chosen answers verbatim; dismissed questions are marked — never assume an answer for them.",
		].join("\n"),
		promptSnippet: "Ask the user structured questions with interactive choice UIs (default for all clarifications)",
		promptGuidelines: [
			"DEFAULT to ask_user for any clarification or decision — never ask questions in plain text while this tool is available.",
			"Grill/interview rounds: every question goes through ask_user; keep the numbered titles (Q1, Q2, …) and put your ➡️ recommendation on the recommended option.",
			"Use follow-up calls to branch on earlier answers instead of forcing all questions upfront.",
			"Long background belongs in `context`; keep `question` short enough for a panel title.",
			"After receiving answers, act on them — do not re-ask answered questions.",
		],
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "Short question shown as the frame title" }),
					context: Type.Optional(
						Type.String({ description: "Rich multi-sentence background shown inside the frame under the title" }),
					),
					options: Type.Optional(
						Type.Array(
							Type.Object({
								label: Type.String({ description: "Short answer text" }),
								description: Type.Optional(Type.String({ description: "One-line explanation shown under the label" })),
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
			const baseNumber = (roundCounter - 1) * MAX_QUESTIONS;

			const answers: AnsweredQuestion[] = [];
			for (let i = 0; i < questions.length; i++) {
				const item = questions[i];
				answers.push(
					await askOneFramed(ctx, baseNumber + i + 1, item.question, item.context, item.options, item.allowCustom),
				);
				ctx.ui.setStatus("ask-user", `${baseNumber + i + 1} · ${i + 1}/${questions.length} answered`);
			}
			ctx.ui.setStatus("ask-user", undefined);

			const summary = formatAnswerSummary(answers, baseNumber);
			lastRoundSummary = summary;
			const dismissedCount = answers.filter((answer) => answer.dismissed).length;
			const followUpHint =
				"\n\n(Follow-up mode: call ask_user again to branch on these answers; numbering continues automatically.)";
			return {
				content: [
					{
						type: "text",
						text:
							summary +
							(dismissedCount > 0
								? `\n\n${dismissedCount} question(s) dismissed — proceed carefully without assuming dismissed answers.`
								: "") +
							followUpHint,
					},
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

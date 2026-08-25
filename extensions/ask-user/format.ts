// Pure helpers for the ask-user extension (unit-testable, no UI imports).

export type AskOption = {
	label: string;
	description?: string;
	recommended?: boolean;
};

export type AnsweredQuestion = {
	question: string;
	answer: string;
	custom: boolean;
	dismissed: boolean;
};

/** One selectable row inside the picker: "1. Label — description". */
export function formatOptionLabel(option: AskOption, index: number): string {
	let text = `${index + 1}. ${option.label}`;
	if (option.description) text += ` — ${option.description}`;
	if (option.recommended) text += " (Recommended)";
	return text;
}

/**
 * Options passed to ui.select, OpenCode style: numbered rows, recommended
 * first, plus a trailing "Type your own answer" entry when allowed.
 * Returns the ordered options too, so picked rows map back cleanly.
 */
export function buildSelectOptions(
	options: AskOption[],
	allowCustom: boolean,
): { rows: string[]; customRow?: string; orderedOptions: AskOption[] } {
	const orderedOptions = [...options];
	const firstRecommended = orderedOptions.findIndex((option) => option.recommended);
	if (firstRecommended > 0) {
		const [rec] = orderedOptions.splice(firstRecommended, 1);
		orderedOptions.unshift(rec);
	}
	const rows = orderedOptions.map((option, index) => formatOptionLabel(option, index));
	if (!allowCustom || orderedOptions.length === 0) return { rows, orderedOptions };
	const customRow = `${orderedOptions.length + 1}. Type your own answer`;
	return { rows: [...rows, customRow], customRow, orderedOptions };
}

/** Transcript-friendly summary handed back to the model after a round. */
export function formatAnswerSummary(answers: AnsweredQuestion[]): string {
	const lines: string[] = [];
	for (let i = 0; i < answers.length; i++) {
		const entry = answers[i];
		lines.push(`Q${i + 1}: ${entry.question}`);
		if (entry.dismissed) {
			lines.push("→ (dismissed by user)");
			continue;
		}
		lines.push(entry.custom ? `→ ${entry.answer} (custom answer)` : `→ ${entry.answer}`);
	}
	return lines.join("\n");
}

/** Fallback text when there is no interactive UI (RPC/print mode). */
export function fallbackPromptText(questions: { question: string; options?: AskOption[] }[]): string {
	const blocks = questions.map((question, index) => {
		const optionLines = (question.options ?? [])
			.map((option, optionIndex) => `   ${formatOptionLabel(option, optionIndex)}`)
			.join("\n");
		return `Q${index + 1}: ${question.question}${optionLines ? `\n${optionLines}` : ""}`;
	});
	return ["Interactive UI unavailable — ask these in plain text:", "", ...blocks].join("\n");
}

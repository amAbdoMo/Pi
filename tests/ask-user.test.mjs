import assert from "node:assert/strict";
import test from "node:test";
import {
	buildSelectOptions,
	fallbackPromptText,
	formatAnswerSummary,
	formatOptionLabel,
} from "../extensions/ask-user/format.ts";

test("option labels render OpenCode-style with description and recommendation", () => {
	assert.equal(
		formatOptionLabel({ label: "Terse", description: "One-liners", recommended: true }, 0),
		"1. Terse — One-liners (Recommended)",
	);
	assert.equal(formatOptionLabel({ label: "Balanced" }, 1), "2. Balanced");
});

test("select options put the recommended first and append a custom row", () => {
	const options = [
		{ label: "Balanced" },
		{ label: "Terse", recommended: true },
		{ label: "Detailed" },
	];
	const built = buildSelectOptions(options, true);
	assert.deepEqual(
		built.rows.map((row) => row.replace(/ — .*|\(Recommended\)/g, "").trim()),
		["1. Terse", "2. Balanced", "3. Detailed", "4. Type your own answer"],
	);
	assert.equal(built.customRow, "4. Type your own answer");
	assert.equal(built.orderedOptions[0].label, "Terse");
	assert.equal(built.orderedOptions[2].label, "Detailed");
});

test("custom row is omitted when disallowed or no options exist", () => {
	assert.equal(buildSelectOptions([{ label: "A" }], false).customRow, undefined);
	const empty = buildSelectOptions([], true);
	assert.equal(empty.customRow, undefined);
	assert.deepEqual(empty.rows, []);
});

test("answer summaries list every question with its answer state", () => {
	const summary = formatAnswerSummary([
		{ question: "Stack?", answer: "Python", custom: false, dismissed: false },
		{ question: "Verbosity?", answer: "shorter docs", custom: true, dismissed: false },
		{ question: "Deadline?", answer: "", custom: false, dismissed: true },
	]);
	assert.match(summary, /Q1: Stack\?\n→ Python\n/);
	assert.match(summary, /Q2: Verbosity\?\n→ shorter docs \(custom answer\)/);
	assert.match(summary, /Q3: Deadline\?\n→ \(dismissed by user\)/);
});

test("fallback prompt text lists questions and numbered options without UI", () => {
	const text = fallbackPromptText([
		{
			question: "Deploy target?",
			options: [{ label: "Staging", recommended: true }, { label: "Prod" }],
		},
	]);
	assert.match(text, /Interactive UI unavailable/);
	assert.match(text, /Q1: Deploy target\?/);
	assert.match(text, /1\. Staging —?\s*\(Recommended\)|1\. Staging.*\(Recommended\)/);
	assert.match(text, /2\. Prod/);
});

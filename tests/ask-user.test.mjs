import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Stub the pi packages so the extension + picker modules load bare (the repo
// has no node_modules for @earendil-works/*; see agent-time-wiring.test.mjs).
const tuiStub = `
export class Text {
  constructor(text) { this.text = String(text); }
  render() { return this.text; }
}
export function visibleWidth(text) {
  return [...String(text).replace(/\\x1b\\[[0-9;]*m/g, "")].length;
}
`;

const typeboxStub = `
export const Type = new Proxy({}, {
  get(_target, prop) {
    if (prop === "Optional") return (schema) => schema;
    return (opts) => ({ kind: String(prop), opts });
  },
});
`;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-tui") return { url: "stub:pi-tui", shortCircuit: true };
		if (specifier === "@earendil-works/pi-coding-agent") return { url: "stub:pia", shortCircuit: true };
		if (specifier === "typebox") return { url: "stub:typebox", shortCircuit: true };
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url === "stub:pi-tui" || url === "stub:pia") {
			return { format: "module", source: "export default {};", shortCircuit: true };
		}
		if (url === "stub:typebox") return { format: "module", source: typeboxStub, shortCircuit: true };
		if (url.endsWith(".ts")) {
			return {
				format: "module",
				source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
					mode: "transform",
					sourceMap: false,
				}),
				shortCircuit: true,
			};
		}
		return nextLoad(url, context);
	},
});

const { buildSelectOptions, formatAnswerSummary } = await import(
	`file://${path.join(os.homedir(), "Pi", "extensions", "ask-user", "format.ts").replaceAll("\\", "/")}`
);
const { FramedQuestionPicker } = await import(
	`file://${path.join(os.homedir(), "Pi", "extensions", "ask-user", "picker.ts").replaceAll("\\", "/")}`
);

const themeStub = new Proxy({}, {
	get(_target, prop) {
		if (prop === "bold") return (text) => `«${String(text)}»`;
		// fg(token, text) / dim(text) / accent(text) … → keep the text, mark it.
		return (...args) => {
			const text = args.length >= 2 ? args[1] : args[0];
			return `«${String(text ?? "")}»`;
		};
	},
});
const plain = (line) => line.replace(/«|»/g, "");

test("select options put the recommended first and append a custom row", () => {
	const options = [
		{ label: "Balanced" },
		{ label: "Terse", recommended: true },
		{ label: "Detailed" },
	];
	const built = buildSelectOptions(options, true);
	assert.equal(built.customRow, "4. Type your own answer");
	assert.equal(built.orderedOptions[0].label, "Terse");
	assert.equal(built.orderedOptions[2].label, "Detailed");
	assert.equal(buildSelectOptions([{ label: "A" }], false).customRow, undefined);
});

test("answer summaries support continuous numbering across follow-up rounds", () => {
	const summary = formatAnswerSummary(
		[
			{ question: "CMS?", answer: "WordPress", custom: false, dismissed: false },
			{ question: "Which plugin?", answer: "forms", custom: true, dismissed: false },
		],
		6,
	);
	assert.match(summary, /Q7: CMS\?\n→ WordPress/);
	assert.match(summary, /Q8: Which plugin\?\n→ forms \(custom answer\)/);
});

function makePicker(options, opts = {}) {
	const sent = [];
	const done = (result) => sent.push(result);
	const picker = new FramedQuestionPicker({}, themeStub, {}, {
		questionNumber: 3,
		title: "Primary project?",
		context: "Pick the focus for this week.",
		options,
		allowCustom: true,
		...opts,
	}, done);
	return { picker, sent };
}

test("framed picker renders workspace-style borders, title, context, and options", () => {
	const { picker } = makePicker([
		{ label: "WorkflowY", description: "Electron app work", recommended: true },
		{ label: "Pi harness", description: "extensions and guards" },
	]);
	const lines = picker.render(60).map(plain);
	assert.ok(lines[0].startsWith("┌─ ❓ Q3 · Primary project?"), lines[0]);
	assert.ok(lines.some((line) => line.includes("Pick the focus for this week.")));
	assert.ok(lines.some((line) => line.includes("❯ 1. WorkflowY")), "selected row highlighted");
	assert.ok(lines.some((line) => line.includes("Electron app work")));
	assert.ok(lines.some((line) => line.includes("(Recommended)")));
	assert.ok(lines.some((line) => line.includes("3. Type your own answer")));
	const last = lines[lines.length - 1];
	assert.ok(last.startsWith("└"), last);
	for (const line of lines.slice(1, -1)) assert.ok(line.startsWith("│ "), line);
});

test("number keys quick-pick and enter activates the selected row", () => {
	const first = makePicker([{ label: "A" }, { label: "B" }]);
	first.picker.handleInput("1");
	assert.deepEqual(first.sent, [{ value: "A", custom: false }]);

	const second = makePicker([{ label: "A" }, { label: "B" }]);
	second.picker.handleInput("\x1b[B"); // down
	second.picker.handleInput("\r"); // enter
	assert.deepEqual(second.sent, [{ value: "B", custom: false }]);
});

test("custom row opens an inline input; enter submits, esc cancels back", () => {
	const custom = makePicker([{ label: "A" }]);
	custom.picker.handleInput("2"); // custom row is #2 with one option
	let rendered = custom.picker.render(40).map(plain);
	assert.ok(rendered.some((line) => line.includes("❯ ")), "input prompt visible");
	custom.picker.handleInput("h");
	custom.picker.handleInput("i");
	custom.picker.handleInput("\r");
	assert.deepEqual(custom.sent, [{ value: "hi", custom: true }]);

	const cancelled = makePicker([{ label: "A" }]);
	cancelled.picker.handleInput("2");
	cancelled.picker.handleInput("\x1b"); // esc returns to options
	cancelled.picker.handleInput("1");
	assert.deepEqual(cancelled.sent, [{ value: "A", custom: false }]);
});

test("esc dismisses the whole question and arrows wrap around", () => {
	const dismissed = makePicker([{ label: "A" }, { label: "B" }]);
	dismissed.picker.handleInput("\x1b");
	assert.deepEqual(dismissed.sent, [undefined]);

	// No custom row: exactly two rows, up from A wraps to B.
	const wrapped = makePicker([{ label: "A" }, { label: "B" }], { allowCustom: false });
	wrapped.picker.handleInput("\x1b[A"); // up from index 0 wraps to last
	wrapped.picker.handleInput("\r");
	assert.deepEqual(wrapped.sent, [{ value: "B", custom: false }]);
});

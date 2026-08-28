import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Resolve the repo root from THIS test file so it works in any checkout
// (local clone, CI workspace, installed package copy).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relative) =>
	`file://${path.join(repoRoot, relative).replaceAll("\\", "/")}`;

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
		if (url === "stub:pi-tui") return { format: "module", source: tuiStub, shortCircuit: true };
		if (url === "stub:pia") {
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
	moduleUrl(path.join("extensions", "ask-user", "format.ts"))
);
const { FramedQuestionPicker } = await import(
	moduleUrl(path.join("extensions", "ask-user", "picker.ts"))
);

function makeHarness() {
	const handlers = new Map();
	const sent = [];
	const pi = {
		on(event, handler) { handlers.set(event, handler); },
		registerTool() {},
		registerCommand() {},
		sendUserMessage(content) { sent.push(content); },
	};
	return { pi, handlers, sent };
}

test('typed "grill me ..." keeps the message verbatim and injects a hidden brief', async () => {
	const { pi, handlers, sent } = makeHarness();
	const extension = await import(moduleUrl(path.join("extensions", "ask-user", "index.ts")));
	extension.default(pi);
	const inputHandler = handlers.get("input");
	const agentStartHandler = handlers.get("before_agent_start");
	assert.ok(inputHandler && agentStartHandler, "input + before_agent_start handlers registered");

	// The user's message passes through untouched (displayed as typed).
	const inputResult = inputHandler({ type: "input", text: "grill me about egypt", source: "interactive" });
	assert.deepEqual(inputResult, { action: "continue" });

	// At agent start, the grilling brief rides along as a HIDDEN message.
	const startResult = agentStartHandler({ type: "before_agent_start", prompt: "grill me about egypt" });
	assert.ok(startResult?.message, "hidden brief message returned");
	assert.equal(startResult.message.display, false);
	assert.match(startResult.message.content[0].text, /# Grilling session/);
	assert.match(startResult.message.content[0].text, /Topic: egypt/);
	assert.match(startResult.message.content[0].text, /ask_user tool \(framed pickers\)/);
	assert.ok(!sent.length, "no direct user message sent");

	// One-shot: consumed after a single turn.
	const second = agentStartHandler({ type: "before_agent_start", prompt: "hello" });
	assert.equal(second, undefined);

	// Non-grill text arms nothing.
	inputHandler({ type: "input", text: "hello world", source: "interactive" });
	assert.equal(agentStartHandler({ type: "before_agent_start", prompt: "hello world" }), undefined);

	// Extension-sourced grill text never arms the brief (loop guard).
	inputHandler({ type: "input", text: "grill me about x", source: "extension" });
	assert.equal(agentStartHandler({ type: "before_agent_start", prompt: "x" }), undefined);
});

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

test("ask_user custom picker completes through the UI callback", async () => {
	let askUserTool;
	const extension = await import(moduleUrl(path.join("extensions", "ask-user", "index.ts")));
	extension.default({
		on() {},
		registerTool(tool) { askUserTool = tool; },
		registerCommand() {},
		sendUserMessage() {},
	});
	assert.ok(askUserTool, "ask_user tool registered");

	const response = await askUserTool.execute(
		"ask-user-regression",
		{
			questions: [{
				question: "Primary focus?",
				options: [{ label: "Egypt", recommended: true }],
				allowCustom: false,
			}],
		},
		undefined,
		undefined,
		{
			hasUI: true,
			mode: "tui",
			ui: {
				custom(factory) {
					return new Promise((done) => {
						const picker = factory({}, themeStub, {}, done);
						picker.handleInput("1");
					});
				},
				setStatus() {},
			},
		},
	);

	assert.equal(response.details.answers[0].answer, "Egypt");
	assert.match(response.content[0].text, /Q1: Primary focus\?\n→ Egypt/);
});

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

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
export function truncateToWidth(text, width, suffix = "") {
  const value = String(text);
  if (visibleWidth(value) <= width) return value;
  const plain = value.replace(/\\x1b\\[[0-9;]*m/g, "");
  return [...plain].slice(0, Math.max(0, width - visibleWidth(suffix))).join("") + suffix;
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

const { buildSelectOptions, fallbackPromptText, formatAnswerSummary } = await import(
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
	const grillBrief = startResult.message.content[0].text;
	assert.match(grillBrief, /ask_user tool/);
	assert.match(grillBrief, /Do not add Q numbers/i);
	assert.match(grillBrief, /direct, self-contained answer/i);
	assert.match(grillBrief, /omit context and option descriptions/i);
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
const tuiRuntimeStub = { requestRender() {} };

test("ask_user keeps every question framed, sequential, and recommended-first", async () => {
	let askUserTool;
	let inputHandler;
	const renderedFrames = [];
	const extension = await import(moduleUrl(path.join("extensions", "ask-user", "index.ts")));
	extension.default({
		on(event, handler) {
			if (event === "input") inputHandler = handler;
		},
		registerTool(tool) { askUserTool = tool; },
		registerCommand() {},
		sendUserMessage() {},
	});
	assert.ok(askUserTool && inputHandler, "ask_user tool and grill trigger registered");

	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom(factory) {
				return new Promise((done) => {
					const picker = factory(tuiRuntimeStub, themeStub, {}, done);
					renderedFrames.push(picker.render(80).map(plain));
					picker.handleInput("1");
				});
			},
			setStatus() {},
		},
	};

	const firstResponse = await askUserTool.execute(
		"ask-user-first",
		{
			questions: [{
				question: "Q1 — Primary focus?",
				options: [
					{ label: "I want to discuss Egypt" },
					{ label: "I want to improve Pi", recommended: true },
				],
				allowCustom: false,
			}],
		},
		undefined,
		undefined,
		ctx,
	);
	const secondResponse = await askUserTool.execute(
		"ask-user-second",
		{
			questions: [{
				question: "Q2 — How should we continue?",
				options: [{ label: "I want the recommended approach", recommended: true }],
				allowCustom: false,
			}],
		},
		undefined,
		undefined,
		ctx,
	);
	let freeTextFrame;
	const freeTextResponse = await askUserTool.execute(
		"ask-user-free-text",
		{
			questions: [{
				question: "Q3 — What should I add?",
				context: "Use your own words.",
			}],
		},
		undefined,
		undefined,
		{
			...ctx,
			ui: {
				...ctx.ui,
				custom(factory) {
					return new Promise((done) => {
						const picker = factory(tuiRuntimeStub, themeStub, {}, done);
						freeTextFrame = picker.render(80).map(plain);
						picker.handleInput("A direct answer");
						picker.handleInput("\r");
					});
				},
			},
		},
	);
	inputHandler({ type: "input", text: "grill me about a fresh topic", source: "interactive" });
	const resetResponse = await askUserTool.execute(
		"ask-user-reset",
		{
			questions: [{
				question: "Q1 — Start fresh?",
				options: [{ label: "Yes", recommended: true }],
				allowCustom: false,
			}],
		},
		undefined,
		undefined,
		ctx,
	);

	assert.equal(firstResponse.details.answers[0].answer, "I want to improve Pi");
	assert.match(firstResponse.content[0].text, /Q1: Primary focus\?/);
	assert.doesNotMatch(firstResponse.content[0].text, /Q1: Q1/);
	assert.match(secondResponse.content[0].text, /Q2: How should we continue\?/);
	assert.match(freeTextResponse.content[0].text, /Q3: What should I add\?\n→ A direct answer/);
	assert.match(resetResponse.content[0].text, /Q1: Start fresh\?\n→ Yes/);
	assert.equal(resetResponse.details.round, 1);
	assert.ok(renderedFrames[0][0].startsWith("╭ Q1 — Primary focus? "), renderedFrames[0][0]);
	assert.ok(renderedFrames[1][0].startsWith("╭ Q2 — How should we continue? "), renderedFrames[1][0]);
	assert.ok(freeTextFrame[0].startsWith("╭ Q3 — What should I add? "), freeTextFrame[0]);
	assert.ok(freeTextFrame.some((line) => line.includes("Use your own words.")));
	assert.ok(freeTextFrame.some((line) => line.includes("❯ ▏")), "free-text input starts inside the frame");
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

test("answer summaries start at the supplied question offset", () => {
	const summary = formatAnswerSummary(
		[
			{ question: "CMS?", answer: "WordPress", custom: false, dismissed: false },
			{ question: "Which plugin?", answer: "forms", custom: true, dismissed: false },
		],
		1,
	);
	assert.match(summary, /Q2: CMS\?\n→ WordPress/);
	assert.match(summary, /Q3: Which plugin\?\n→ forms \(custom answer\)/);
});

test("non-interactive fallback preserves question offset and context", () => {
	const fallback = fallbackPromptText(
		[{ question: "Why?", context: "Explain the trade-off.", options: [] }],
		2,
	);
	assert.match(fallback, /Q3: Why\?\n   Explain the trade-off\./);
});

function makePicker(options, opts = {}, theme = themeStub) {
	const sent = [];
	const done = (result) => sent.push(result);
	const picker = new FramedQuestionPicker(tuiRuntimeStub, theme, {}, {
		questionNumber: 3,
		title: "Primary project?",
		context: "Pick the focus for this week.",
		options,
		allowCustom: true,
		...opts,
	}, done);
	return { picker, sent };
}

test("framed picker uses Pi's native border and keeps clarification optional", () => {
	const usedColors = [];
	const nativeTheme = {
		bold(text) { return text; },
		fg(color, text) {
			usedColors.push(color);
			return String(text);
		},
	};
	const { picker } = makePicker([
		{ label: "WorkflowY", description: "Electron app work", recommended: true },
		{ label: "Pi harness", description: "extensions and guards" },
	], {}, nativeTheme);
	const lines = picker.render(60);
	assert.ok(lines[0].startsWith("╭ Q3 — Primary project? "), lines[0]);
	assert.ok(lines.some((line) => line.includes("Pick the focus for this week.")));
	const recommendedLine = lines.find((line) => line.includes("WorkflowY"));
	assert.ok(recommendedLine?.includes("Recommended"), recommendedLine);
	assert.ok(lines.some((line) => line.includes("Electron app work")));
	assert.ok(lines.some((line) => line.includes("3. Type your own answer")));
	assert.ok(usedColors.includes("border"), "native border theme token used");
	assert.ok(!usedColors.includes("borderMuted"), "muted border theme token omitted");
	const last = lines[lines.length - 1];
	assert.ok(last.startsWith("╰"), last);
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

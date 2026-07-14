import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

const tuiStub = String.raw`
  export const Key = { escape: "escape", up: "up", down: "down", enter: "enter" };
  export function matchesKey(data, key) { return data === key; }
  export function isKeyRelease() { return false; }
  export function visibleWidth(text) {
    return [...String(text).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")].length;
  }
  export function truncateToWidth(text, width, ellipsis = "") {
    if (width <= 0) return "";
    const chars = [...String(text)];
    if (visibleWidth(text) <= width) return String(text);
    const suffix = [...ellipsis].slice(0, width).join("");
    return chars.slice(0, Math.max(0, width - visibleWidth(suffix))).join("") + suffix;
  }
  export function wrapTextWithAnsi(text, width) {
    const safeWidth = Math.max(1, width);
    const chars = [...String(text)];
    if (chars.length === 0) return [];
    const lines = [];
    for (let index = 0; index < chars.length; index += safeWidth) {
      lines.push(chars.slice(index, index + safeWidth).join(""));
    }
    return lines;
  }
  export class Markdown {
    constructor(text) { this.text = text; }
    render(width) {
      return String(this.text).split("\n").flatMap((line) => wrapTextWithAnsi(line || " ", width));
    }
  }
  export class Text extends Markdown {}
  export class Input {
    constructor() { this.value = ""; this.focused = false; }
    setValue(value) { this.value = value; }
    render(width) { return [truncateToWidth(this.value, width, "")]; }
    handleInput(data) {
      if (data === Key.enter) this.onSubmit?.(this.value);
      else if (data === Key.escape) this.onEscape?.();
      else this.value += data;
    }
  }
`;

const moduleStubs = new Map([
  ["@earendil-works/pi-tui", tuiStub],
  ["@earendil-works/pi-coding-agent", "export function getMarkdownTheme() { return {}; }"],
  ["@earendil-works/pi-ai", "export function StringEnum() { return {}; }"],
  ["typebox", "export const Type = new Proxy({}, { get: () => () => ({}) });"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduleStubs.has(specifier)) {
      return { url: `workbench-stub:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("workbench-stub:")) {
      const specifier = url.slice("workbench-stub:".length);
      return {
        format: "module",
        source: moduleStubs.get(specifier),
        shortCircuit: true,
      };
    }
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

const { visibleWidth } = await import("@earendil-works/pi-tui");
const { framedPanel: framedSubagentPanel, statusText } = await import(
  "../extensions/subagents/render/common.ts"
);
const { AgentsOverlay } = await import(
  "../extensions/subagents/ui/agents-overlay.ts"
);
const { ChildConsoleOverlay } = await import(
  "../extensions/subagents/ui/child-console-overlay.ts"
);
const { framedPanel: framedSideChatPanel } = await import(
  "../extensions/side-chat/frame.ts"
);
const { renderTranscript } = await import(
  "../extensions/side-chat/transcript.ts"
);
const { SideChatOverlay } = await import(
  "../extensions/side-chat/overlay.ts"
);
const { renderWorkflowPanel, statusIcon } = await import(
  "../extensions/workflow/index.ts"
);

const theme = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
  bold: (text) => text,
};

function assertWidthSafe(lines, width) {
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(
      visibleWidth(line) <= width,
      `expected line width <= ${width}, received ${visibleWidth(line)}: ${line}`,
    );
  }
}

test("workbench frames remain width-safe without heavy borders", () => {
  for (const width of [8, 12, 24, 52]) {
    const subagent = framedSubagentPanel(
      theme,
      "Sub-agent / a-very-long-agent-label",
      ["A deliberately long activity line that must be fitted."],
      width,
      3,
    );
    const sideChat = framedSideChatPanel(
      theme,
      "Side chat with a title that exceeds narrow terminals",
      ["A deliberately long transcript line that must be fitted."],
      width,
    );

    assertWidthSafe(subagent, width);
    assertWidthSafe(sideChat, width);
    assert.ok(subagent[0].startsWith("┌"));
    assert.ok(sideChat[0].startsWith("┌"));
    assert.doesNotMatch(subagent.join("\n"), /[┏┓┗┛━┃]/u);
  }
});

test("sub-agent status labels distinguish active, completed, and failed work", () => {
  assert.equal(statusText("running", theme), "◉ running");
  assert.equal(statusText("completed", theme), "✓ completed");
  assert.equal(statusText("failed", theme), "✕ failed");
  assert.equal(statusText("waiting_for_answer", theme), "◉ waiting");
});

test("secondary overlays give guidance and stay width-safe", () => {
  const agents = new AgentsOverlay(theme, () => [], () => {}, () => {}, () => 10);
  const child = new ChildConsoleOverlay(
    theme,
    {
      id: "child-1",
      generatedLabel: "Width check",
      status: "running",
      depth: 1,
      createdAt: Date.now(),
      events: [],
    },
    () => {},
    () => {},
    () => 10,
  );
  const sideChat = new SideChatOverlay(
    theme,
    {
      items: [],
      snapshot: {
        model: { provider: "test", id: "width-check" },
        inheritedMessages: [],
      },
      isBusy: false,
      setRequestRender() {},
      submit() { return true; },
    },
    () => {},
    () => {},
    () => 10,
  );

  try {
    for (const width of [12, 28, 64]) {
      assertWidthSafe(agents.render(width), width);
      assertWidthSafe(child.render(width), width);
      assertWidthSafe(sideChat.render(width), width);
    }
    const guidance = agents.render(64).join("\n");
    assert.match(guidance, /No active sub-agents\./);
    assert.match(guidance, /delegate tool/);
  } finally {
    agents.dispose();
    child.dispose();
  }
});

test("side-chat transcript uses explicit running, completed, and failed semantics", () => {
  const lines = renderTranscript(
    theme,
    [
      { kind: "assistant", text: "Working", running: true },
      { kind: "tool", text: "read source", status: "running" },
      { kind: "tool", text: "read source", status: "done" },
      { kind: "tool", text: "read source", status: "error" },
    ],
    32,
  );
  const output = lines.join("\n");

  assert.match(output, /◉ answering/);
  assert.match(output, /◉ running/);
  assert.match(output, /✓ completed/);
  assert.match(output, /✕ failed/);
  assertWidthSafe(lines, 32);
});

test("workflow panel preserves status semantics from narrow to wide terminals", () => {
  const state = {
    runId: "run-1",
    workflowId: "quality-gate-with-a-long-name",
    description: "",
    input: "",
    status: "failed",
    phases: [
      { id: "prepare", status: "succeeded", logs: [] },
      { id: "verify", status: "failed", logs: [{ kind: "error", text: "Validation failed with concise evidence.", timestamp: 0 }] },
    ],
    selectedPhaseId: "verify",
    startedAt: 0,
    endedAt: 1,
    composer: "",
    scrollOffset: 0,
    focused: false,
  };

  assert.equal(statusIcon("running", theme), "◉");
  assert.equal(statusIcon("succeeded", theme), "✓");
  assert.equal(statusIcon("failed", theme), "✕");

  for (const width of [12, 32, 51, 52, 80]) {
    const lines = renderWorkflowPanel(state, width, theme);
    assertWidthSafe(lines, width);
    assert.match(lines.join("\n"), /failed/);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

const codingAgentStub = String.raw`
  export class CustomEditor {
    constructor(tui) {
      this.tui = tui;
      this.text = "";
      this.autocompleteVisible = false;
      this.handledInputs = [];
    }
    getText() { return this.text; }
    setText(text) { this.text = text; }
    isShowingAutocomplete() { return this.autocompleteVisible; }
    setAutocompleteVisible(visible) { this.autocompleteVisible = visible; }
    handleInput(data) { this.handledInputs.push(data); }
    invalidate() {}
    render() { return [this.text]; }
  }
`;

const tuiStub = String.raw`
  export const CURSOR_MARKER = "";
  export function matchesKey(data, key) {
    return key === "tab" ? data === "\t" : data === key;
  }
  export function visibleWidth(text) { return [...String(text)].length; }
  export function truncateToWidth(text, width, ellipsis = "") {
    const chars = [...String(text)];
    if (chars.length <= width) return String(text);
    return chars.slice(0, Math.max(0, width - ellipsis.length)).join("") + ellipsis;
  }
`;

const moduleStubs = new Map([
  ["@earendil-works/pi-coding-agent", codingAgentStub],
  ["@earendil-works/pi-tui", tuiStub],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduleStubs.has(specifier)) {
      return { url: `terminal-editor-stub:${specifier}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("terminal-editor-stub:")) {
      return {
        format: "module",
        source: moduleStubs.get(url.slice("terminal-editor-stub:".length)),
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

const { TerminalEditor } = await import("../extensions/ui/terminalEditor.ts");
const TAB = "\t";

function createEditor() {
  let modeToggles = 0;
  const editor = new TerminalEditor(
    { requestRender() {} },
    {},
    {},
    () => { modeToggles += 1; },
  );
  return { editor, modeToggles: () => modeToggles };
}

test("Tab delegates slash commands to editor autocomplete", () => {
  const { editor, modeToggles } = createEditor();
  editor.setText("/workflow");

  editor.handleInput(TAB);

  assert.deepEqual(editor.handledInputs, [TAB]);
  assert.equal(modeToggles(), 0);
});

test("Tab delegates a visible non-slash completion to editor autocomplete", () => {
  const { editor, modeToggles } = createEditor();
  editor.setText("@README");
  editor.setAutocompleteVisible(true);

  editor.handleInput(TAB);

  assert.deepEqual(editor.handledInputs, [TAB]);
  assert.equal(modeToggles(), 0);
});

test("Tab toggles PLAN/BUILD for ordinary and empty prompts", () => {
  const { editor, modeToggles } = createEditor();

  editor.setText("ordinary prompt");
  editor.handleInput(TAB);
  assert.deepEqual(editor.handledInputs, []);
  assert.equal(modeToggles(), 1);

  editor.setText("");
  editor.handleInput(TAB);
  assert.deepEqual(editor.handledInputs, []);
  assert.equal(modeToggles(), 2);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

const tuiStub = String.raw`
  export const CURSOR_MARKER = "";
  export const Key = {
    escape: "escape",
    up: "up",
    down: "down",
    enter: "enter",
    ctrl: (key) => "ctrl+" + key,
    ctrlAlt: (key) => "ctrl+alt+" + key,
  };
  export function matchesKey(data, key) { return data === key; }
  export function isKeyRelease() { return false; }
  function cellWidth(character) {
    const code = character.codePointAt(0);
    return code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    ) ? 2 : 1;
  }
  export function visibleWidth(text) {
    const plain = String(text).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
    return [...plain].reduce((width, character) => width + cellWidth(character), 0);
  }
  export function truncateToWidth(text, width, ellipsis = "", pad = false) {
    if (width <= 0) return "";
    const chars = [...String(text)];
    let output = visibleWidth(text) <= width
      ? String(text)
      : chars.slice(0, Math.max(0, width - visibleWidth(ellipsis))).join("") + ellipsis;
    if (pad) output += " ".repeat(Math.max(0, width - visibleWidth(output)));
    return output;
  }
  export function sliceByColumn(text, start, length, strict = false) {
    const plain = String(text).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "");
    const end = start + length;
    let column = 0;
    let output = "";
    for (const character of plain) {
      const width = cellWidth(character);
      if (column >= start && column < end && (!strict || column + width <= end)) output += character;
      column += width;
      if (column >= end) break;
    }
    return output;
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

const codingAgentStub = String.raw`
  export const CONFIG_DIR_NAME = ".pi";
  export const DEFAULT_MAX_BYTES = 50 * 1024;
  export const DEFAULT_MAX_LINES = 2000;
  export function getAgentDir() { return process.cwd(); }
  export function getMarkdownTheme() { return {}; }
  export async function copyToClipboard() {}
  export function truncateHead(text, options) {
    const lines = String(text).split("\n");
    let selected = lines.slice(0, options.maxLines);
    while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf8") > options.maxBytes) selected.pop();
    const content = selected.join("\n");
    return {
      content,
      truncated: content !== text,
      outputLines: selected.length,
      totalLines: lines.length,
      outputBytes: Buffer.byteLength(content, "utf8"),
      totalBytes: Buffer.byteLength(text, "utf8"),
    };
  }
  export class CustomEditor {
    constructor(tui) {
      this.tui = tui;
      this.text = "";
      this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
      this.lastWidth = 1;
      this.scrollOffset = 0;
      this.autocompleteVisible = false;
      this.handledInputs = [];
    }
    getText() { return this.state.lines.join("\n"); }
    getLines() { return [...this.state.lines]; }
    getCursor() { return { line: this.state.cursorLine, col: this.state.cursorCol }; }
    setText(text) {
      this.text = text;
      this.state.lines = String(text).split("\n");
      this.state.cursorLine = this.state.lines.length - 1;
      this.state.cursorCol = this.state.lines.at(-1).length;
    }
    setCursorCol(column) { this.state.cursorCol = Math.max(0, Math.min(column, this.state.lines[this.state.cursorLine].length)); }
    buildVisualLineMap(width) {
      return this.state.lines.flatMap((line, logicalLine) => {
        if (!line) return [{ logicalLine, startCol: 0, length: 0 }];
        const rows = [];
        for (let startCol = 0; startCol < line.length; startCol += width) {
          rows.push({ logicalLine, startCol, length: Math.min(width, line.length - startCol) });
        }
        return rows;
      });
    }
    cancelAutocomplete() { this.autocompleteVisible = false; }
    exitHistoryBrowsing() {}
    isShowingAutocomplete() { return this.autocompleteVisible; }
    setAutocompleteVisible(visible) { this.autocompleteVisible = visible; }
    handleInput(data) { this.handledInputs.push(data); }
    invalidate() {}
    render(width) { this.lastWidth = Math.max(1, width - 1); return [this.text]; }
  }
`;

const moduleStubs = new Map([
  ["@earendil-works/pi-tui", tuiStub],
  ["@earendil-works/pi-coding-agent", codingAgentStub],
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
const { installWorkbenchShell } = await import(
  "../extensions/ui/workbenchShell.ts"
);
const { sessionPiHeader } = await import("../extensions/ui/piHeader.ts");
const {
  clampSelectionPoint,
  highlightTerminalSelection,
  selectedTerminalText,
} = await import("../extensions/ui/textSelection.ts");
const { TerminalEditor } = await import(
  "../extensions/ui/terminalEditor.ts"
);
const { WorkbenchSidebar, WorkbenchSidebarController } = await import(
  "../extensions/ui/workbenchSidebar.ts"
);
const { state: workbenchState, updateState } = await import(
  "../extensions/ui/state.ts"
);
const { editors } = await import("../extensions/ui/editorRegistry.ts");
const { default: uiExtension } = await import("../extensions/ui/index.ts");
const { publishMcpStatus } = await import(
  "../extensions/mcp/status.ts"
);
const { default: planModeExtension } = await import(
  "../extensions/plan-mode/index.ts"
);
const {
  beginWorkflowActivity,
  clearWorkflowActivity,
  projectWorkflowActivityEvent,
  setWorkflowActivityPhase,
} = await import("../extensions/workflow/activity.ts");
const { getSubagentsSnapshot, subagentsLabel } = await import(
  "../extensions/ui/subagents.ts"
);

const theme = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
  bold: (text) => text,
};

test("large Pi art appears only when Pi starts or creates a new session", () => {
  const startupHeader = sessionPiHeader(theme, 200, "startup");

  assert.equal(startupHeader.length, 23);
  assert.equal(startupHeader[0], "");
  assert.equal(startupHeader.at(-1), "");
  assert.match(startupHeader.join("\n"), /\x1b\[38;2;/);
  assert.doesNotMatch(startupHeader.join("\n"), /PI WORKBENCH|keyboard native/);
  assert.deepEqual(sessionPiHeader(theme, 200, "new"), startupHeader);
  assert.ok(sessionPiHeader(theme, 30, "startup").every((line) =>
    visibleWidth(line) <= 30
  ));
  for (const reason of ["reload", "resume", "fork"]) {
    assert.deepEqual(sessionPiHeader(theme, 200, reason), []);
  }
});

function createPlanModeHarness(sessionEntries = [{
  type: "custom",
  customType: "plan-mode",
  data: {
    enabled: false,
    executing: true,
    todos: [{ step: 1, text: "Finish the tracked change", status: "running" }],
  },
}]) {
  const extensionHandlers = new Map();
  const eventHandlers = new Map();
  const timeline = [];
  let planProgressTool;
  const events = {
    emit(channel, data) {
      for (const handler of eventHandlers.get(channel) ?? []) handler(data);
    },
    on(channel, handler) {
      const handlers = eventHandlers.get(channel) ?? [];
      handlers.push(handler);
      eventHandlers.set(channel, handlers);
      return () => eventHandlers.set(channel, handlers.filter((item) => item !== handler));
    },
  };
  const pi = {
    events,
    registerFlag() {},
    registerEntryRenderer() {},
    registerTool(tool) { planProgressTool = tool; },
    registerCommand() {},
    registerShortcut() {},
    getFlag() { return false; },
    getActiveTools() { return ["read", "bash", "edit", "write"]; },
    setActiveTools() {},
    appendEntry(customType, data) { timeline.push({ type: "entry", customType, data }); },
    sendMessage(message, options) { timeline.push({ type: "message", message, options }); },
    on(event, handler) { extensionHandlers.set(event, handler); },
  };
  planModeExtension(pi);
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      theme: {
        fg: (_role, text) => text,
        strikethrough: (text) => text,
      },
      setStatus: (_key, value) => timeline.push({ type: "status", value }),
      setWidget: (_key, value) => timeline.push({ type: "widget", value }),
      notify() {},
    },
    sessionManager: {
      getEntries: () => sessionEntries,
    },
  };
  return {
    ctx,
    timeline,
    tool: () => planProgressTool,
    handler: (event) => extensionHandlers.get(event),
  };
}

function resetDirectSubagents(overrides = {}) {
  globalThis.__pi_subagents_status_v1 = {
    running: 0,
    total: 0,
    waiting: 0,
    nested: 0,
    updatedAt: 0,
    listeners: new Set(),
    ...overrides,
  };
}

function resetWorkbenchActivityState() {
  resetDirectSubagents();
  clearWorkflowActivity();
  publishMcpStatus([]);
}

function renderSidebar() {
  let renderRequests = 0;
  const sidebar = new WorkbenchSidebar(
    theme,
    () => {},
    () => { renderRequests += 1; },
    () => 48,
    () => 140,
  );
  return {
    sidebar,
    output: () => sidebar.render(80).join("\n"),
    renderRequests: () => renderRequests,
  };
}

function assertWidthSafe(lines, width) {
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(
      visibleWidth(line) <= width,
      `expected line width <= ${width}, received ${visibleWidth(line)}: ${line}`,
    );
  }
}

test("sidebar rendering after reload does not read the stale session context", () => {
  const previousState = { ...workbenchState };
  let stale = false;
  const staleContext = {
    ui: { theme },
    cwd: "C:\\project",
    model: {
      id: "gpt-test",
      provider: "anthropic",
      api: "anthropic-messages",
      contextWindow: 100_000,
    },
    sessionManager: {
      getSessionId() {
        if (stale) throw new Error("stale session context");
        return "reload-regression-session";
      },
      getSessionName() {
        if (stale) throw new Error("stale session context");
        return "Reload regression";
      },
    },
    getContextUsage() {
      if (stale) throw new Error("stale session context");
      return { tokens: 1_000 };
    },
  };

  updateState(staleContext, { getThinkingLevel: () => "off" });
  stale = true;
  const { sidebar, output } = renderSidebar();

  try {
    assert.doesNotThrow(() => output());
    assert.match(output(), /Reload regression/);
    assert.equal(workbenchState.getFastModeActive?.(), false);
  } finally {
    sidebar.dispose();
    for (const key of Object.keys(workbenchState)) delete workbenchState[key];
    Object.assign(workbenchState, previousState);
  }
});

test("session rename events update the live workbench state", async () => {
  const handlers = new Map();
  const eventListeners = new Map();
  const pi = {
    events: {
      emit(channel, data) {
        for (const listener of eventListeners.get(channel) ?? []) listener(data);
      },
      on(channel, listener) {
        const listeners = eventListeners.get(channel) ?? [];
        listeners.push(listener);
        eventListeners.set(channel, listeners);
        return () => eventListeners.set(
          channel,
          listeners.filter((candidate) => candidate !== listener),
        );
      },
    },
    registerCommand() {},
    registerShortcut() {},
    on(event, handler) { handlers.set(event, handler); },
  };
  let renderRequests = 0;
  const editor = { requestRender: () => { renderRequests += 1; } };
  const previousSessionName = workbenchState.sessionName;

  uiExtension(pi);
  editors.add(editor);
  try {
    await handlers.get("session_info_changed")(
      { name: "Renamed during reload" },
      { mode: "tui" },
    );
    assert.equal(workbenchState.sessionName, "Renamed during reload");
    assert.equal(renderRequests, 1);
  } finally {
    editors.delete(editor);
    workbenchState.sessionName = previousSessionName;
  }
});

test("the final plan step enters the transcript before the next assistant response", async () => {
  const harness = createPlanModeHarness();
  await harness.handler("session_start")({ reason: "resume" }, harness.ctx);
  harness.timeline.length = 0;

  await harness.tool().execute(
    "plan-1",
    { step: 1, status: "completed", evidence: "Verified in the focused regression" },
    undefined,
    undefined,
    harness.ctx,
  );

  const clearIndex = harness.timeline.findIndex((event) => event.type === "widget" && event.value === undefined);
  const completionIndex = harness.timeline.findIndex((event) => event.type === "entry" && event.customType === "plan-complete");
  assert.ok(clearIndex >= 0 && clearIndex < completionIndex);
  assert.match(harness.timeline[completionIndex].data.content, /Plan Complete!/);
  assert.equal(harness.timeline.filter((event) => event.type === "entry" && event.customType === "plan-complete").length, 1);

  await harness.handler("agent_end")({ messages: [] }, harness.ctx);
  assert.equal(harness.timeline.filter((event) => event.type === "entry" && event.customType === "plan-complete").length, 1);
});

test("completed plan transcript recovery is idempotent across resume", async () => {
  const completedState = {
    type: "custom",
    customType: "plan-mode",
    data: {
      enabled: false,
      executing: false,
      todos: [{ step: 1, text: "Finish the tracked change", status: "completed", evidence: "Verified" }],
    },
  };
  const missingMessage = createPlanModeHarness([completedState]);
  await missingMessage.handler("session_start")({ reason: "resume" }, missingMessage.ctx);
  assert.equal(missingMessage.timeline.filter((event) => event.type === "entry" && event.customType === "plan-complete").length, 1);

  const renderedMessage = createPlanModeHarness([
    completedState,
    { type: "custom_message", customType: "plan-complete", content: "Plan Complete" },
  ]);
  await renderedMessage.handler("session_start")({ reason: "resume" }, renderedMessage.ctx);
  assert.equal(renderedMessage.timeline.filter((event) => event.type === "entry" && event.customType === "plan-complete").length, 0);
  assert.ok(renderedMessage.timeline.some((event) => event.type === "widget" && event.value === undefined));

  const persistedAnnouncement = createPlanModeHarness([{
    ...completedState,
    data: { ...completedState.data, completionAnnounced: true },
  }]);
  await persistedAnnouncement.handler("session_start")({ reason: "resume" }, persistedAnnouncement.ctx);
  assert.equal(persistedAnnouncement.timeline.filter((event) => event.type === "entry" && event.customType === "plan-complete").length, 0);
});

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

test("sidebar agent counts aggregate direct and workflow delegates", () => {
  resetWorkbenchActivityState();
  resetDirectSubagents({ running: 1, total: 2 });
  beginWorkflowActivity("run-agents", "pipeline");
  setWorkflowActivityPhase("run-agents", "verify");
  projectWorkflowActivityEvent("run-agents", {
    type: "extension_ui_request",
    method: "setStatus",
    statusKey: "subagents",
    statusText: "agents 2/3 running · 1 waiting · 2 nested",
  });

  const snapshot = getSubagentsSnapshot();
  assert.equal(snapshot.running, 3);
  assert.equal(snapshot.total, 5);
  assert.equal(snapshot.waiting, 1);
  assert.equal(snapshot.nested, 2);
  assert.match(subagentsLabel(), /3\/5/);

  const { sidebar, output } = renderSidebar();
  try {
    const text = output();
    assert.match(text, /◉ Agents\s+3\/5 · 1 waiting/);
    assert.match(text, /workflow pipeline\/verify · 2\/3 · 1 waiting · 2 nested/);
  } finally {
    sidebar.dispose();
    resetWorkbenchActivityState();
  }
});

test("sidebar renders workflow MCP activity without replacing server connection state", () => {
  resetWorkbenchActivityState();
  publishMcpStatus([
    { name: "github", state: "connected", transport: "stdio", toolCount: 3 },
  ]);
  beginWorkflowActivity("run-mcp", "pipeline");
  setWorkflowActivityPhase("run-mcp", "plan");
  projectWorkflowActivityEvent("run-mcp", {
    type: "tool_execution_start",
    toolName: "mcp",
    toolCallId: "mcp-1",
    args: {
      action: "call",
      server: "browser\x1b]52;c;YQ==\x07\nserver",
      tool: "snapshot\x1b[31m-danger",
    },
  });

  const { sidebar, output } = renderSidebar();
  try {
    const text = output();
    assert.match(text, /◉ Workflow MCP\s+plan · browser server call\/snapshot-danger · running/);
    assert.match(text, /● github\s+Connected/);
    assert.doesNotMatch(text, /\x1b\[31m|52;c/);

    projectWorkflowActivityEvent("run-mcp", {
      type: "tool_execution_end",
      toolName: "mcp",
      toolCallId: "mcp-1",
      isError: true,
    });
    assert.match(output(), /✕ Workflow MCP\s+plan · browser server call\/snapshot-danger · failed/);
  } finally {
    sidebar.dispose();
    resetWorkbenchActivityState();
  }
});

test("sidebar workflow subscriptions stop invalidating after disposal", () => {
  resetWorkbenchActivityState();
  const { sidebar, renderRequests } = renderSidebar();
  try {
    beginWorkflowActivity("run-subscription", "pipeline");
    assert.equal(renderRequests(), 1);
    sidebar.dispose();
    setWorkflowActivityPhase("run-subscription", "verify");
    assert.equal(renderRequests(), 1);
  } finally {
    sidebar.dispose();
    resetWorkbenchActivityState();
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

function component(lines) {
  return {
    render: () => [...lines],
    invalidate() {},
  };
}

function chatRows(tui) {
  return tui.render(80).slice(0, 4).map((line) => line.trimEnd());
}

function plainChatRows(tui) {
  return chatRows(tui).map((line) =>
    line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  );
}

const copyOptions = {
  onCopyError: (error) => assert.fail(error),
  placeComposerCursor: () => false,
};

function createWorkbenchTui() {
  let listener;
  const writes = [];
  const chatLines = Array.from({ length: 20 }, (_, index) => `chat-${index + 1}`);
  const tui = {
    terminal: {
      columns: 80,
      rows: 8,
      write: (sequence) => writes.push(sequence),
    },
    children: [
      component(chatLines),
      component(["dock-1"]),
      component(["dock-2"]),
      component(["dock-3"]),
      component(["dock-4"]),
    ],
    render: (width) => [`fallback-${width}`],
    start() {},
    stop() {},
    setClearOnShrink: () => {},
    requestRender: () => { tui.renderRequests += 1; },
    addInputListener: (nextListener) => {
      listener = nextListener;
      return () => { listener = undefined; };
    },
    renderRequests: 0,
  };
  return {
    tui,
    writes,
    input: (data) => listener?.(data),
    appendChat: (...lines) => chatLines.push(...lines),
  };
}

test("text selection excludes component and terminal padding", () => {
  const lines = ["alpha          "];
  const focus = clampSelectionPoint(lines, 0, 79);
  const range = { anchor: { row: 0, column: 0, endColumn: 1 }, focus };

  assert.deepEqual(focus, { row: 0, column: 4, endColumn: 5 });
  assert.equal(selectedTerminalText(lines, range), "alpha");
  assert.match(highlightTerminalSelection(lines, range)[0], /^\x1b\[7malpha\x1b\[27m {10}$/);
});

test("text selection snaps both cells of a wide glyph to one grapheme", () => {
  const lines = ["A界B"];
  const firstCell = clampSelectionPoint(lines, 0, 1);
  const secondCell = clampSelectionPoint(lines, 0, 2);

  assert.deepEqual(firstCell, { row: 0, column: 1, endColumn: 3 });
  assert.deepEqual(secondCell, firstCell);
  assert.equal(selectedTerminalText(lines, { anchor: firstCell, focus: secondCell }), "界");
  assert.equal(highlightTerminalSelection(lines, { anchor: firstCell, focus: secondCell })[0], "A\x1b[7m界\x1b[27mB");
});

test("docked sidebar survives a transient narrow width while a session resumes", () => {
  const { tui } = createWorkbenchTui();
  const controller = new WorkbenchSidebarController();
  controller.attachDocked(
    tui,
    theme,
    copyOptions.placeComposerCursor,
    copyOptions.onCopyError,
  );

  try {
    assert.doesNotMatch(tui.render(80).join("\n"), /Pi workspace/);
    tui.terminal.columns = 160;
    assert.match(tui.render(160).join("\n"), /Pi workspace/);
  } finally {
    controller.dispose();
  }
});

test("workbench shell routes mouse wheel to chat and preserves position while streaming", () => {
  const { tui, writes, input, appendChat } = createWorkbenchTui();
  const handle = installWorkbenchShell(tui, component([]), copyOptions);

  try {
    assert.match(writes.join(""), /\x1b\[\?1006h/);
    assert.match(writes.join(""), /\x1b\[\?1002h/);
    assert.deepEqual(chatRows(tui), ["chat-17", "chat-18", "chat-19", "chat-20"]);

    assert.deepEqual(input("\x1b[<64;10;4M"), { consume: true });
    assert.deepEqual(chatRows(tui), ["chat-14", "chat-15", "chat-16", "chat-17"]);

    appendChat("chat-21", "chat-22");
    assert.deepEqual(chatRows(tui), ["chat-14", "chat-15", "chat-16", "chat-17"]);

    assert.deepEqual(input("\x1b[<65;10;4M\x1b[<65;10;4M"), { consume: true });
    assert.deepEqual(chatRows(tui), ["chat-19", "chat-20", "chat-21", "chat-22"]);
  } finally {
    handle.dispose();
  }
  assert.match(writes.join(""), /\x1b\[\?1002l/);
  assert.match(writes.join(""), /\x1b\[\?1049l/);
  assert.equal(input("\x1b[<64;10;4M"), undefined);
});

test("mouse wheel cancels an active drag selection before scrolling chat", () => {
  const { tui, input } = createWorkbenchTui();
  const copied = [];
  const handle = installWorkbenchShell(tui, component([]), {
    ...copyOptions,
    copyText: async (text) => { copied.push(text); },
  });

  try {
    tui.render(80);
    input("\x1b[<0;1;1M");
    input("\x1b[<32;4;2M");
    assert.match(tui.render(80).join("\n"), /\x1b\[7m/);

    assert.deepEqual(input("\x1b[<64;10;4M"), { consume: true });
    assert.deepEqual(chatRows(tui), ["chat-14", "chat-15", "chat-16", "chat-17"]);
    assert.doesNotMatch(tui.render(80).join("\n"), /\x1b\[7m/);

    input("\x1b[<32;8;3M");
    input("\x1b[<0;8;3m");
    assert.deepEqual(copied, []);
  } finally {
    handle.dispose();
  }
});

test("session rebind restores application mouse tracking without clearing chat", () => {
  const { tui, writes } = createWorkbenchTui();
  const handle = installWorkbenchShell(tui, component([]), copyOptions);

  try {
    tui.render(80);
    const writeCount = writes.length;
    assert.equal(installWorkbenchShell(tui, component([]), copyOptions), handle);
    assert.equal(writes.length, writeCount + 1);
    assert.match(writes.at(-1), /\x1b\[\?1007l\x1b\[\?1006h\x1b\[\?1002h/);
    assert.deepEqual(chatRows(tui), ["chat-17", "chat-18", "chat-19", "chat-20"]);
  } finally {
    handle.dispose();
  }
});

test("workbench shell routes composer clicks and preserves drag selection", () => {
  const { tui, input } = createWorkbenchTui();
  const cursorRequests = [];
  const copied = [];
  const handle = installWorkbenchShell(tui, component([]), {
    ...copyOptions,
    copyText: async (text) => { copied.push(text); },
    placeComposerCursor: (request) => {
      cursorRequests.push(request);
      return true;
    },
  });

  try {
    tui.render(80);
    assert.deepEqual(input("\x1b[<0;7;6M"), { consume: true });
    assert.deepEqual(input("\x1b[<0;7;6m"), { consume: true });
    assert.deepEqual(cursorRequests, [{ renderRow: 0, screenColumn: 6, width: 80 }]);
    assert.doesNotMatch(tui.render(80).join("\n"), /\x1b\[7m/);

    input("\x1b[<0;1;6M");
    input("\x1b[<32;4;6M");
    input("\x1b[<0;4;6m");
    assert.deepEqual(cursorRequests.length, 1);
    assert.deepEqual(copied, ["dock"]);
  } finally {
    handle.dispose();
  }
});

test("workbench shell drag-selects only text cells and copies the exact range", () => {
  const { tui, input } = createWorkbenchTui();
  const copied = [];
  const handle = installWorkbenchShell(tui, component([]), {
    copyText: async (text) => { copied.push(text); },
    onCopyError: copyOptions.onCopyError,
    placeComposerCursor: copyOptions.placeComposerCursor,
  });

  try {
    tui.render(80);
    input("\x1b[<0;1;1M");
    input("\x1b[<0;1;1m");
    assert.deepEqual(copied, []);

    assert.deepEqual(input("\x1b[<0;6;1M"), { consume: true });
    assert.deepEqual(input("\x1b[<32;3;2M"), { consume: true });
    assert.deepEqual(input("\x1b[<0;3;2m"), { consume: true });

    assert.deepEqual(copied, ["17\ncha"]);
    const selectedRows = tui.render(80).slice(0, 2);
    assert.match(selectedRows[0], /chat-\x1b\[7m17\x1b\[27m/);
    assert.match(selectedRows[1], /\x1b\[7mcha\x1b\[27m/);
    assert.ok(selectedRows.every((line) => visibleWidth(line) < 80));

    assert.deepEqual(input("ctrl+c"), { consume: true });
    assert.deepEqual(copied, ["17\ncha", "17\ncha"]);
    assert.doesNotMatch(tui.render(80).join("\n"), /\x1b\[7m/);
  } finally {
    handle.dispose();
  }
});

test("dragging at either transcript edge auto-scrolls into off-screen rows", async () => {
  const scenarios = [
    {
      name: "top edge",
      prepare: () => {},
      initialFirstRow: "chat-17",
      press: "\x1b[<0;6;3M",
      drag: "\x1b[<32;1;1M",
      release: "\x1b[<0;1;1m",
      moved: (rowNumber) => rowNumber < 17,
    },
    {
      name: "bottom edge",
      prepare: (input) => input("\x1b[<64;10;4M"),
      initialFirstRow: "chat-14",
      press: "\x1b[<0;1;2M",
      drag: "\x1b[<32;7;4M",
      release: "\x1b[<0;7;4m",
      moved: (rowNumber) => rowNumber > 14,
    },
  ];

  for (const scenario of scenarios) {
    const { tui, input } = createWorkbenchTui();
    const copied = [];
    const handle = installWorkbenchShell(tui, component([]), {
      ...copyOptions,
      copyText: async (text) => { copied.push(text); },
    });

    try {
      tui.render(80);
      scenario.prepare(input);
      assert.equal(plainChatRows(tui)[0], scenario.initialFirstRow, scenario.name);
      input(scenario.press);
      input(scenario.drag);

      let visibleRows = plainChatRows(tui);
      for (
        let attempt = 0;
        attempt < 10 && visibleRows[0] === scenario.initialFirstRow;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        visibleRows = plainChatRows(tui);
      }

      const firstRowNumber = Number(visibleRows[0].slice("chat-".length));
      assert.ok(scenario.moved(firstRowNumber), scenario.name);
      assert.match(tui.render(80).join("\n"), /\x1b\[7m/);
      input(scenario.release);
      assert.equal(copied.length, 1, scenario.name);
      assert.ok(copied[0].split("\n").length >= 4, scenario.name);

      const rowsAfterRelease = plainChatRows(tui);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(plainChatRows(tui), rowsAfterRelease, scenario.name);
    } finally {
      handle.dispose();
    }
  }
});

test("stopping the TUI cancels an active edge-scroll timer", async () => {
  const { tui, input } = createWorkbenchTui();
  const handle = installWorkbenchShell(tui, component([]), copyOptions);

  try {
    tui.render(80);
    input("\x1b[<0;6;3M");
    input("\x1b[<32;1;1M");
    const rowsBeforeStop = plainChatRows(tui);
    tui.stop();

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(plainChatRows(tui), rowsBeforeStop);
    assert.doesNotMatch(tui.render(80).join("\n"), /\x1b\[7m/);
  } finally {
    handle.dispose();
  }
});

test("changing the main viewport width clears its logical selection snapshot", () => {
  const { tui, input } = createWorkbenchTui();
  const handle = installWorkbenchShell(tui, component([]), copyOptions);

  try {
    tui.render(80);
    input("\x1b[<0;1;1M");
    input("\x1b[<32;4;2M");
    assert.match(tui.render(80).join("\n"), /\x1b\[7m/);
    assert.doesNotMatch(tui.render(60).join("\n"), /\x1b\[7m/);
  } finally {
    handle.dispose();
  }
});

test("workbench shell reports clipboard failures", async () => {
  const { tui, input } = createWorkbenchTui();
  const copyErrors = [];
  const handle = installWorkbenchShell(tui, component([]), {
    copyText: async () => { throw new Error("clipboard unavailable"); },
    onCopyError: (error) => copyErrors.push(error.message),
    placeComposerCursor: copyOptions.placeComposerCursor,
  });

  try {
    tui.render(80);
    input("\x1b[<0;1;1M");
    input("\x1b[<32;2;1M");
    input("\x1b[<0;2;1m");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(copyErrors, ["clipboard unavailable"]);
  } finally {
    handle.dispose();
  }
});

test("workbench shell preserves a selection while streaming and releases it on fresh output", () => {
  const { tui, input, appendChat } = createWorkbenchTui();
  const copied = [];
  const handle = installWorkbenchShell(tui, component([]), {
    copyText: async (text) => { copied.push(text); },
    onCopyError: copyOptions.onCopyError,
    placeComposerCursor: copyOptions.placeComposerCursor,
  });

  try {
    tui.render(80);
    input("\x1b[<0;1;1M");
    appendChat("chat-21", "chat-22");
    assert.match(tui.render(80)[0], /\x1b\[7mc\x1b\[27mhat-17/);

    input("\x1b[<32;2;1M");
    input("\x1b[<0;2;1m");
    assert.deepEqual(copied, ["ch"]);
    assert.match(tui.render(80)[0], /\x1b\[7mch\x1b\[27mat-17/);

    appendChat("chat-23");
    const fresh = tui.render(80).slice(0, 4).map((line) => line.trimEnd());
    assert.deepEqual(fresh, ["chat-20", "chat-21", "chat-22", "chat-23"]);
    assert.doesNotMatch(fresh.join("\n"), /\x1b\[7m/);
  } finally {
    handle.dispose();
  }
});

test("workbench shell keeps PageUp and PageDown chat scrolling", () => {
  const { tui, input } = createWorkbenchTui();
  const handle = installWorkbenchShell(tui, component([]), copyOptions);

  try {
    assert.deepEqual(input("pageup"), { consume: true });
    assert.deepEqual(chatRows(tui), ["chat-12", "chat-13", "chat-14", "chat-15"]);
    assert.deepEqual(input("pagedown"), { consume: true });
    assert.deepEqual(chatRows(tui), ["chat-17", "chat-18", "chat-19", "chat-20"]);
  } finally {
    handle.dispose();
  }
});

function createTerminalEditor() {
  let modeToggles = 0;
  const editor = new TerminalEditor(
    { requestRender() {} },
    {},
    {},
    () => { modeToggles += 1; },
  );
  return { editor, modeToggles: () => modeToggles };
}

test("terminal editor places the cursor from LTR, wrapped, and RTL mouse cells", () => {
  const { editor } = createTerminalEditor();

  editor.setText("hello world");
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(4, 11, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 6 });

  editor.setText("x".repeat(80));
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(5, 8, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 74 });

  editor.setText("مرحبا");
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(4, 70, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 4 });
  assert.equal(editor.placeCursorFromRenderedCell(4, 10, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 5 });
  assert.equal(editor.placeCursorFromRenderedCell(4, 75, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

  editor.setText("אבג");
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(4, 72, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  assert.equal(editor.placeCursorFromRenderedCell(4, 73, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
  assert.equal(editor.placeCursorFromRenderedCell(4, 75, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 3 });

  editor.setText("لاب");
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(4, 73, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  assert.equal(editor.placeCursorFromRenderedCell(4, 74, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

  editor.setText("م".repeat(80));
  editor.render(80);
  assert.equal(editor.placeCursorFromRenderedCell(5, 68, 80), true);
  assert.deepEqual(editor.getCursor(), { line: 0, col: 79 });
});

test("terminal editor delegates slash and visible autocomplete Tab input", () => {
  const { editor, modeToggles } = createTerminalEditor();

  editor.setText("/workflow");
  editor.handleInput("tab");
  editor.setText("@README");
  editor.setAutocompleteVisible(true);
  editor.handleInput("tab");

  assert.deepEqual(editor.handledInputs, ["tab", "tab"]);
  assert.equal(modeToggles(), 0);
});

test("terminal editor keeps PLAN/BUILD Tab toggling for ordinary and empty prompts", () => {
  const { editor, modeToggles } = createTerminalEditor();

  editor.setText("ordinary prompt");
  editor.handleInput("tab");
  editor.setText("");
  editor.handleInput("tab");

  assert.deepEqual(editor.handledInputs, []);
  assert.equal(modeToggles(), 2);
});

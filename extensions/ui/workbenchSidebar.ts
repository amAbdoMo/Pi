import type {
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";

import { getMcpStatus, subscribeMcpStatus } from "../mcp/status.ts";
import type { McpServerState } from "../mcp/types.ts";
import {
  getWorkflowActivitySnapshot,
  type WorkflowActivitySnapshot,
  type WorkflowMcpActivity,
} from "../workflow/activity.ts";
import {
  getPlanProgress,
  subscribePlanProgress,
} from "../plan-mode/progressState.ts";
import {
  getTodoCounts,
  todoStatusSymbol,
  type TodoItem,
  type TodoStatus,
} from "../plan-mode/utils.ts";
import {
  isWorkbenchModalActive,
  subscribeWorkbenchModals,
} from "./modalState.ts";
import { state } from "./state.ts";
import {
  installWorkbenchShell,
  type WorkbenchShellHandle,
} from "./workbenchShell.ts";
import {
  getSubagentsSnapshot,
  subscribeSubagents,
  type SubagentsSnapshot,
} from "./subagents.ts";
import {
  compactTokenCount,
  sidebarGutterWidth,
  sidebarMcpStateLabel,
  sidebarMcpStatusSymbol,
  sidebarMcpStatusTone,
  sidebarOverlayOptions,
  sidebarPanelContentWidth,
  sidebarPresentation,
  sidebarSectionContentWidth,
  sidebarTitleRule,
} from "./workbenchSidebarLayout.ts";

const RAIL_MIN_COLUMNS = 118;
const MAX_VISIBLE_TASKS = 4;
const MAX_VISIBLE_SERVERS = 8;

export class WorkbenchSidebarController {
  private handle?: OverlayHandle;
  private component?: WorkbenchSidebar;
  private tui?: TUI;
  private shell?: WorkbenchShellHandle;
  private desiredVisible = false;
  private unsubscribeModals?: () => void;

  attachDocked(tui: TUI, theme: Theme): void {
    this.handle?.hide();
    this.handle = undefined;
    this.component?.dispose();
    this.tui = tui;
    this.desiredVisible = sidebarPresentation(tui.terminal.columns) === "rail";
    this.component = new WorkbenchSidebar(
      theme,
      () => this.hide(),
      () => tui.requestRender(),
      () => tui.terminal.rows,
      () => tui.terminal.columns,
    );
    this.shell = installWorkbenchShell(tui, this.component);
    this.syncVisibility();
  }

  mount(ctx: ExtensionContext, forceVisible = false): void {
    if (ctx.mode !== "tui" || this.shell) return;
    if (this.handle) {
      if (forceVisible) this.desiredVisible = true;
      this.syncVisibility();
      return;
    }

    this.desiredVisible = forceVisible ||
      sidebarPresentation(this.tui?.terminal.columns ?? RAIL_MIN_COLUMNS) === "rail";
    this.unsubscribeModals ??= subscribeWorkbenchModals(() => this.syncVisibility());

    void ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        this.tui = tui;
        this.desiredVisible = forceVisible ||
          sidebarPresentation(tui.terminal.columns) === "rail";
        this.component = new WorkbenchSidebar(
          theme,
          () => this.hide(),
          () => tui.requestRender(),
          () => Math.max(12, tui.terminal.rows - 2),
          () => tui.terminal.columns,
        );
        return this.component;
      },
      {
        overlay: true,
        overlayOptions: () =>
          sidebarOverlayOptions(this.tui?.terminal.columns ?? RAIL_MIN_COLUMNS),
        onHandle: (handle) => {
          this.handle = handle;
          this.syncVisibility();
        },
      },
    ).catch((error) => {
      this.unsubscribeModals?.();
      this.unsubscribeModals = undefined;
      this.handle = undefined;
      this.component = undefined;
      ctx.ui.notify(
        `Workspace sidebar failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    });
  }

  toggle(ctx: ExtensionContext): void {
    if (!this.handle && !this.shell) {
      this.mount(ctx, true);
      return;
    }
    this.desiredVisible = !this.desiredVisible;
    this.syncVisibility();
  }

  invalidate(): void {
    this.component?.invalidate();
  }

  dispose(): void {
    this.unsubscribeModals?.();
    this.unsubscribeModals = undefined;
    this.handle?.hide();
    this.handle = undefined;
    this.shell?.dispose();
    this.shell = undefined;
    this.component?.dispose();
    this.component = undefined;
    this.tui = undefined;
    this.desiredVisible = false;
  }

  private hide(): void {
    this.desiredVisible = false;
    this.syncVisibility();
  }

  private syncVisibility(): void {
    if (this.shell) {
      const visible = this.desiredVisible &&
        sidebarPresentation(this.tui?.terminal.columns ?? 0) === "rail";
      this.shell.setSidebarVisible(visible);
      this.component?.invalidate();
      return;
    }
    if (!this.handle) return;
    const visible = this.desiredVisible && !isWorkbenchModalActive();
    this.handle.setHidden(!visible);
    if (!visible) {
      this.handle.unfocus();
      return;
    }
    if (sidebarPresentation(this.tui?.terminal.columns ?? 0) === "overlay") {
      this.handle.focus();
    } else {
      this.handle.unfocus();
    }
    this.component?.invalidate();
  }
}

export class WorkbenchSidebar implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];
  private readonly subscriptions: Array<() => void>;
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private readonly theme: Theme;
  private readonly dismiss: () => void;
  private readonly requestRender: () => void;
  private readonly availableRows: () => number;
  private readonly terminalColumns: () => number;

  constructor(
    theme: Theme,
    dismiss: () => void,
    requestRender: () => void,
    availableRows: () => number,
    terminalColumns: () => number,
  ) {
    this.theme = theme;
    this.dismiss = dismiss;
    this.requestRender = requestRender;
    this.availableRows = availableRows;
    this.terminalColumns = terminalColumns;
    const refresh = () => this.invalidate();
    this.subscriptions = [
      subscribePlanProgress(refresh),
      subscribeMcpStatus(refresh),
      subscribeSubagents(refresh),
    ];
    this.refreshTimer = setInterval(refresh, 1_000);
    this.refreshTimer.unref?.();
  }

  handleInput(input: string): void {
    if (
      matchesKey(input, Key.escape) ||
      matchesKey(input, Key.ctrl("c")) ||
      input.toLowerCase() === "q"
    ) {
      this.dismiss();
    }
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
    const totalWidth = Math.max(4, width);
    const gutterWidth = sidebarGutterWidth(this.terminalColumns());
    const panelWidth = Math.max(4, totalWidth - gutterWidth);
    const bodyWidth = sidebarPanelContentWidth(panelWidth);
    const bodyRows = Math.max(10, this.availableRows() - 2);
    const body = this.bodyLines(bodyWidth, bodyRows);
    const panel = framedPanel(this.theme, "Pi workspace", body, panelWidth);
    this.cachedLines = panel.map((line) => `${" ".repeat(gutterWidth)}${line}`);
    this.cachedWidth = width;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.requestRender();
  }

  dispose(): void {
    clearInterval(this.refreshTimer);
    for (const unsubscribe of this.subscriptions) unsubscribe();
  }

  private bodyLines(width: number, rows: number): string[] {
    const divider = this.theme.fg("borderMuted", "─".repeat(width));
    const sectionContentWidth = sidebarSectionContentWidth(width);
    const lines = [
      "",
      ...framedSection(this.theme, "Session", this.sessionLines(sectionContentWidth), width),
      "",
      ...framedSection(this.theme, "Context", this.contextLines(sectionContentWidth), width),
      "",
      ...framedSection(this.theme, "Activity", this.activityLines(sectionContentWidth), width),
      "",
      ...framedSection(this.theme, "MCP", this.mcpLines(sectionContentWidth), width),
    ];
    const contentRows = lines.slice(0, Math.max(0, rows - 2));
    while (contentRows.length < rows - 2) contentRows.push("");
    return [
      ...contentRows,
      divider,
      this.theme.fg("dim", "Tab mode · RTL auto · /mcp"),
    ];
  }

  private sessionLines(width: number): string[] {
    const sessionName = state.getSessionName?.() || "Current session";
    const location = `󰉋 ${state.folder || "~"}   ${state.branch || "—"}`;
    return [
      ...wrapSidebarText(this.theme.fg("accent", ` ${sessionName}`), width),
      ...wrapSidebarText(this.theme.fg("muted", location), width),
    ];
  }

  private contextLines(width: number): string[] {
    const contextWindow = state.contextWindow ?? 0;
    const contextUsed = state.contextTokens ?? 0;
    const contextPercent = contextWindow > 0
      ? Math.round((contextUsed / contextWindow) * 100)
      : undefined;
    const contextSize = contextWindow > 0
      ? `${compactTokenCount(contextUsed)} / ${compactTokenCount(contextWindow)}`
      : "—";
    return [
      alignedStatusLine(
        this.theme,
        this.theme.fg("muted", "󰍛 Window"),
        contextSize,
        width,
      ),
      progressLine(this.theme, "Used", contextPercent, width),
    ];
  }

  private activityLines(width: number): string[] {
    return [
      ...this.taskActivityLines(width),
      ...this.agentActivityLines(width),
    ];
  }

  private taskActivityLines(width: number): string[] {
    const progress = getPlanProgress();
    const counts = getTodoCounts(progress.items);
    if (counts.total === 0) {
      return [alignedStatusLine(this.theme, this.theme.fg("dim", "○ Tasks"), "none", width)];
    }
    const summary = counts.running > 0
      ? `${counts.running} running`
      : `${counts.completed}/${counts.total}`;
    const visibleItems = progress.items.slice(0, MAX_VISIBLE_TASKS);
    const lines = [
      alignedStatusLine(
        this.theme,
        this.theme.fg(progress.executing ? "accent" : "muted", "◉ Tasks"),
        summary,
        width,
      ),
      ...visibleItems.flatMap((item) =>
        sidebarTaskLines(this.theme, item, width)
      ),
    ];
    if (progress.items.length > visibleItems.length) {
      lines.push(this.theme.fg(
        "dim",
        `  +${progress.items.length - visibleItems.length} more · /todos`,
      ));
    }
    return lines;
  }

  private agentActivityLines(width: number): string[] {
    const agents = getSubagentsSnapshot();
    if (agents.total === 0 && !agents.inside) {
      return [alignedStatusLine(this.theme, this.theme.fg("dim", "○ Agents"), "none", width)];
    }
    const summary = `${agents.running}/${agents.total}${agents.waiting ? ` · ${agents.waiting} waiting` : ""}`;
    const lines = [
      alignedStatusLine(
        this.theme,
        this.theme.fg(agents.running ? "accent" : "muted", "◉ Agents"),
        summary,
        width,
      ),
    ];
    const workflowLine = workflowDelegateLine(this.theme, agents.workflow, width);
    if (workflowLine) lines.push(workflowLine);
    return lines;
  }

  private mcpLines(width: number): string[] {
    const servers = getMcpStatus();
    const workflowLines = workflowMcpLines(this.theme, getWorkflowActivitySnapshot(), width);
    const lines: string[] = [...workflowLines];
    if (servers.length === 0) {
      if (lines.length === 0) lines.push(this.theme.fg("dim", "No servers configured · /mcp"));
      return lines;
    }
    for (const server of servers.slice(0, MAX_VISIBLE_SERVERS)) {
      lines.push(alignedStatusLine(
        this.theme,
        `${mcpStatusGlyph(this.theme, server.state)} ${server.name}`,
        sidebarMcpStateLabel(server.state),
        width,
      ));
    }
    if (servers.length > MAX_VISIBLE_SERVERS) {
      lines.push(this.theme.fg("dim", `+${servers.length - MAX_VISIBLE_SERVERS} more · /mcp`));
    }
    return lines;
  }
}

function wrapSidebarText(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, width));
}

function sectionTitle(theme: Theme, text: string): string {
  return theme.fg("toolTitle", theme.bold(text.toUpperCase()));
}

function sidebarTaskLines(
  theme: Theme,
  item: TodoItem,
  width: number,
): string[] {
  const prefix = `${theme.fg(
    todoStatusRole(item.status),
    todoStatusSymbol(item.status),
  )} `;
  const continuation = "  ";
  return wrapSidebarText(item.text, Math.max(1, width - continuation.length))
    .map((line, index) => `${index === 0 ? prefix : continuation}${line}`);
}

function workflowDelegateLine(
  theme: Theme,
  workflow: SubagentsSnapshot["workflow"],
  width: number,
): string | undefined {
  if (!workflow || workflow.total === 0 && workflow.nested === 0) return undefined;
  const location = workflowLocationLabel(workflow.workflowId, workflow.phaseId);
  const bits = [`${workflow.running}/${workflow.total}`];
  if (workflow.waiting) bits.push(`${workflow.waiting} waiting`);
  if (workflow.nested) bits.push(`${workflow.nested} nested`);
  return truncateToWidth(
    theme.fg("dim", `  workflow ${location} · ${bits.join(" · ")}`),
    width,
    "…",
    true,
  );
}

function workflowMcpLines(
  theme: Theme,
  workflow: WorkflowActivitySnapshot | undefined,
  width: number,
): string[] {
  if (!workflow?.mcpCalls.length) return [];
  const visibleCalls = workflow.mcpCalls.slice(0, 2);
  const lines = visibleCalls.map((call) =>
    alignedStatusLine(
      theme,
      theme.fg(workflowMcpTone(call.status), `${workflowMcpSymbol(call.status)} Workflow MCP`),
      workflowMcpValue(workflow, call),
      width,
    )
  );
  if (workflow.mcpCalls.length > visibleCalls.length) {
    lines.push(theme.fg("dim", `+${workflow.mcpCalls.length - visibleCalls.length} workflow MCP more`));
  }
  return lines;
}

function workflowMcpValue(
  workflow: WorkflowActivitySnapshot,
  call: WorkflowMcpActivity,
): string {
  const phase = workflow.phaseId ? sanitizeSidebarText(workflow.phaseId) : sanitizeSidebarText(workflow.workflowId);
  const server = sanitizeSidebarText(call.server ?? "server");
  const action = sanitizeSidebarText(call.action ?? "action");
  const tool = sanitizeSidebarText(call.tool ?? "tool");
  return `${phase} · ${server} ${action}/${tool} · ${call.status}`;
}

function workflowMcpSymbol(status: WorkflowMcpActivity["status"]): string {
  if (status === "succeeded") return "✓";
  if (status === "failed") return "✕";
  return "◉";
}

function workflowMcpTone(status: WorkflowMcpActivity["status"]): "accent" | "success" | "error" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "error";
  return "accent";
}

function workflowLocationLabel(workflowId: string, phaseId: string | undefined): string {
  const workflow = sanitizeSidebarText(workflowId);
  const phase = phaseId ? sanitizeSidebarText(phaseId) : undefined;
  return phase ? `${workflow}/${phase}` : workflow;
}

function sanitizeSidebarText(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function todoStatusRole(status: TodoStatus): string {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "running":
      return "accent";
    case "pending":
      return "muted";
  }
}

function alignedStatusLine(
  theme: Theme,
  styledLabel: string,
  value: string,
  width: number,
): string {
  const styledValue = theme.fg("dim", value);
  const gap = width - visibleWidth(styledLabel) - visibleWidth(value);
  if (gap < 1) {
    return truncateToWidth(`${styledLabel} ${styledValue}`, width, "…", true);
  }
  return `${styledLabel}${" ".repeat(gap)}${styledValue}`;
}

function progressLine(
  theme: Theme,
  label: string,
  percent: number | undefined,
  width: number,
): string {
  const value = typeof percent === "number" && Number.isFinite(percent)
    ? `${Math.max(0, Math.min(100, Math.round(percent)))}% ${progressBar(theme, percent)}`
    : "—";
  return alignedStatusLine(theme, theme.fg("muted", label), value, width);
}

function progressBar(theme: Theme, percent: number, width = 5): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return theme.fg("accent", "━".repeat(filled)) +
    theme.fg("borderMuted", "─".repeat(width - filled));
}

function mcpStatusGlyph(theme: Theme, status: McpServerState): string {
  return theme.fg(sidebarMcpStatusTone(status), sidebarMcpStatusSymbol(status));
}

function framedSection(theme: Theme, title: string, body: string[], width: number): string[] {
  const titleRule = sidebarTitleRule(width, title.toUpperCase());
  if (!titleRule.left) {
    return [
      sectionTitle(theme, titleRule.title),
      ...body.map((line) => truncateToWidth(line, width, "", false)),
    ];
  }

  const contentWidth = sidebarSectionContentWidth(width);
  const border = (text: string) => theme.fg("borderMuted", text);
  const lines = [
    border(titleRule.left) + sectionTitle(theme, titleRule.title) + border(titleRule.right),
  ];
  for (const line of ["", ...body]) {
    const content = truncateToWidth(line, contentWidth, "…", false);
    const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
    lines.push(`${border("│ ")}${content}${fill}${border(" │")}`);
  }
  lines.push(border(`└${"─".repeat(width - 2)}┘`));
  return lines;
}

function framedPanel(theme: Theme, title: string, body: string[], width: number): string[] {
  const innerWidth = Math.max(2, width - 2);
  const horizontalPadding = innerWidth >= 4 ? 2 : 0;
  const contentWidth = sidebarPanelContentWidth(width);
  const titleRule = sidebarTitleRule(width, title);
  const border = (text: string) => theme.fg("border", text);
  const lines = [
    border(titleRule.left) + theme.fg("accent", theme.bold(titleRule.title)) + border(titleRule.right),
  ];
  const padding = " ".repeat(horizontalPadding);
  for (const line of body) {
    const content = truncateToWidth(line, contentWidth, "…", true);
    const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
    lines.push(`${border("│")}${padding}${content}${fill}${padding}${border("│")}`);
  }
  lines.push(border(`└${"─".repeat(innerWidth)}┘`));
  return lines.map((line) =>
    paintPanelBackground(
      theme,
      truncateToWidth(line, width, "", true),
    ),
  );
}

function paintPanelBackground(theme: Theme, line: string): string {
  const backgroundAnsi = theme.getBgAnsi?.("customMessageBg");
  if (backgroundAnsi) {
    const painted = line.replace(
      /\x1b\[(?:0|49)m/g,
      (reset) => `${reset}${backgroundAnsi}`,
    );
    return `${backgroundAnsi}${painted}\x1b[49m`;
  }
  return theme.bg("customMessageBg", line);
}

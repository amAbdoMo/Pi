import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { SubagentRecord } from "../types.ts";
import { formatDuration, now } from "../utils.ts";
import {
  framedPanel,
  renderToolTree,
  statusRank,
  statusText,
} from "../render-utils.ts";

export class AgentsOverlay implements Component {
  private selected = 0;
  private mode: "list" | "detail" = "list";
  private scroll = 0;
  private listScroll = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly theme: Theme,
    private readonly getRecords: () => SubagentRecord[],
    private readonly done: (
      value: { action: "steer" | "abort" | "enter"; id: string } | undefined,
    ) => void,
    private readonly requestRender: () => void,
    private readonly getBodyRows: () => number = () => 22,
  ) {
    this.refreshTimer = setInterval(() => this.invalidate(), 1_000);
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
    const records = this.sortedRecords();
    if (this.selected >= records.length)
      this.selected = Math.max(0, records.length - 1);
    const contentWidth = Math.max(1, width - 4);
    const bodyRows = this.getBodyRows();
    const body =
      this.mode === "detail" && records[this.selected]
        ? this.renderDetail(contentWidth, records[this.selected], bodyRows)
        : this.renderList(contentWidth, records, bodyRows);
    const title =
      this.mode === "detail" && records[this.selected]
        ? `Sub-agent / ${this.label(records[this.selected])}`
        : "Sub-agents";
    const lines = framedPanel(
      this.theme,
      title,
      body,
      width,
      Math.min(bodyRows + 2, this.mode === "detail" ? 24 : 20),
    );
    this.cachedWidth = width;
    this.cachedLines = lines.map((line) => truncateToWidth(line, width, "…", true));
    return this.cachedLines;
  }

  handleInput(data: string): void {
    const records = this.sortedRecords();
    if (matchesKey(data, Key.escape)) {
      if (this.mode === "detail") {
        this.mode = "list";
        this.invalidate();
        return;
      }
      this.done(undefined);
      return;
    }
    if (matchesKey(data, Key.up)) {
      if (this.mode === "detail") this.scroll = Math.max(0, this.scroll - 1);
      else this.selected = Math.max(0, this.selected - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.mode === "detail") this.scroll += 1;
      else this.selected = Math.min(Math.max(0, records.length - 1), this.selected + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter) && records[this.selected]) {
      this.mode = "detail";
      this.scroll = 0;
      this.invalidate();
      return;
    }
    if (data === "r") {
      this.invalidate();
      return;
    }
    if ((data === "s" || data === "a" || data === "e") && records[this.selected]) {
      const action = data === "s" ? "steer" : data === "a" ? "abort" : "enter";
      this.done({ action, id: records[this.selected].id });
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.requestRender();
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private sortedRecords(): SubagentRecord[] {
    return this.getRecords().sort(
      (a, b) => statusRank(a.status) - statusRank(b.status) || a.createdAt - b.createdAt,
    );
  }

  private label(record: SubagentRecord): string {
    return record.generatedLabel || record.id;
  }

  private visibleRecordCount(maxRows: number): number {
    return Math.max(1, Math.floor(Math.max(5, maxRows - 4) / 5));
  }

  private clampListScroll(records: SubagentRecord[], maxRows: number): void {
    const count = this.visibleRecordCount(maxRows);
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    if (this.selected >= this.listScroll + count)
      this.listScroll = this.selected - count + 1;
    this.listScroll = Math.max(
      0,
      Math.min(this.listScroll, Math.max(0, records.length - count)),
    );
  }

  private renderList(width: number, records: SubagentRecord[], maxRows: number): string[] {
    const t = this.theme;
    const hint = t.fg("dim", "↑↓ select · Enter details · s steer · a abort · e enter · r refresh · Esc close");
    this.clampListScroll(records, maxRows);
    const visibleCount = this.visibleRecordCount(maxRows);
    const end = Math.min(records.length, this.listScroll + visibleCount);
    const lines = [
      t.fg(
        "dim",
        `${records.length} active direct child${records.length === 1 ? "" : "ren"}${records.length > visibleCount ? ` · showing ${this.listScroll + 1}-${end}` : ""}`,
      ),
      "",
    ];
    if (records.length === 0) {
      lines.push(
        t.fg("muted", "No active sub-agents."),
        t.fg("dim", "Start one with the delegate tool, then reopen /agents."),
      );
      return this.withHint(lines, hint, maxRows);
    }
    if (this.listScroll > 0) lines.push(t.fg("dim", "↑ more"));
    for (let i = this.listScroll; i < end; i++)
      lines.push(...this.renderRecord(records[i], i === this.selected, width));
    if (end < records.length) lines.push(t.fg("dim", "↓ more"));
    return this.withHint(lines, hint, maxRows);
  }

  private renderRecord(record: SubagentRecord, selected: boolean, bodyWidth: number): string[] {
    const t = this.theme;
    const prefix = selected ? t.fg("accent", "› ") : t.fg("dim", "  ");
    const elapsed = formatDuration((record.endedAt ?? now()) - record.createdAt);
    const label = t.fg(selected ? "accent" : "toolTitle", this.label(record));
    const title = `${prefix}${t.fg("toolTitle", t.bold("Sub-agent"))} ${label}`;
    const meta = [
      statusText(record.status, t),
      `t+${elapsed}`,
      `depth ${record.depth}`,
      record.nestedActiveCount ? `${record.nestedActiveCount} nested active` : undefined,
      record.model,
      record.thinkingLevel ? `think ${record.thinkingLevel}` : undefined,
      record.usage?.contextPercent !== undefined && record.usage.contextPercent !== null
        ? `ctx ${record.usage.contextPercent}%`
        : undefined,
    ]
      .filter(Boolean)
      .join(t.fg("dim", " · "));
    return [
      truncateToWidth(title, bodyWidth),
      truncateToWidth(`${selected ? t.fg("accent", "  ") : "  "}${t.fg("dim", meta)}`, bodyWidth),
      ...renderToolTree(record.events, t, 100)
        .slice(0, 3)
        .map((line) => truncateToWidth(`  ${line}`, bodyWidth, "…", true)),
    ];
  }

  private renderDetail(width: number, record: SubagentRecord, maxRows: number): string[] {
    const t = this.theme;
    const hint = t.fg("dim", "↑↓ scroll · s steer · a abort · e enter · Esc back");
    const lines = [
      `${statusText(record.status, t)} ${t.fg("dim", `· depth ${record.depth} · ${formatDuration((record.endedAt ?? now()) - record.createdAt)}`)}`,
      "",
    ];
    const renderedEvents = renderToolTree(record.events, t, 180, Number.POSITIVE_INFINITY);
    const pageRows = Math.max(1, maxRows - 4);
    const visible = renderedEvents.slice(this.scroll, this.scroll + pageRows);
    if (visible.length > 0) lines.push(...visible);
    else lines.push(t.fg("dim", "No activity yet. The sub-agent may still be starting."));
    return this.withHint(lines, hint, maxRows).map((line) =>
      truncateToWidth(line, width, "…", true),
    );
  }

  private withHint(lines: string[], hint: string, maxRows: number): string[] {
    const rowLimit = Math.max(1, maxRows);
    if (rowLimit === 1) return [hint];
    const body = lines.slice(0, rowLimit - 1);
    while (body.length < rowLimit - 1) body.push("");
    return [...body, hint];
  }
}

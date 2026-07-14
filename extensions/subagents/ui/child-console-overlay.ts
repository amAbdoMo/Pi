import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { SubagentRecord } from "../types.ts";
import { formatDuration, now } from "../utils.ts";
import { framedPanel, renderToolTree, statusText } from "../render-utils.ts";

export class ChildConsoleOverlay implements Component {
  private scroll = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly theme: Theme,
    private readonly record: SubagentRecord,
    private readonly done: (value: { action: "send" | "abort" } | undefined) => void,
    private readonly requestRender: () => void,
    private readonly getBodyRows: () => number = () => 24,
  ) {
    this.refreshTimer = setInterval(() => this.invalidate(), 1_000);
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
    const t = this.theme;
    const contentWidth = Math.max(1, width - 4);
    const maxRows = this.getBodyRows();
    const hint = t.fg("dim", "↑↓ scroll · i/s steer · a abort · r refresh · Esc parent");
    const lines = [
      `${statusText(this.record.status, t)} ${t.fg("dim", `· depth ${this.record.depth} · ${formatDuration((this.record.endedAt ?? now()) - this.record.createdAt)}`)}`,
      "",
    ];
    const rendered = renderToolTree(this.record.events, t, 180, Number.POSITIVE_INFINITY);
    const visible = rendered.slice(this.scroll, this.scroll + Math.max(1, maxRows - 4));
    if (visible.length > 0) lines.push(...visible);
    else lines.push(t.fg("dim", "No activity yet. The sub-agent may still be starting."));
    const rowLimit = Math.max(1, maxRows);
    const body = lines.slice(0, Math.max(0, rowLimit - 1));
    while (body.length < rowLimit - 1) body.push("");
    body.push(hint);
    const wrapped = body.map((line) => truncateToWidth(line, contentWidth, "…", true));
    this.cachedWidth = width;
    this.cachedLines = framedPanel(
      t,
      `Sub-agent / ${this.record.generatedLabel || this.record.id}`,
      wrapped,
      width,
      Math.min(maxRows, 24),
    );
    return this.cachedLines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scroll += 1;
      this.invalidate();
      return;
    }
    if (data === "i" || data === "s") this.done({ action: "send" });
    if (data === "a") this.done({ action: "abort" });
    if (data === "r") this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.requestRender();
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}

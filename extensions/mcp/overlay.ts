import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
} from "@earendil-works/pi-tui";

import type { McpHub } from "./hub.ts";
import type { McpServerState, McpServerSummary, McpToolMetadata } from "./types.ts";

export class McpHubOverlay implements Component {
	private readonly theme: Theme;
	private readonly hub: McpHub;
	private readonly done: () => void;
	private readonly requestRender: () => void;
	private readonly getBodyRows: () => number;
	private selectedIndex = 0;
	private busy = false;
	private message?: { kind: "info" | "error"; text: string };
	private cachedWidth?: number;
	private cachedLines?: string[];
	private closed = false;

	constructor(
		theme: Theme,
		hub: McpHub,
		done: () => void,
		requestRender: () => void,
		getBodyRows: () => number,
	) {
		this.theme = theme;
		this.hub = hub;
		this.done = done;
		this.requestRender = requestRender;
		this.getBodyRows = getBodyRows;
	}

	handleInput(input: string): void {
		if (matchesKey(input, Key.escape) || matchesKey(input, Key.ctrl("c"))) return this.close();
		if (this.busy) return;
		if (matchesKey(input, Key.up)) return this.moveSelection(-1);
		if (matchesKey(input, Key.down)) return this.moveSelection(1);
		if (matchesKey(input, Key.enter) || matchesKey(input, Key.space)) {
			void this.toggleSelectedServer();
			return;
		}
		if (input.toLowerCase() === "r") void this.reloadConfiguration();
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
		const panelWidth = Math.max(4, width);
		const contentWidth = Math.max(1, panelWidth - 4);
		const body = this.renderBody(contentWidth, Math.max(8, this.getBodyRows()));
		this.cachedLines = framedPanel(this.theme, "MCP Hub", body, panelWidth);
		this.cachedWidth = width;
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		if (!this.closed) this.requestRender();
	}

	private renderBody(width: number, rows: number): string[] {
		const summaries = this.hub.serverSummaries();
		this.selectedIndex = clampedIndex(this.selectedIndex, summaries.length);
		const selected = summaries[this.selectedIndex];
		const connected = summaries.filter((server) => server.state === "connected").length;
		const diagnostics = this.hub.diagnostics().length;
		const fixedRows = 6 + (this.message || selected?.error ? 1 : 0);
		const contentRows = Math.max(2, rows - fixedRows);
		const serverRows = Math.max(1, Math.min(summaries.length || 1, Math.ceil(contentRows * 0.45)));
		const toolRows = Math.max(1, contentRows - serverRows);
		const body = [
			this.theme.fg("muted", `${summaries.length} configured · ${connected} connected · ${diagnostics} diagnostic(s)`),
			this.theme.fg("borderMuted", "─".repeat(width)),
			this.theme.fg("toolTitle", this.theme.bold("Servers")),
			...this.serverLines(summaries, serverRows, width),
			this.theme.fg("toolTitle", this.theme.bold(selected ? `Tools · ${selected.name}` : "Tools")),
			...this.toolLines(selected, toolRows, width),
		];
		const statusMessage = this.messageLine() ?? selectedErrorLine(this.theme, selected);
		if (statusMessage) body.push(statusMessage);
		while (body.length < rows - 1) body.push("");
		body.push(this.theme.fg("dim", "↑↓ select · Enter connect/disconnect · R reload · Esc close"));
		return body.slice(0, rows);
	}

	private serverLines(summaries: McpServerSummary[], rowCount: number, width: number): string[] {
		if (summaries.length === 0) return [this.theme.fg("dim", "No MCP servers configured")];
		const start = selectionWindowStart(this.selectedIndex, summaries.length, rowCount);
		return summaries.slice(start, start + rowCount).map((server, offset) => {
			const selected = start + offset === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "›") : " ";
			const name = selected ? this.theme.fg("accent", this.theme.bold(server.name)) : server.name;
			const tools = server.toolCount > 0 ? ` · ${server.toolCount}` : "";
			return truncateToWidth(`${prefix} ${statusGlyph(this.theme, server.state)} ${name}${tools}`, width, "…", true);
		});
	}

	private toolLines(selected: McpServerSummary | undefined, rowCount: number, width: number): string[] {
		if (!selected) return [this.theme.fg("dim", "Select a configured server")];
		const tools = this.hub.peekTools(selected.name);
		if (tools.length === 0) {
			const message = selected.state === "connected" ? "No tools advertised" : "Connect to discover tools";
			return [this.theme.fg("dim", message)];
		}
		return tools.slice(0, rowCount).map((tool) => toolLine(this.theme, tool, width));
	}

	private messageLine(): string | undefined {
		if (!this.message) return undefined;
		const role = this.message.kind === "error" ? "error" : "muted";
		return this.theme.fg(role, this.message.text);
	}

	private moveSelection(delta: number): void {
		const count = this.hub.serverSummaries().length;
		if (count === 0) return;
		this.selectedIndex = Math.max(0, Math.min(count - 1, this.selectedIndex + delta));
		this.message = undefined;
		this.invalidate();
	}

	private async toggleSelectedServer(): Promise<void> {
		const selected = this.hub.serverSummaries()[this.selectedIndex];
		if (!selected) return;
		if (selected.state === "disabled") {
			this.message = { kind: "error", text: `${selected.name} is disabled in MCP config` };
			this.invalidate();
			return;
		}
		await this.runOperation(selected.name, async () => {
			if (selected.state === "connected") {
				await this.hub.disconnectServer(selected.name);
				return `Disconnected ${selected.name}`;
			}
			const tools = await this.hub.connectServer(selected.name);
			return `Connected ${selected.name} · ${tools.length} tool(s)`;
		});
	}

	private async reloadConfiguration(): Promise<void> {
		const selectedName = this.hub.serverSummaries()[this.selectedIndex]?.name;
		await this.runOperation(selectedName, async () => {
			const summary = await this.hub.reload();
			if (selectedName) {
				const nextIndex = this.hub.serverSummaries().findIndex((server) => server.name === selectedName);
				if (nextIndex >= 0) this.selectedIndex = nextIndex;
			}
			return `Reloaded · ${summary.serverCount} server(s)`;
		});
	}

	private async runOperation(serverName: string | undefined, operation: () => Promise<string>): Promise<void> {
		this.busy = true;
		this.message = { kind: "info", text: "Working…" };
		this.invalidate();
		try {
			this.message = { kind: "info", text: await operation() };
		} catch (error) {
			this.message = { kind: "error", text: this.hub.publicError(error, serverName) };
		} finally {
			this.busy = false;
			this.invalidate();
		}
	}

	private close(): void {
		this.closed = true;
		this.done();
	}
}

function statusGlyph(theme: Theme, state: McpServerState): string {
	switch (state) {
		case "connected":
			return theme.fg("success", "●");
		case "connecting":
			return theme.fg("accent", "◉");
		case "error":
			return theme.fg("error", "×");
		case "disabled":
			return theme.fg("muted", "–");
		case "disconnected":
			return theme.fg("dim", "○");
	}
}

function toolLine(theme: Theme, tool: McpToolMetadata, width: number): string {
	const description = tool.description?.replace(/\s+/g, " ").trim();
	const suffix = description ? theme.fg("dim", ` — ${description}`) : "";
	return truncateToWidth(`  ${theme.fg("toolOutput", tool.name)}${suffix}`, width, "…", true);
}

function selectedErrorLine(theme: Theme, selected: McpServerSummary | undefined): string | undefined {
	return selected?.error ? theme.fg("error", selected.error) : undefined;
}

function clampedIndex(selectedIndex: number, count: number): number {
	return count === 0 ? 0 : Math.max(0, Math.min(selectedIndex, count - 1));
}

function selectionWindowStart(selectedIndex: number, count: number, rowCount: number): number {
	return Math.max(0, Math.min(selectedIndex - Math.floor(rowCount / 2), count - rowCount));
}

function framedPanel(theme: Theme, title: string, body: string[], width: number): string[] {
	const innerWidth = Math.max(2, width - 2);
	const contentWidth = Math.max(0, innerWidth - 2);
	const fittedTitle = truncateToWidth(theme.bold(title), Math.max(0, innerWidth - 2), "", true);
	const heading = innerWidth > 2 ? ` ${theme.fg("accent", fittedTitle)} ` : "";
	const headingFill = "─".repeat(Math.max(0, innerWidth - visibleWidth(heading)));
	const border = (text: string) => theme.fg("border", text);
	const lines = [border("┌") + heading + border(`${headingFill}┐`)];
	for (const rawLine of body) {
		const content = truncateToWidth(rawLine, contentWidth, "…", true);
		const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
		lines.push(`${border("│")} ${content}${fill} ${border("│")}`);
	}
	lines.push(border(`└${"─".repeat(innerWidth)}┘`));
	return lines.map((line) => truncateToWidth(line, width, "", true));
}

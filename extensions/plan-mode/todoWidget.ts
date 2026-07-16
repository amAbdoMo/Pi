import type { TodoItem } from "./utils.ts";

const MIN_TODO_BUBBLE_WIDTH = 24;
const MAX_TODO_BUBBLE_WIDTH = 88;

export interface PlanTodoWidgetTheme {
	fg(color: "accent" | "success" | "error" | "muted" | "dim" | "customMessageLabel" | "customMessageText", text: string): string;
	bg(color: "customMessageBg", text: string): string;
	getBgAnsi?(color: "customMessageBg"): string | undefined;
	bold(text: string): string;
	strikethrough(text: string): string;
}

export class PlanTodoWidget {
	private readonly todoItems: readonly TodoItem[];
	private readonly theme: PlanTodoWidgetTheme;

	constructor(todoItems: readonly TodoItem[], theme: PlanTodoWidgetTheme) {
		this.todoItems = todoItems;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.todoItems.length === 0 || width <= 0) return [];

		const title = this.titleText();
		const widestItem = Math.max(...this.todoItems.map((todoItem) => visibleWidth(todoItem.text) + 2));
		const bubbleWidth = todoBubbleWidth(width, Math.max(visibleWidth(title), widestItem));
		const contentWidth = Math.max(1, bubbleWidth - 2);
		const lines = [this.renderTitle(title, contentWidth), ...this.renderItems(contentWidth)];
		return lines.map((line) => this.background(padLine(` ${line}`, bubbleWidth)));
	}

	private titleText(): string {
		const completed = this.todoItems.filter((todoItem) => todoItem.status === "completed").length;
		const active = this.todoItems.find((todoItem) => todoItem.status === "running");
		return active
			? `Plan tasks · running ${active.step}`
			: `Plan tasks · ${completed}/${this.todoItems.length} done`;
	}

	private renderTitle(title: string, contentWidth: number): string {
		return this.theme.fg(
			"customMessageLabel",
			this.theme.bold(truncateText(title, contentWidth)),
		);
	}

	private renderItems(contentWidth: number): string[] {
		const lines: string[] = [];
		for (const todoItem of this.todoItems) {
			const symbol = todoStatusSymbol(todoItem.status);
			const symbolText = this.theme.fg(todoStatusColor(todoItem.status), symbol);
			const wrapped = wrapText(todoItem.text, Math.max(1, contentWidth - 2));
			const [first = "", ...rest] = wrapped;
			lines.push(`${symbolText} ${this.styleTaskText(todoItem.status, first)}`);
			for (const continuation of rest) {
				lines.push(`  ${this.styleTaskText(todoItem.status, continuation)}`);
			}
		}
		return lines;
	}

	private styleTaskText(status: TodoItem["status"], text: string): string {
		if (status === "completed") {
			return this.theme.fg("muted", this.theme.strikethrough(text));
		}
		return this.theme.fg("customMessageText", text);
	}

	private background(line: string): string {
		const backgroundAnsi = this.theme.getBgAnsi?.("customMessageBg");
		if (!backgroundAnsi) return this.theme.bg("customMessageBg", line);
		const painted = line.replace(
			/\x1b\[(?:0|49)m/g,
			(reset) => `${reset}${backgroundAnsi}`,
		);
		return `${backgroundAnsi}${painted}\x1b[49m`;
	}
}

export function todoBubbleWidth(width: number, widestContentWidth: number): number {
	const terminalWidth = Math.max(1, Math.floor(width));
	const naturalWidth = Math.max(
		MIN_TODO_BUBBLE_WIDTH,
		Math.floor(widestContentWidth) + 2,
	);
	return Math.min(terminalWidth, MAX_TODO_BUBBLE_WIDTH, naturalWidth);
}

function todoStatusSymbol(status: TodoItem["status"]): string {
	switch (status) {
		case "running":
			return "◉";
		case "completed":
			return "✓";
		case "failed":
			return "✕";
		default:
			return "○";
	}
}

function todoStatusColor(status: TodoItem["status"]): "accent" | "success" | "error" | "muted" {
	switch (status) {
		case "running":
			return "accent";
		case "completed":
			return "success";
		case "failed":
			return "error";
		default:
			return "muted";
	}
}

function wrapText(text: string, width: number): string[] {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length === 0) return [""];
	const words = normalized.split(" ");
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (line.length === 0) {
			line = word;
			continue;
		}
		if (visibleWidth(`${line} ${word}`) <= width) {
			line += ` ${word}`;
			continue;
		}
		lines.push(...breakLongLine(line, width));
		line = word;
	}
	lines.push(...breakLongLine(line, width));
	return lines;
}

function breakLongLine(text: string, width: number): string[] {
	if (visibleWidth(text) <= width) return [text];
	const characters = Array.from(text);
	const lines: string[] = [];
	for (let index = 0; index < characters.length; index += width) {
		lines.push(characters.slice(index, index + width).join(""));
	}
	return lines;
}

function truncateText(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	const characters = Array.from(text);
	if (width <= 1) return characters.slice(0, width).join("");
	return `${characters.slice(0, width - 1).join("")}…`;
}

function padLine(line: string, width: number): string {
	return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

function visibleWidth(text: string): number {
	return Array.from(text.replace(/\x1b\[[0-9;]*m/g, "")).length;
}

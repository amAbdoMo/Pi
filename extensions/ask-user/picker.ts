// Native Pi-framed question picker built on pi-tui primitives.
// It mirrors Pi's rounded workspace frame and uses pi-tui's terminal-width
// utilities so styled and wide-character answers stay inside the border.

import {
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type KeybindingsManager,
	type Theme,
	type TUI,
} from "@earendil-works/pi-tui";

export type PickerOption = {
	label: string;
	description?: string;
	recommended?: boolean;
};

export type PickerResult = { value: string; custom: boolean } | undefined;

const MAX_VISIBLE_OPTIONS = 6;

function wrapPlain(text: string, width: number): string[] {
	const words = String(text ?? "").split(/\s+/).filter(Boolean);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (visibleWidth(candidate) > width && line) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	return lines;
}

export class FramedQuestionPicker implements Component, Focusable {
	focused = true;

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly done: (result: PickerResult) => void;
	private readonly heading: string;
	private readonly bodyText?: string;
	private readonly options: PickerOption[];
	private readonly customLabel = "Type your own answer";
	private readonly questionNumber: number;

	private selectedIndex = 0;
	private scrollOffset = 0;
	private inputMode = false;
	private inputBuffer = "";
	private finished = false;

	constructor(
		tui: TUI,
		theme: Theme,
		_keybindings: KeybindingsManager,
		opts: {
			questionNumber: number;
			title: string;
			context?: string;
			options: PickerOption[];
			allowCustom: boolean;
		},
		done: (result: PickerResult) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.done = done;
		this.questionNumber = opts.questionNumber;
		this.heading = opts.title;
		this.bodyText = opts.context;
		this.options = opts.allowCustom && opts.options.length > 0
			? [...opts.options, { label: this.customLabel }]
			: [...opts.options];
		this.inputMode = this.options.length === 0;
	}

	handleInput(data: string): void {
		if (this.finished) return;

		if (this.inputMode) {
			if (data === "\x1b") {
				this.inputMode = false;
				this.inputBuffer = "";
				this.tui.requestRender();
				return;
			}
			if (data === "\r" || data === "\n") {
				const answer = this.inputBuffer.trim();
				if (!answer) return;
				this.finish({ value: answer, custom: true });
				return;
			}
			if (data === "\x7f" || data === "\b") {
				this.inputBuffer = this.inputBuffer.slice(0, -1);
				this.tui.requestRender();
				return;
			}
			// Printable characters and paste chunks (no escape prefixes).
			if (!data.includes("\x1b")) {
				this.inputBuffer += data;
				this.tui.requestRender();
			}
			return;
		}

		switch (true) {
			case data === "\x1b[A" || data === "\x1bOA":
				this.move(-1);
				return;
			case data === "\x1b[B" || data === "\x1bOB":
				this.move(1);
				return;
			case data === "\x1b":
			case data === "\x03":
				this.finish(undefined);
				return;
			case data === "\r" || data === "\n":
				this.activate();
				return;
		}

		if (data.length === 1 && data >= "1" && data <= "9") {
			const target = Number(data) - 1;
			if (target < this.options.length) {
				this.selectedIndex = target;
				this.activate();
			}
			return;
		}
	}

	render(width: number): string[] {
		const totalWidth = Math.max(20, width);
		const inner = totalWidth - 4; // "│ " + content + " │"
		const border = (text: string) => this.theme.fg("border", text);

		const title = ` Q${this.questionNumber} — ${this.heading} `;
		const maxTitleWidth = totalWidth - 2;
		const clippedTitle = truncateToWidth(title, maxTitleWidth, "…");
		const fill = "─".repeat(Math.max(0, maxTitleWidth - visibleWidth(clippedTitle)));

		const lines: string[] = [
			border("╭") + this.theme.fg("accent", this.theme.bold(clippedTitle)) + border(`${fill}╮`),
		];

		const content: string[] = [];
		if (this.bodyText) {
			for (const line of wrapPlain(this.bodyText, inner)) {
				content.push(this.theme.fg("muted", line));
			}
			content.push("");
		}

		if (this.inputMode) {
			content.push(this.theme.fg("accent", `❯ ${this.inputBuffer}▏`));
			content.push("");
			content.push(this.theme.fg("dim", "enter submit · esc back"));
		} else {
			// Sliding window keeps tall option lists inside the frame.
			const windowStart = Math.max(
				0,
				Math.min(this.selectedIndex - MAX_VISIBLE_OPTIONS + 1, this.options.length - MAX_VISIBLE_OPTIONS),
			);
			const windowEnd = Math.min(this.options.length, windowStart + MAX_VISIBLE_OPTIONS);
			for (let i = windowStart; i < windowEnd; i++) {
				const option = this.options[i];
				const isSelected = i === this.selectedIndex;
				const isCustom = option.label === this.customLabel;
				const prefix = isSelected ? this.theme.fg("accent", "❯ ") : "  ";
				const number = this.theme.fg(isSelected ? "accent" : "muted", `${i + 1}. `);
				const labelText = isCustom ? this.theme.fg("dim", option.label) : option.label;
				const label = isSelected
					? this.theme.fg("accent", labelText)
					: labelText;
				const recommendation = option.recommended
					? this.theme.fg("warning", "  Recommended")
					: "";
				content.push(`${prefix}${number}${label}${recommendation}`);
				if (option.description) {
					for (const line of wrapPlain(option.description, inner - 4)) {
						content.push(`    ${this.theme.fg("dim", line)}`);
					}
				}
			}
			if (this.options.length > MAX_VISIBLE_OPTIONS) {
				content.push(this.theme.fg("dim", `  ${this.selectedIndex + 1}/${this.options.length}`));
			}
			content.push("");
			content.push(this.theme.fg("dim", "↑↓ navigate · 1-9 quick pick · enter confirm · esc dismiss"));
		}

		for (const line of content) {
			const clipped = truncateToWidth(line, inner, "…");
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
			lines.push(`${border("│ ")}${clipped}${pad}${border(" │")}`);
		}

		lines.push(border(`╰${"─".repeat(totalWidth - 2)}╯`));
		return lines;
	}

	private move(delta: number): void {
		const count = this.options.length;
		if (count === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + count) % count;
		this.tui.requestRender();
	}

	private activate(): void {
		const option = this.options[this.selectedIndex];
		if (!option) return;
		if (option.label === this.customLabel) {
			this.inputMode = true;
			this.inputBuffer = "";
			this.tui.requestRender();
			return;
		}
		this.finish({ value: option.label, custom: false });
	}

	private finish(result: PickerResult): void {
		if (this.finished) return;
		this.finished = true;
		this.done(result);
	}
}

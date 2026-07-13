import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	SelectList,
	Text,
	type AutocompleteProvider,
	type SelectItem,
} from "@earendil-works/pi-tui";
import {
	skillChoices,
	withoutSkillCommandSuggestions,
	type SkillChoice,
} from "./browser.ts";

type UiTheme = ExtensionContext["ui"]["theme"];

function skillListTheme(theme: UiTheme) {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

function hideSkillCommands(current: AutocompleteProvider): AutocompleteProvider {
	return {
		...(current.triggerCharacters && { triggerCharacters: current.triggerCharacters }),
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			return withoutSkillCommandSuggestions(suggestions);
		},
		applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
			current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
		...(current.shouldTriggerFileCompletion && {
			shouldTriggerFileCompletion: (lines: string[], cursorLine: number, cursorCol: number) =>
				current.shouldTriggerFileCompletion!(lines, cursorLine, cursorCol),
		}),
	};
}

async function showSkillPicker(ctx: ExtensionContext, choices: SkillChoice[]): Promise<string | null> {
	const items: SelectItem[] = choices;
	return ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		container.addChild(new Text(theme.fg("accent", theme.bold(`Skills (${items.length})`)), 1, 0));
		const list = new SelectList(items, Math.min(items.length, 10), skillListTheme(theme));
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
		container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export default function skillsBrowserExtension(pi: ExtensionAPI): void {
	pi.registerCommand("skills", {
		description: "Browse loaded skills",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			const choices = skillChoices(pi.getCommands());
			if (choices.length === 0) {
				ctx.ui.notify("No skills are loaded.", "info");
				return;
			}
			const selected = await showSkillPicker(ctx, choices);
			if (selected) ctx.ui.setEditorText(`/${selected} `);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.addAutocompleteProvider(hideSkillCommands);
	});
}

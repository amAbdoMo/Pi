export type CommandSummary = {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
};

export type SkillChoice = {
	value: string;
	label: string;
	description?: string;
};

export type AutocompleteSuggestions = {
	items: Array<{ value: string; label: string; description?: string }>;
	prefix: string;
};

export function skillChoices(commands: CommandSummary[]): SkillChoice[] {
	return commands
		.filter((command) => command.source === "skill")
		.map((command) => ({
			value: command.name,
			label: command.name.slice("skill:".length),
			...(command.description && { description: command.description }),
		}))
		.sort((left, right) => left.label.localeCompare(right.label));
}

export function withoutSkillCommandSuggestions(
	suggestions: AutocompleteSuggestions | null,
): AutocompleteSuggestions | null {
	if (!suggestions?.prefix.startsWith("/")) return suggestions;
	const items = suggestions.items.filter((item) => !item.value.startsWith("skill:"));
	return items.length > 0 ? { ...suggestions, items } : null;
}

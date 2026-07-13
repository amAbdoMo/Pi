export const CHILD_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ChildThinkingLevel = (typeof CHILD_THINKING_LEVELS)[number];

export interface ChildProfile {
  model?: string;
  thinking?: ChildThinkingLevel;
}

function normalizedModel(model: string | undefined): string | undefined {
  return model?.trim() || undefined;
}

export function resolveChildProfile(
  requested: ChildProfile,
  inherited: ChildProfile,
): ChildProfile {
  return {
    model: normalizedModel(requested.model) ?? normalizedModel(inherited.model),
    thinking: requested.thinking ?? inherited.thinking,
  };
}

export function childProfileArgs(profile: ChildProfile): string[] {
  const args: string[] = [];
  if (profile.model) args.push("--model", profile.model);
  if (profile.thinking) args.push("--thinking", profile.thinking);
  return args;
}

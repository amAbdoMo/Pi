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

export const CHILD_PROFILE_NAMES = [
  "fast",
  "balanced",
  "implementation",
  "review",
  "deep",
  "critical",
] as const;

export type ChildProfileName = (typeof CHILD_PROFILE_NAMES)[number];

export interface ChildProfile {
  model?: string;
  thinking?: ChildThinkingLevel;
}

export type ChildProfileMap = Record<ChildProfileName, ChildProfile>;

export const DEFAULT_CHILD_PROFILES: ChildProfileMap = {
  fast: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
  balanced: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
  implementation: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
  review: { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
  deep: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
  critical: { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
};

export interface RequestedChildProfile extends ChildProfile {
  profile?: ChildProfileName;
}

function normalizedModel(model: string | undefined): string | undefined {
  return model?.trim() || undefined;
}

export function resolveChildProfile(
  requested: RequestedChildProfile,
  inherited: ChildProfile,
  profiles: ChildProfileMap = DEFAULT_CHILD_PROFILES,
): ChildProfile {
  const selected = requested.profile ? profiles[requested.profile] : undefined;
  return {
    model:
      normalizedModel(requested.model) ??
      normalizedModel(selected?.model) ??
      normalizedModel(inherited.model),
    thinking:
      requested.thinking ?? selected?.thinking ?? inherited.thinking,
  };
}

export function resolveAvailableChildProfile(
  requested: RequestedChildProfile,
  inherited: ChildProfile,
  profiles: ChildProfileMap,
  isModelAvailable: (model: string) => boolean,
): ChildProfile {
  const resolved = resolveChildProfile(requested, inherited, profiles);
  if (
    requested.profile &&
    !normalizedModel(requested.model) &&
    resolved.model &&
    !isModelAvailable(resolved.model)
  ) {
    return resolveChildProfile(
      { thinking: requested.thinking },
      inherited,
      profiles,
    );
  }
  return resolved;
}

export function childProfileArgs(profile: ChildProfile): string[] {
  const args: string[] = [];
  if (profile.model) args.push("--model", profile.model);
  if (profile.thinking) args.push("--thinking", profile.thinking);
  return args;
}

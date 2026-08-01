import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentSettings } from "../types.ts";

function splitModelReference(reference: string | undefined) {
  if (!reference) return undefined;
  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return undefined;
  return {
    provider: reference.slice(0, separator),
    id: reference.slice(separator + 1),
  };
}

export function resolveSummaryRuntime(
  ctx: ExtensionContext,
  settings: SubagentSettings,
  fallbackThinking?: ThinkingLevel,
) {
  const profile = settings.profiles[settings.summaryProfile];
  const reference = splitModelReference(profile.model);
  const profileModel = reference
    ? ctx.modelRegistry
        .getAvailable()
        .find(
          (model) =>
            model.provider === reference.provider && model.id === reference.id,
        )
    : undefined;
  return {
    model: profileModel ?? ctx.model,
    thinkingLevel: profileModel ? profile.thinking : fallbackThinking,
  };
}

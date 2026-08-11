import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import type { SideChatSnapshot } from "./types.ts";

export function createSnapshot(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): SideChatSnapshot {
  if (!ctx.model) throw new Error("No model selected for /btw");

  const sessionContext = buildSessionContext(ctx.sessionManager.getBranch());
  return {
    cwd: ctx.cwd,
    model: ctx.model,
    thinkingLevel: pi.getThinkingLevel(),
    activeTools: pi.getActiveTools(),
    inheritedMessages: structuredClone(sessionContext.messages),
    systemPrompt: ctx.getSystemPrompt(),
    projectTrusted: ctx.isProjectTrusted(),
    inheritedWhileMainRunning: !ctx.isIdle(),
  };
}

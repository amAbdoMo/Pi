import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

import type { SideChatSnapshot } from "./types.ts";

export async function createSideSession(
  snapshot: SideChatSnapshot,
): Promise<AgentSession> {
  const { agentDir, resourceLoader, settingsManager } = await loadSideResources(snapshot);
  const { session } = await createAgentSession({
    cwd: snapshot.cwd,
    agentDir,
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    resourceLoader,
    sessionManager: SessionManager.inMemory(snapshot.cwd),
    settingsManager,
    tools: snapshot.activeTools,
  });

  session.state.messages = structuredClone(snapshot.inheritedMessages);
  return session;
}

async function loadSideResources(snapshot: SideChatSnapshot) {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(snapshot.cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: snapshot.cwd,
    agentDir,
    settingsManager,
    systemPrompt: createSideSystemPrompt(snapshot.systemPrompt),
    appendSystemPrompt: [],
    noContextFiles: true,
    noSkills: true,
  });
  await resourceLoader.reload({
    resolveProjectTrust: async () => snapshot.projectTrusted,
  });
  return { agentDir, resourceLoader, settingsManager };
}

function createSideSystemPrompt(baseSystemPrompt: string): string {
  return [
    "You are Pi's /btw side-chat agent.",
    "This temporary side conversation is not saved to or injected into the main conversation history.",
    "Use the inherited main-conversation context and the available tools to complete requested tasks, just like the main chat.",
    "You may inspect and modify files, run commands, and use extension tools when the task requires them.",
    "Tool side effects are real and shared with the main session; only this side conversation's messages remain isolated.",
    "Never alter, steer, or append to the main session's conversation history.",
    "If the inherited context is insufficient, inspect the project or explain what is missing instead of guessing.",
    "",
    "<main_system_prompt>",
    baseSystemPrompt,
    "</main_system_prompt>",
  ].join("\n");
}

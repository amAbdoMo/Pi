import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  requestPlanBuildModeToggle,
  subscribePlanBuildModeChanges,
} from "../plan-mode/modeEvents.ts";
import {
  setPlanBuildMode,
  subscribePlanBuildMode,
} from "../plan-mode/modeState.ts";
import {
  refreshChatGptUsage,
  resetChatGptUsage,
} from "./chatgptUsage.ts";
import { editors, notifyEditors } from "./editorRegistry.ts";
import { updateBranch } from "./git.ts";
import { bigPiHeader } from "./piHeader.ts";
import { expandPastedTextMarkers, imagesForText } from "./imagePaste.ts";
import { updateState } from "./state.ts";
import { subscribeSubagents } from "./subagents.ts";
import { TerminalEditor } from "./terminalEditor.ts";
import { clearTerminal } from "./terminal.ts";
import type { UiTheme } from "./types.ts";

// UI extension: startup header, terminal-style editor, and footer cleanup.
let unsubscribePlanBuildMode: (() => void) | undefined;
let unsubscribeSubagents: (() => void) | undefined;

export default function uiExtension(pi: ExtensionAPI) {
  subscribePlanBuildModeChanges(pi.events, setPlanBuildMode);

  pi.on("session_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;

    if (event.reason === "startup" || event.reason === "resume")
      clearTerminal();

    updateState(ctx, pi);
    void updateBranch(pi);
    void refreshChatGptUsage(ctx, { force: true });
    unsubscribePlanBuildMode?.();
    unsubscribePlanBuildMode = subscribePlanBuildMode(notifyEditors);
    unsubscribeSubagents?.();
    unsubscribeSubagents = subscribeSubagents(notifyEditors);

    ctx.ui.setHeader((_tui, theme) => ({
      render: () => bigPiHeader(theme as unknown as UiTheme),
      invalidate: () => {},
    }));

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TerminalEditor(
        tui,
        theme,
        keybindings,
        () => requestPlanBuildModeToggle(pi.events),
      );
      editors.add(editor);
      return editor;
    });

    // Move the model/thinking/folder/branch/context information into the editor
    // header, so the default footer does not duplicate it under the prompt.
    ctx.ui.setFooter((_tui, _theme) => ({
      render: () => [],
      invalidate: () => {},
    }));
  });

  pi.on("input", (event) => {
    const images = imagesForText(event.text);
    const expandedText = expandPastedTextMarkers(event.text);
    if (images.length === 0 && expandedText === event.text) return { action: "continue" as const };

    return {
      action: "transform" as const,
      text: expandedText,
      images: [
        ...(event.images ?? []),
        ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
      ],
    };
  });

  pi.on("model_select", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    void refreshChatGptUsage(ctx, { force: true });
    notifyEditors();
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    notifyEditors();
  });

  pi.on("message_end", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    if (event.message.role === "assistant") void refreshChatGptUsage(ctx);
    notifyEditors();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    void updateBranch(pi);
    void refreshChatGptUsage(ctx);
    notifyEditors();
  });

  pi.on("session_shutdown", async () => {
    resetChatGptUsage();
    unsubscribePlanBuildMode?.();
    unsubscribePlanBuildMode = undefined;
    unsubscribeSubagents?.();
    unsubscribeSubagents = undefined;
    editors.clear();
  });
}

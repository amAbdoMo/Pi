import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  requestPlanBuildModeToggle,
  subscribePlanBuildModeChanges,
} from "../plan-mode/modeEvents.ts";
import {
  setPlanBuildMode,
  subscribePlanBuildMode,
} from "../plan-mode/modeState.ts";
import { hasActiveWorkflowActivity } from "../workflow/activity.ts";
import {
  refreshChatGptUsage,
  resetChatGptUsage,
} from "./chatgptUsage.ts";
import { editors, notifyEditors } from "./editorRegistry.ts";
import { updateBranch } from "./git.ts";
import { workbenchHeader } from "./piHeader.ts";
import { expandPastedTextMarkers, imagesForText } from "./imagePaste.ts";
import { updateState } from "./state.ts";
import { hasActiveSubagents, subscribeSubagents } from "./subagents.ts";
import { TerminalEditor } from "./terminalEditor.ts";
import {
  createUsageRefreshPoller,
  type UsageRefreshPoller,
} from "./usagePolling.ts";
import { clearTerminal } from "./terminal.ts";
import type { UiTheme } from "./types.ts";
import { WorkbenchSidebarController } from "./workbenchSidebar.ts";

// UI extension: startup header, terminal-style editor, and footer cleanup.
let unsubscribePlanBuildMode: (() => void) | undefined;
let unsubscribeSubagents: (() => void) | undefined;
let subagentUsagePoller: UsageRefreshPoller | undefined;
const workbenchSidebar = new WorkbenchSidebarController();

export default function uiExtension(pi: ExtensionAPI) {
  subscribePlanBuildModeChanges(pi.events, setPlanBuildMode);

  pi.registerCommand("sidebar", {
    description: "Toggle the Pi workspace sidebar",
    handler: async (_args, ctx) => workbenchSidebar.toggle(ctx),
  });

  pi.registerShortcut(Key.ctrlAlt("w"), {
    description: "Toggle the Pi workspace sidebar",
    handler: async (ctx) => workbenchSidebar.toggle(ctx),
  });

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
    subagentUsagePoller?.dispose();
    subagentUsagePoller = createUsageRefreshPoller(() =>
      refreshChatGptUsage(ctx, { force: true }),
    );
    const syncUsageActivity = () => {
      notifyEditors();
      workbenchSidebar.invalidate();
      subagentUsagePoller?.setActive(
        hasActiveSubagents() || hasActiveWorkflowActivity(),
      );
    };
    unsubscribeSubagents = subscribeSubagents(syncUsageActivity);
    syncUsageActivity();
    workbenchSidebar.dispose();

    ctx.ui.setHeader((_tui, theme) => ({
      render: (width) => workbenchHeader(theme as unknown as UiTheme, width),
      invalidate: () => {},
    }));

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TerminalEditor(
        tui,
        theme,
        keybindings,
        () => requestPlanBuildModeToggle(pi.events),
      );
      workbenchSidebar.attachDocked(tui, ctx.ui.theme);
      editors.add(editor);
      return editor;
    });

    // The workbench surfaces own runtime status, so the stock footer stays empty.
    ctx.ui.setFooter((_tui, _theme) => ({
      render: () => [],
      invalidate: () => {},
    }));

    workbenchSidebar.mount(ctx);
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
    workbenchSidebar.invalidate();
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    notifyEditors();
    workbenchSidebar.invalidate();
  });

  pi.on("message_end", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    if (event.message.role === "assistant") void refreshChatGptUsage(ctx);
    notifyEditors();
    workbenchSidebar.invalidate();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    void updateBranch(pi);
    void refreshChatGptUsage(ctx);
    notifyEditors();
    workbenchSidebar.invalidate();
  });

  pi.on("session_shutdown", async () => {
    resetChatGptUsage();
    unsubscribePlanBuildMode?.();
    unsubscribePlanBuildMode = undefined;
    unsubscribeSubagents?.();
    unsubscribeSubagents = undefined;
    subagentUsagePoller?.dispose();
    subagentUsagePoller = undefined;
    workbenchSidebar.dispose();
    editors.clear();
  });
}

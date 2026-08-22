import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { hasActiveWorkflowActivity } from "../workflow/activity.ts";
import {
  resetAgentTime,
  settleAgentTime,
  startAgentTime,
} from "./agentTime.ts";
import {
  COPY_FEEDBACK_KEY,
  CopyFeedbackWidget,
  TransientFeedback,
} from "./copyFeedback.ts";
import {
  refreshChatGptUsage,
  resetChatGptUsage,
} from "./chatgptUsage.ts";
import { editors, notifyEditors } from "./editorRegistry.ts";
import { updateBranch } from "./git.ts";
import { sessionPiHeader } from "./piHeader.ts";
import { expandPastedTextMarkers, imagesForText } from "./imagePaste.ts";
import { state, updateState } from "./state.ts";
import { ensureAutomaticSessionTitle } from "./sessionTitle.ts";
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
let unsubscribeSubagents: (() => void) | undefined;
let subagentUsagePoller: UsageRefreshPoller | undefined;
let copyFeedback: TransientFeedback | undefined;
const workbenchSidebar = new WorkbenchSidebarController();

export default function uiExtension(pi: ExtensionAPI) {
  pi.registerCommand("sidebar", {
    description: "Toggle the Pi workspace sidebar",
    handler: async (_args, ctx) => workbenchSidebar.toggle(ctx),
  });

  pi.registerShortcut(Key.ctrlAlt("w"), {
    description: "Toggle the Pi workspace sidebar",
    handler: async (ctx) => workbenchSidebar.toggle(ctx),
  });

  pi.on("session_start", async (event, ctx) => {
    resetAgentTime();
    if (ctx.mode !== "tui") return;

    if (event.reason === "startup" || event.reason === "resume")
      clearTerminal();

    ensureAutomaticSessionTitle(pi, ctx, undefined, () => {
      updateState(ctx, pi);
      notifyEditors();
    });
    updateState(ctx, pi);
    void updateBranch(pi);
    void refreshChatGptUsage(ctx, { force: true });
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
      render: (width) => sessionPiHeader(
        theme as unknown as UiTheme,
        width,
        event.reason,
      ),
      invalidate: () => {},
    }));

    copyFeedback?.dispose();
    copyFeedback = new TransientFeedback(
      () =>
        ctx.ui.setWidget(
          COPY_FEEDBACK_KEY,
          (_tui, theme) => new CopyFeedbackWidget(theme),
          { placement: "belowEditor" },
        ),
      () => ctx.ui.setWidget(COPY_FEEDBACK_KEY, undefined),
    );

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new TerminalEditor(tui, theme, keybindings);
      workbenchSidebar.attachDocked(
        tui,
        ctx.ui.theme,
        ({ renderRow, screenColumn, width }) =>
          editor.placeCursorFromRenderedCell(renderRow, screenColumn, width),
        (error) => {
          ctx.ui.notify(`Could not copy the selected text: ${error.message}`, "error");
        },
        () => {
          copyFeedback?.trigger();
        },
      );
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

  pi.on("session_info_changed", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    state.sessionName = event.name;
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
    if (event.message.role === "user") {
      ensureAutomaticSessionTitle(pi, ctx, event.message.content, () => {
        updateState(ctx, pi);
        notifyEditors();
      });
    }
    updateState(ctx, pi);
    if (event.message.role === "assistant") void refreshChatGptUsage(ctx);
    notifyEditors();
    workbenchSidebar.invalidate();
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    startAgentTime();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    updateState(ctx, pi);
    void updateBranch(pi);
    void refreshChatGptUsage(ctx);
    notifyEditors();
    workbenchSidebar.invalidate();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    settleAgentTime();
  });

  pi.on("session_shutdown", async (event) => {
    resetAgentTime();
    resetChatGptUsage();
    copyFeedback?.dispose();
    copyFeedback = undefined;
    unsubscribeSubagents?.();
    unsubscribeSubagents = undefined;
    subagentUsagePoller?.dispose();
    subagentUsagePoller = undefined;
    if (event.reason === "quit") workbenchSidebar.dispose();
    else workbenchSidebar.detachForSessionChange();
    editors.clear();
  });
}

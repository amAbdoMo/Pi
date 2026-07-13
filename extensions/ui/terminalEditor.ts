import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  matchesKey,
  visibleWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { bold, color, padToWidth } from "./formatting.ts";
import { buildHeader } from "./header.ts";
import {
  readBestImage,
  readClipboardText,
  savePastedText,
} from "./imagePaste.ts";
import { highlightPasteMarkers } from "./pasteMarkers.ts";
import { isEmptyBracketedPaste } from "./terminalCompatibility.ts";
import type { KeybindingsManager } from "./types.ts";

function isWarpTerminal(): boolean {
  return (
    process.env.TERM_PROGRAM === "WarpTerminal" ||
    process.env.WARP_IS_LOCAL_SHELL_SESSION === "1"
  );
}

function stripAnsi(input: string): string {
  return input
    .replaceAll(CURSOR_MARKER, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P_\^][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

function looksLikeEditorBorder(line: string): boolean {
  const clean = stripAnsi(line).trim();
  return clean.includes("─") && /^[─ ↑↓0-9more]+$/.test(clean);
}

export class TerminalEditor extends CustomEditor {
  private busyPastingClipboard = false;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly togglePlanBuildMode: () => void,
  ) {
    // paddingX 0 avoids the stock editor's side-padding/wrap weirdness.
    super(tui, theme, keybindings, { paddingX: 0 });
  }

  requestRender(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  override handleInput(inputSequence: string): void {
    if (matchesKey(inputSequence, "tab")) {
      this.togglePlanBuildMode();
      return;
    }

    const isCustomPaste =
      matchesKey(inputSequence, "ctrl+v") || matchesKey(inputSequence, "alt+v");
    const isWarpImagePaste = isWarpTerminal() && isEmptyBracketedPaste(inputSequence);
    if (process.platform === "win32" && (isCustomPaste || isWarpImagePaste)) {
      this.pasteCompactImage();
      return;
    }

    super.handleInput(inputSequence);
  }

  private pasteClipboardText(): boolean {
    const text = readClipboardText();
    if (!text) return false;
    const pastedText = savePastedText(text, this.getText());
    this.insertTextAtCursor(pastedText.marker);
    this.requestRender();
    return true;
  }

  private pasteCompactImage(): void {
    if (this.busyPastingClipboard) return;
    this.busyPastingClipboard = true;
    try {
      const image = readBestImage(this.getText());
      if (image) {
        this.insertTextAtCursor(image.marker);
        this.requestRender();
        return;
      }

      this.pasteClipboardText();
    } finally {
      this.busyPastingClipboard = false;
    }
  }

  override render(width: number): string[] {
    const promptSymbol = this.getText().startsWith("!") ? "# " : "> ";
    const prompt = color("border", "╰─") + color("accent", promptSymbol);
    const promptWidth = visibleWidth(prompt);
    const innerWidth = Math.max(1, width - promptWidth);

    const stockLines = super
      .render(innerWidth)
      .filter((line) => !looksLikeEditorBorder(line));

    const inputLines = stockLines.length > 0 ? stockLines : [""];
    const lines: string[] = [buildHeader(width)];

    for (let i = 0; i < inputLines.length; i++) {
      const prefix = i === 0 ? prompt : " ".repeat(promptWidth);
      const inputLine = highlightPasteMarkers(inputLines[i], (marker) =>
        color("mdCode", bold(marker)),
      );
      lines.push(padToWidth(prefix + inputLine, width));
    }

    return lines;
  }
}

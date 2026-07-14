import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  matchesKey,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  background,
  bold,
  clipToWidth,
  color,
  textWidth,
} from "./formatting.ts";
import {
  buildComposerBodyLine,
  buildComposerFooter,
  buildComposerHeader,
} from "./header.ts";
import {
  readBestImage,
  readClipboardText,
  savePastedText,
} from "./imagePaste.ts";
import { highlightPasteMarkers } from "./pasteMarkers.ts";
import { isEmptyBracketedPaste } from "./terminalCompatibility.ts";
import { visualRtlText } from "./rtlText.ts";
import type { KeybindingsManager } from "./types.ts";
import { composerFrame, directionStatus } from "./workbenchLayout.ts";

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
    const text = this.getText();
    const outerPadding = width >= 3 ? 1 : 0;
    const frame = composerFrame(Math.max(1, width - outerPadding * 2));
    const direction = directionStatus(text);
    const isRtl = direction.startsWith("RTL");
    const promptSymbol = text.startsWith("!") ? "# " : isRtl ? " ‹" : "› ";
    const prompt = frame.innerWidth >= 3 ? color("accent", promptSymbol) : "";
    const promptWidth = textWidth(prompt);
    const editorWidth = Math.max(1, frame.innerWidth - promptWidth);

    const stockLines = super
      .render(editorWidth)
      .filter((line) => !looksLikeEditorBorder(line));
    const inputLines = stockLines.length > 0 ? stockLines : [""];
    const lines = buildComposerHeader(frame.width, direction);

    for (let index = 0; index < inputLines.length; index++) {
      const visualLine = isRtl
        ? visualRtlText(inputLines[index]!, CURSOR_MARKER)
        : inputLines[index]!;
      const inputLine = highlightPasteMarkers(visualLine, (marker) =>
        color("mdCode", bold(marker)),
      );
      const content = isRtl
        ? rtlComposerLine(inputLine, index === 0 ? prompt : "", frame.innerWidth)
        : `${index === 0 ? prompt : " ".repeat(promptWidth)}${inputLine}`;
      lines.push(buildComposerBodyLine(content, frame.width));
    }

    lines.push(buildComposerFooter(frame.width));
    const horizontalGutter = " ".repeat(outerPadding);
    const composerLines = lines.map((line) =>
      `${horizontalGutter}${background("userMessageBg", line)}${horizontalGutter}`
    );
    if (outerPadding === 0) return composerLines;
    const verticalGutter = " ".repeat(width);
    return [verticalGutter, ...composerLines, verticalGutter];
  }
}

function rtlComposerLine(text: string, prompt: string, width: number): string {
  const promptWidth = textWidth(prompt);
  const contentWidth = Math.max(0, width - promptWidth);
  const content = clipToWidth(text, contentWidth);
  const leftPadding = " ".repeat(Math.max(0, contentWidth - textWidth(content)));
  return `${leftPadding}${content}${prompt}`;
}

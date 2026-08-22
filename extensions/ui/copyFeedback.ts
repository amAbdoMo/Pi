export const COPY_FEEDBACK_VISIBLE_MS = 2_000;

export interface CopyFeedbackTheme {
  bold(text: string): string;
  getFgAnsi(color: "success"): string;
}

export interface CopyFeedbackState {
  visible: boolean;
}

/** Shared so the Workbench chat viewport can render the transient badge. */
export const copyFeedbackState: CopyFeedbackState = { visible: false };

let badgeTheme: CopyFeedbackTheme | undefined;

export function setCopyFeedbackTheme(theme: CopyFeedbackTheme): void {
  badgeTheme = theme;
}

export function clearCopyFeedbackTheme(): void {
  badgeTheme = undefined;
  copyFeedbackState.visible = false;
}

/**
 * Solid success badge rendered inside the chat viewport while visible:
 * the theme's success green becomes the chip background.
 */
export function renderCopyBadgeLine(): string | undefined {
  if (!copyFeedbackState.visible || !badgeTheme) return undefined;
  const badgeBg = badgeTheme.getFgAnsi("success").replace("\x1b[38;", "\x1b[48;");
  return `${badgeBg}\x1b[30m${badgeTheme.bold(" ✓ Copied ")}\x1b[39m\x1b[49m`;
}

/** Transient visibility that hides itself once and restarts on re-trigger. */
export class TransientFeedback {
  private handle: ReturnType<typeof setTimeout> | undefined;
  private readonly show: () => void;
  private readonly hide: () => void;

  constructor(show: () => void, hide: () => void) {
    this.show = show;
    this.hide = hide;
  }

  trigger(): void {
    this.show();
    if (this.handle !== undefined) clearTimeout(this.handle);
    this.handle = setTimeout(() => {
      this.handle = undefined;
      this.hide();
    }, COPY_FEEDBACK_VISIBLE_MS);
  }

  dispose(): void {
    if (this.handle !== undefined) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
    this.hide();
  }
}

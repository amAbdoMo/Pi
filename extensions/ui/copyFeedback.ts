export const COPY_FEEDBACK_KEY = "copy-feedback";
export const COPY_FEEDBACK_VISIBLE_MS = 2_000;

export interface CopyFeedbackTheme {
  bold(text: string): string;
  fg(color: "success", text: string): string;
  getFgAnsi(color: "success"): string;
}

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

export class CopyFeedbackWidget {
  private readonly theme: CopyFeedbackTheme;

  constructor(theme: CopyFeedbackTheme) {
    this.theme = theme;
  }

  invalidate(): void {}

  render(): string[] {
    // Solid success badge: reuse the theme's success green as the background
    // so the confirmation reads as a highlighted chip, not plain chat text.
    const badgeBg = this.theme.getFgAnsi("success").replace("\x1b[38;", "\x1b[48;");
    return [
      `${badgeBg}\x1b[30m${this.theme.bold(" ✓ Copied ")}\x1b[39m\x1b[49m`,
    ];
  }
}

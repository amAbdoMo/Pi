import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { state } from "./state.ts";

export function color(token: string, text: string): string {
  return state.theme?.fg?.(token, text) ?? text;
}

export function bold(text: string): string {
  return state.theme?.bold?.(text) ?? text;
}

export function background(token: string, text: string): string {
  const theme = state.theme;
  const backgroundAnsi = theme?.getBgAnsi?.(token);
  if (backgroundAnsi) {
    const painted = text.replace(
      /\x1b\[(?:0|49)m/g,
      (reset) => `${reset}${backgroundAnsi}`,
    );
    return `${backgroundAnsi}${painted}\x1b[49m`;
  }
  return theme?.bg?.(token, text) ?? text;
}

export function ratioProgressBar(ratio: number, width = 4): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return (
    color("accent", "━".repeat(filled)) +
    color("borderMuted", "─".repeat(width - filled))
  );
}

export function clipToWidth(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "");
}

export function textWidth(line: string): number {
  return visibleWidth(line);
}

export function padToWidth(line: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const clipped = clipToWidth(line, safeWidth);
  return clipped + " ".repeat(Math.max(0, safeWidth - textWidth(clipped)));
}

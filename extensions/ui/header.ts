import { getPlanBuildMode } from "../plan-mode/modeState.ts";
import { chatGptLimitLabels } from "./chatgptUsage.ts";
import {
  bold,
  clipToWidth,
  color,
  padToWidth,
  textWidth,
} from "./formatting.ts";
import { state } from "./state.ts";
import { composerFrame } from "./workbenchLayout.ts";

function thinkingColor(level: string): string {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "thinkingOff";
  }
}

function composerTitle(direction: string): string {
  const directionLabel = direction.startsWith("RTL")
    ? color("warning", " · RTL ")
    : "";
  return color("accent", bold(" message ")) + directionLabel;
}

function composerStatus(width: number): string {
  const mode = getPlanBuildMode();
  const modeRole = mode === "plan" ? "warning" : "success";
  const fastMode = state.getFastModeActive?.() ?? state.fastModeActive;
  const modelAndThinking =
    color("toolTitle", `󰧑 ${state.model}`) +
    "  " +
    color(thinkingColor(state.thinking), `think ${state.thinking}`);
  const fields = [
    color(modeRole, `󰒓 ${mode.toUpperCase()}`),
    modelAndThinking,
    ...(fastMode ? [color("accent", "fast")] : []),
    ...chatGptLimitLabels(),
  ];
  return clipToWidth(fields.join(color("borderMuted", " · ")), width);
}

function topBorder(width: number, direction: string): string {
  const frame = composerFrame(width);
  const title = composerTitle(direction);
  if (!frame.framed) return padToWidth(title, frame.width);

  const fittedTitle = clipToWidth(title, Math.max(0, frame.width - 3));
  const fillWidth = Math.max(0, frame.width - 3 - textWidth(fittedTitle));
  return (
    color("borderMuted", "┌─") +
    fittedTitle +
    color("borderMuted", `${"─".repeat(fillWidth)}┐`)
  );
}

function horizontalBorder(width: number, left: string, right: string): string {
  const safeWidth = composerFrame(width).width;
  if (safeWidth === 0) return "";
  if (safeWidth === 1) return color("borderMuted", "─");
  return color("borderMuted", left + "─".repeat(safeWidth - 2) + right);
}

export function buildComposerBodyLine(content: string, width: number): string {
  const frame = composerFrame(width);
  if (!frame.framed) return padToWidth(content, frame.width);
  return (
    color("borderMuted", "│ ") +
    padToWidth(content, frame.innerWidth) +
    color("borderMuted", " │")
  );
}

export function buildComposerHeader(width: number, direction: string): string[] {
  const frame = composerFrame(width);
  return [
    topBorder(frame.width, direction),
    buildComposerBodyLine(composerStatus(frame.innerWidth), frame.width),
    horizontalBorder(frame.width, "├", "┤"),
  ];
}

export function buildComposerFooter(width: number): string {
  return horizontalBorder(width, "└", "┘");
}

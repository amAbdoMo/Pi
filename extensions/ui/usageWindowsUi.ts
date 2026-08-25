// Shared presentation helpers for Codex usage/reset rendering.
// PUA nerd-font glyphs are built from codepoints so they survive any
// editor/encoding round-trip (literal glyphs get stripped by patches).
export const USAGE_RESET_ICON = String.fromCodePoint(0xf01e); // rotate-right

/**
 * Compact reset timestamp, ChatGPT-limits style but shorter:
 * "11:10pm" on the current day, "Sep 1, 5:44pm" otherwise
 * (year included when it differs). "" when unknown.
 */
export function formatUsageResetSuffix(
  resetsAtMs?: number,
  nowMs: number = Date.now(),
): string {
  if (resetsAtMs === undefined || !Number.isFinite(resetsAtMs)) return "";

  const resetDate = new Date(resetsAtMs);
  const nowDate = new Date(nowMs);
  const time = resetDate
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(" AM", "am")
    .replace(" PM", "pm");

  const sameDay =
    resetDate.getFullYear() === nowDate.getFullYear() &&
    resetDate.getMonth() === nowDate.getMonth() &&
    resetDate.getDate() === nowDate.getDate();
  if (sameDay) return time;

  const day = resetDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const year =
    resetDate.getFullYear() === nowDate.getFullYear()
      ? ""
      : `, ${resetDate.getFullYear()}`;
  return `${day}${year}, ${time}`;
}

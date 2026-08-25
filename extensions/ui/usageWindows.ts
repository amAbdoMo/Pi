const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_DURATION_TOLERANCE_SECONDS = 120;

// Epoch-second values above this threshold are treated as epoch milliseconds.
const EPOCH_MS_THRESHOLD = 1e11;

type UsageWindow = {
  usedPercent: number;
  windowSeconds: number;
  resetsAtMs?: number;
};

export type ChatGptUsage = {
  fiveHourUsedPercent?: number;
  weeklyUsedPercent?: number;
  fiveHourResetsAtMs?: number;
  weeklyResetsAtMs?: number;
};

function normalizeResetAtMs(
  windowRecord: Record<string, unknown>,
  nowMs: number,
): number | undefined {
  const resetAt = windowRecord.reset_at;
  if (typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > 0) {
    return resetAt > EPOCH_MS_THRESHOLD ? resetAt : resetAt * 1000;
  }

  const resetAfterSeconds = windowRecord.reset_after_seconds;
  if (
    typeof resetAfterSeconds === "number" &&
    Number.isFinite(resetAfterSeconds) &&
    resetAfterSeconds >= 0
  ) {
    return nowMs + resetAfterSeconds * 1000;
  }

  return undefined;
}

function normalizeUsageWindow(
  candidate: unknown,
  nowMs: number,
): UsageWindow | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const windowRecord = candidate as Record<string, unknown>;
  const usedPercent = windowRecord.used_percent;
  const windowSeconds = windowRecord.limit_window_seconds;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return undefined;
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return undefined;
  }
  const resetsAtMs = normalizeResetAtMs(windowRecord, nowMs);
  return resetsAtMs === undefined
    ? { usedPercent, windowSeconds }
    : { usedPercent, windowSeconds, resetsAtMs };
}

function rateLimitWindows(payload: unknown, nowMs: number): UsageWindow[] {
  if (!payload || typeof payload !== "object") return [];
  const rateLimit = (payload as Record<string, unknown>).rate_limit;
  if (!rateLimit || typeof rateLimit !== "object") return [];
  const rateLimitRecord = rateLimit as Record<string, unknown>;
  return [
    normalizeUsageWindow(rateLimitRecord.primary_window, nowMs),
    normalizeUsageWindow(rateLimitRecord.secondary_window, nowMs),
  ].filter((window): window is UsageWindow => window !== undefined);
}

function windowForDuration(
  windows: UsageWindow[],
  expectedSeconds: number,
): UsageWindow | undefined {
  return windows.find(
    (window) => Math.abs(window.windowSeconds - expectedSeconds) <= WINDOW_DURATION_TOLERANCE_SECONDS,
  );
}

/**
 * Formats a reset timestamp the way the ChatGPT "General usage limits"
 * screen does, but compact: "11:10pm" on the current day, otherwise
 * "Sep 1, 5:44pm" (year included when it differs). Callers prepend their
 * own icon/word (e.g. the nerd-font rotate arrow).
 */
export function formatUsageResetSuffix(resetsAtMs?: number, nowMs: number = Date.now()): string {
  if (resetsAtMs === undefined || !Number.isFinite(resetsAtMs)) return "";

  const resetDate = new Date(resetsAtMs);
  const nowDate = new Date(nowMs);
  // Compact meridiem ("5:44pm") keeps chips short and visually light.
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

export function extractChatGptUsage(payload: unknown, nowMs: number = Date.now()): ChatGptUsage {
  const windows = rateLimitWindows(payload, nowMs);
  const fiveHour = windowForDuration(windows, FIVE_HOUR_SECONDS);
  const weekly = windowForDuration(windows, WEEK_SECONDS);

  // The full key set is always returned so callers can rely on a stable shape.
  return {
    fiveHourUsedPercent: fiveHour?.usedPercent,
    fiveHourResetsAtMs: fiveHour?.resetsAtMs,
    weeklyUsedPercent: weekly?.usedPercent,
    weeklyResetsAtMs: weekly?.resetsAtMs,
  };
}

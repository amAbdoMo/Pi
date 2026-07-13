const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_DURATION_TOLERANCE_SECONDS = 120;

type UsageWindow = {
  usedPercent: number;
  windowSeconds: number;
};

export type ChatGptUsage = {
  fiveHourUsedPercent?: number;
  weeklyUsedPercent?: number;
};

function normalizeUsageWindow(candidate: unknown): UsageWindow | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const windowRecord = candidate as Record<string, unknown>;
  const usedPercent = windowRecord.used_percent;
  const windowSeconds = windowRecord.limit_window_seconds;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return undefined;
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return undefined;
  }
  return { usedPercent, windowSeconds };
}

function rateLimitWindows(payload: unknown): UsageWindow[] {
  if (!payload || typeof payload !== "object") return [];
  const rateLimit = (payload as Record<string, unknown>).rate_limit;
  if (!rateLimit || typeof rateLimit !== "object") return [];
  const rateLimitRecord = rateLimit as Record<string, unknown>;
  return [
    normalizeUsageWindow(rateLimitRecord.primary_window),
    normalizeUsageWindow(rateLimitRecord.secondary_window),
  ].filter((window): window is UsageWindow => window !== undefined);
}

function percentForDuration(windows: UsageWindow[], expectedSeconds: number): number | undefined {
  return windows.find(
    (window) => Math.abs(window.windowSeconds - expectedSeconds) <= WINDOW_DURATION_TOLERANCE_SECONDS,
  )?.usedPercent;
}

export function extractChatGptUsage(payload: unknown): ChatGptUsage {
  const windows = rateLimitWindows(payload);
  return {
    fiveHourUsedPercent: percentForDuration(windows, FIVE_HOUR_SECONDS),
    weeklyUsedPercent: percentForDuration(windows, WEEK_SECONDS),
  };
}

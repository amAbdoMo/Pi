function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeContextUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tokens = finiteNumber(value.tokens);
  const contextWindow = finiteNumber(value.contextWindow);
  const percent = finiteNumber(value.percent);
  if (tokens === null || contextWindow === null || percent === null) return null;
  return { tokens, contextWindow, percent: Math.min(percent, 100) };
}

export function normalizeSessionStats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    totalMessages: finiteNumber(value.totalMessages),
    cost: finiteNumber(value.cost),
    contextUsage: normalizeContextUsage(value.contextUsage),
  };
}

export function formatTokenCount(value) {
  const tokens = finiteNumber(value);
  if (tokens === null) return "—";
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}K`;
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}M`;
}

export function formatContextPercent(value) {
  const percent = finiteNumber(value);
  return percent === null ? "Context —" : `Context ${Math.min(100, Math.round(percent))}%`;
}

export function formatSessionCost(value) {
  const cost = finiteNumber(value);
  if (cost === null) return "—";
  return cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
}

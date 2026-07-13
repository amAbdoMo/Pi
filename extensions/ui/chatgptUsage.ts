import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { notifyEditors } from "./editorRegistry.ts";
import { color, ratioProgressBar } from "./formatting.ts";
import { isOpenAICodexProvider } from "./providers.ts";
import { state } from "./state.ts";
import { extractChatGptUsage, type ChatGptUsage } from "./usageWindows.ts";

const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const USAGE_REFRESH_THROTTLE_MS = 30 * 1000;

let usageRequestId = 0;
let usageLastRefreshStartedAt = 0;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function getChatGptAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const auth = payload[OPENAI_AUTH_CLAIM];
  if (!auth || typeof auth !== "object") return undefined;
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" ? accountId : undefined;
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function usageLimitColor(percent: number): string {
  if (percent >= 90) return "error";
  if (percent >= 80) return "warning";
  return "muted";
}

function usageLimitLabel(label: string, usedPercent: number): string {
  const clampedPercent = clampPercent(usedPercent);
  return [
    color("warning", `${label} `),
    color(usageLimitColor(clampedPercent), `${Math.round(clampedPercent)}%`),
    " ",
    ratioProgressBar(clampedPercent / 100),
  ].join("");
}

export function chatGptLimitLabels(): string[] {
  if (!isOpenAICodexProvider(state.provider)) return [];

  const labels: string[] = [];
  if (state.chatGptFiveHourUsedPercent !== undefined) {
    labels.push(usageLimitLabel("5h", state.chatGptFiveHourUsedPercent));
  }
  if (state.chatGptWeeklyUsedPercent !== undefined) {
    labels.push(usageLimitLabel("7d", state.chatGptWeeklyUsedPercent));
  }
  return labels;
}

function clearChatGptUsage(): void {
  state.chatGptFiveHourUsedPercent = undefined;
  state.chatGptWeeklyUsedPercent = undefined;
}

function setChatGptUsage(usage: ChatGptUsage): void {
  state.chatGptFiveHourUsedPercent = usage.fiveHourUsedPercent;
  state.chatGptWeeklyUsedPercent = usage.weeklyUsedPercent;
}

export async function refreshChatGptUsage(
  ctx: ExtensionContext,
  options: { force?: boolean } = {},
): Promise<void> {
  const provider = ctx.model?.provider;

  if (!isOpenAICodexProvider(provider)) {
    usageRequestId++;
    usageLastRefreshStartedAt = 0;
    clearChatGptUsage();
    state.chatGptUsageProvider = undefined;
    notifyEditors();
    return;
  }

  const providerChanged = state.chatGptUsageProvider !== provider;
  if (providerChanged) {
    clearChatGptUsage();
    state.chatGptUsageProvider = provider;
    notifyEditors();
  }

  const now = Date.now();
  if (
    !options.force &&
    !providerChanged &&
    now - usageLastRefreshStartedAt < USAGE_REFRESH_THROTTLE_MS
  ) {
    return;
  }

  if (!options.force) usageLastRefreshStartedAt = now;
  const requestId = ++usageRequestId;

  try {
    const auth = await (ctx.modelRegistry as any).getApiKeyAndHeaders(ctx.model);
    if (requestId !== usageRequestId) return;
    if (!auth?.ok || !auth.apiKey) {
      clearChatGptUsage();
      notifyEditors();
      return;
    }

    const accountId = getChatGptAccountId(auth.apiKey);
    const response = await fetch(CHATGPT_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        Accept: "application/json",
        "User-Agent": "pi-hypr-waves-ui",
        ...(accountId ? { "chatgpt-account-id": accountId } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (requestId !== usageRequestId) return;

    setChatGptUsage(response.ok ? extractChatGptUsage(await response.json()) : {});
  } catch {
    if (requestId !== usageRequestId) return;
    clearChatGptUsage();
  }

  notifyEditors();
}

export function resetChatGptUsage(): void {
  usageRequestId++;
  usageLastRefreshStartedAt = 0;
  clearChatGptUsage();
  state.chatGptUsageProvider = undefined;
}

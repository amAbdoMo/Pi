import * as path from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveAvailableChildProfile } from "../child-profile.ts";
import { buildInitialPrompt } from "../prompts.ts";
import { loadSettings } from "../settings.ts";
import { RpcProcess } from "../rpc-process.ts";
import {
  buildParentDelegateResult,
  generateHandoffSummary,
  makeCompletionPayload,
} from "../summaries.ts";
import type {
  CompletionPayload,
  DelegateDetails,
  DelegateRequest,
  LiveDelegateUpdater,
  SubagentRecord,
} from "../types.ts";
import {
  currentProcessAgentId,
  currentRootId,
  ensureDir,
  generatedLabel,
  getPiInvocation,
  makeId,
  now,
  oneLine,
} from "../utils.ts";
import { startBridgeWatcher } from "./ask-parent.ts";
import { boundDelegateDetails } from "./detail-bounds.ts";
import { boundedChildError } from "./errors.ts";
import {
  getOrCreateHandoffPromise,
  waitForHandoffSummary,
} from "./handoff-cache.ts";
import { buildChildLaunchArgs } from "./invocation.ts";
import { delegateLimitIssue } from "./limits.ts";
import {
  abortChild,
  handleRpcEvent,
  makeLiveUpdater,
  removeActiveWhenSettled,
  toDelegateDetails,
  usageFromStats,
} from "./records.ts";
import type { SubagentRuntimeState } from "./state.ts";
import { childToolsForSpawn } from "./tool-list.ts";
import { updateStatus } from "./status-ui.ts";

export async function launchChild(
  state: SubagentRuntimeState,
  record: SubagentRecord,
  initialPrompt: string,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  liveUpdate?: LiveDelegateUpdater,
): Promise<CompletionPayload> {
  const childSettings = state.settings;
  if (!record.sessionDir || !record.bridgeDir)
    throw new Error("child session directories were not initialized");
  ensureDir(record.sessionDir);
  ensureDir(path.join(record.bridgeDir, "requests"));
  ensureDir(path.join(record.bridgeDir, "answers"));

  const args = buildChildLaunchArgs({
    parentArgs: process.argv,
    label: record.generatedLabel,
    extensionPath: state.extensionPath,
    persistSessions: childSettings.persistSessions,
    sessionDir: record.sessionDir,
    profile: {
      model: record.model,
      thinking: record.thinkingLevel,
    },
  });

  const invocation = getPiInvocation(args);
  const env: Record<string, string | undefined> = {
    PI_SUBAGENT_ID: record.id,
    PI_SUBAGENT_LABEL: record.generatedLabel,
    PI_SUBAGENT_DEPTH: String(record.depth),
    PI_SUBAGENT_MAX_DEPTH: String(childSettings.maxDepth),
    PI_SUBAGENT_PARENT_ID: currentProcessAgentId(ctx),
    PI_SUBAGENT_ROOT_ID: record.rootId,
    PI_SUBAGENT_BRIDGE_DIR: record.bridgeDir,
    PI_SUBAGENT_ACTIVE_TOOLS: JSON.stringify(childToolsForSpawn(state)),
  };
  const client = new RpcProcess(invocation.command, invocation.args, {
    cwd: ctx.cwd,
    env,
  });
  record.client = client;
  record.status = "starting";
  startBridgeWatcher(state, record);
  const stopEventUpdates = client.onEvent((event) => {
    handleRpcEvent(state, record, event);
    liveUpdate?.notify();
  });
  let abortListener: (() => void) | undefined;
  try {
    if (signal) {
      abortListener = () => {
        void abortChild(state, record);
      };
      if (signal.aborted) abortListener();
      else signal.addEventListener("abort", abortListener, { once: true });
    }
    await client.start();
    record.pid = client.pid;
    const stateBefore = await client.getState().catch(() => undefined);
    if (stateBefore?.sessionFile) record.sessionFile = stateBefore.sessionFile;
    if (stateBefore?.model)
      record.model = `${stateBefore.model.provider}/${stateBefore.model.id}`;
    if (stateBefore?.thinkingLevel) record.thinkingLevel = stateBefore.thinkingLevel;
    await client.setSessionName(record.generatedLabel).catch(() => undefined);
    await client.prompt(initialPrompt);
    await waitForChildFinish(record, signal);
    const finalText = await client.getLastAssistantText().catch(() => null);
    record.finalOutput = finalText ?? record.finalOutput ?? "";
    const stateAfter = await client.getState().catch(() => undefined);
    if (stateAfter?.sessionFile) record.sessionFile = stateAfter.sessionFile;
    if (stateAfter?.model)
      record.model = `${stateAfter.model.provider}/${stateAfter.model.id}`;
    if (stateAfter?.thinkingLevel) record.thinkingLevel = stateAfter.thinkingLevel;
    const stats = await client.getSessionStats().catch(() => undefined);
    if (stats) record.usage = usageFromStats(stats);
    if (record.status !== "failed" && record.status !== "aborted")
      record.status = "completed";
    record.endedAt ??= now();
    liveUpdate?.notify(true);
    return await makeCompletionPayload(
      record,
      ctx,
      childSettings,
      signal,
      state.pi.getThinkingLevel?.(),
    );
  } catch (err) {
    if (record.status !== "aborted") record.status = "failed";
    record.error = boundedChildError(err);
    record.finalOutput = record.finalOutput || record.error;
    record.endedAt = now();
    liveUpdate?.notify(true);
    return await makeCompletionPayload(
      record,
      ctx,
      childSettings,
      signal,
      state.pi.getThinkingLevel?.(),
    );
  } finally {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    liveUpdate?.close();
    stopEventUpdates();
    clearInterval(record.bridgeTimer);
    await client.stop().catch(() => undefined);
    updateStatus(state);
  }
}

function waitForChildFinish(
  record: SubagentRecord,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Sub-agent aborted"));
      return;
    }
    const client = record.client;
    if (!client) {
      reject(new Error("Sub-agent client missing"));
      return;
    }
    const cleanup = client.onEvent((event) => {
      if (event.type === "agent_end") {
        cleanup();
        resolve();
      }
      if (event.type === "process_exit" || event.type === "process_error") {
        cleanup();
        reject(new Error(event.error || "Sub-agent process exited before completion"));
      }
    });
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(new Error("Sub-agent aborted"));
        },
        { once: true },
      );
    }
  });
}

function handoffCacheKey(
  state: SubagentRuntimeState,
  ctx: ExtensionContext,
): string {
  const branch = ctx.sessionManager.getBranch() as Array<{
    id?: string;
    timestamp?: number;
  }>;
  const latest = branch.at(-1);
  const summaryProfile = state.settings.profiles[state.settings.summaryProfile];
  return [
    currentRootId(ctx),
    branch.length,
    latest?.id ?? latest?.timestamp ?? "empty",
    state.settings.handoffTokenBudget,
    state.settings.handoffKeepRecentTokens,
    state.settings.summaryProfile,
    summaryProfile.model,
    summaryProfile.thinking,
  ].join(":");
}

async function cachedHandoffSummary(
  state: SubagentRuntimeState,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
): Promise<string> {
  const key = handoffCacheKey(state, ctx);
  const cached = getOrCreateHandoffPromise(state.handoffCache, key, () =>
    generateHandoffSummary(
      ctx,
      state.settings,
      undefined,
      state.pi.getThinkingLevel?.(),
    ),
  );
  state.handoffCache = cached.entry;
  void cached.summary.catch(() => {
    if (state.handoffCache?.key === key) state.handoffCache = undefined;
  });
  return waitForHandoffSummary(cached.summary, signal);
}

function isModelAvailable(ctx: ExtensionContext, modelReference: string): boolean {
  const separator = modelReference.indexOf("/");
  if (separator <= 0 || separator === modelReference.length - 1) return false;
  const provider = modelReference.slice(0, separator);
  const modelId = modelReference.slice(separator + 1);
  return ctx.modelRegistry
    .getAvailable()
    .some((model) => model.provider === provider && model.id === modelId);
}

export async function spawnDelegate(
  state: SubagentRuntimeState,
  params: DelegateRequest,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<DelegateDetails> | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<DelegateDetails>> {
  state.latestCtx = ctx;
  state.settings = loadSettings(ctx.cwd);
  if (process.env.PI_SUBAGENT_MAX_DEPTH) state.settings.maxDepth = state.envMaxDepth;
  const contextMode = params.context ?? state.settings.defaultContext;
  const limitIssue = delegateLimitIssue({
    allowChildSubagents: state.settings.allowChildSubagents,
    currentDepth: state.currentDepth,
    maxDepth: state.settings.maxDepth,
    activeCount: state.active.size,
    maxConcurrent: state.settings.maxConcurrent,
  });
  if (limitIssue) {
    return {
      content: [
        {
          type: "text",
          text: `Cannot delegate: ${limitIssue.message}.`,
        },
      ],
      details: boundDelegateDetails(
        {
          id: "",
          label: limitIssue.kind,
          status: "failed",
          contextMode,
          depth: state.currentDepth,
          maxDepth: state.settings.maxDepth,
          task: params.task,
          error: limitIssue.message,
          events: [],
        },
        state.settings.returnMaxBytes,
      ),
    };
  }

  const id = makeId();
  const label = oneLine(params.title?.trim() || generatedLabel(params.task), 48);
  const profile = resolveAvailableChildProfile(
    {
      profile: params.profile,
      model: params.model,
      thinking: params.thinking,
    },
    {
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      thinking: state.pi.getThinkingLevel?.(),
    },
    state.settings.profiles,
    (model) => isModelAvailable(ctx, model),
  );
  const rootId = currentRootId(ctx);
  const depth = state.currentDepth + 1;
  const sessionDir = path.join(state.settings.sessionDir, rootId, id);
  const bridgeDir = path.join(sessionDir, "bridge");
  const record: SubagentRecord = {
    id,
    generatedLabel: label,
    parentId: currentProcessAgentId(ctx),
    rootId,
    depth,
    status: "queued",
    task: params.task,
    contextMode,
    createdAt: now(),
    profile: params.profile,
    model: profile.model,
    thinkingLevel: profile.thinking,
    sessionDir,
    bridgeDir,
    nestedActiveCount: 0,
    events: [],
    handledBridgeRequestIds: new Set(),
  };
  state.active.set(id, record);
  updateStatus(state, ctx);

  let handoff: string | undefined;
  try {
    handoff =
      contextMode === "compact"
        ? await cachedHandoffSummary(state, ctx, signal)
        : undefined;
  } catch (error) {
    record.status = signal?.aborted ? "aborted" : "failed";
    record.error = boundedChildError(error);
    record.finalOutput = record.error;
    record.endedAt = now();
    removeActiveWhenSettled(state, record);
    const completion = await makeCompletionPayload(
      record,
      ctx,
      state.settings,
      signal,
      state.pi.getThinkingLevel?.(),
    );
    return buildParentDelegateResult(
      completion,
      toDelegateDetails(record, state.settings),
    );
  }
  const initialPrompt = buildInitialPrompt(
    params.task,
    contextMode,
    handoff,
    depth,
    state.settings.maxDepth,
  );
  const liveUpdate = makeLiveUpdater(state, record, onUpdate);
  record.completion = launchChild(state, record, initialPrompt, ctx, signal, liveUpdate);

  let completion: CompletionPayload;
  try {
    completion = await record.completion;
  } catch (error) {
    record.status = signal?.aborted ? "aborted" : "failed";
    record.error = boundedChildError(error);
    record.finalOutput = record.finalOutput || record.error;
    record.endedAt = now();
    clearInterval(record.bridgeTimer);
    if (record.client) await record.client.stop().catch(() => undefined);
    liveUpdate?.close();
    completion = await makeCompletionPayload(
      record,
      ctx,
      state.settings,
      signal,
      state.pi.getThinkingLevel?.(),
    );
  } finally {
    removeActiveWhenSettled(state, record);
  }
  return buildParentDelegateResult(
    completion,
    toDelegateDetails(record, state.settings),
  );
}

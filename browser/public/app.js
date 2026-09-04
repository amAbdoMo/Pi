import {
  MAX_ATTACHMENT_COUNT,
  MAX_IMAGE_ATTACHMENT_COUNT,
  SUPPORTED_IMAGE_TYPES,
} from "./attachment-contract.js";
import {
  assertAttachmentCapacity,
  attachmentLabelBytes,
  loadAttachments,
  runtimeModel,
} from "./attachment-client.js";
import {
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_TEXT_MIME_TYPES,
  formatPromptWithReferences,
  inlineReferencePrompt,
  textReferenceBytes,
  unpackReferenceQueue,
} from "./reference-contract.js";
import { parseMarkdown } from "./markdown.js";
import {
  COLLAPSED_WORKSPACE_SIZE,
  SESSION_BATCH_SIZE,
  matchingSessions,
  orderedSessions,
  readSessionView,
  visibleListSessions,
  workspaceGroups,
  writeSessionView,
} from "./session-view.js";
import {
  archiveSession,
  archivedSessions,
  readSessionPreferences,
  restoreSession,
  togglePinnedSession,
  visibleSessions as unarchivedSessions,
  writeSessionPreferences,
} from "./session-preferences.js";
import {
  applyStreamingDelta,
  conversationTimestampLabel,
  displayText,
  elapsedActivityLabel,
  formatRunDuration,
  localDayKey,
  messagePresentation,
  messageText,
  messageTextPart,
  messageTimestamp,
  parseSubagentNotice,
  resetStreamingState,
  restoredPrompt,
} from "./message-view.js";
import {
  clearQueueBeforeAbort,
  queueMessageCount,
  readQueueMode,
  restoredQueueText,
  takeClearedQueueRecords,
  writeQueueMode,
} from "./queue-client.js";
import {
  formatContextPercent,
  formatSessionCost,
  formatTokenCount,
  normalizeSessionStats,
} from "./context-view.js";
import {
  SAFE_IGNORED_EVENT_TYPES,
  boundedToolDetail,
  lifecycleActivity,
} from "./event-view.js";
import { FIRE_AND_FORGET_UI_METHODS } from "./extension-ui-contract.js";
import { toolActivityLabel } from "./integration-view.js";
import { readApprovalMode, writeApprovalMode } from "./approval-mode.js";

const elements = {
  app: document.querySelector("#app"),
  filter: document.querySelector("#session-filter"),
  sessionList: document.querySelector("#session-list"),
  sessionTooltip: document.querySelector("#session-tooltip"),
  sessionTooltipTitle: document.querySelector("#session-tooltip-title"),
  sessionTooltipWorkspace: document.querySelector("#session-tooltip-workspace"),
  iconTooltip: document.querySelector("#icon-tooltip"),
  newSession: document.querySelector("#new-session"),
  sessionTitle: document.querySelector("#session-title"),
  sessionActions: document.querySelector("#session-actions"),
  sessionMenu: document.querySelector("#session-menu"),
  renameSession: document.querySelector("#rename-session"),
  cloneSession: document.querySelector("#clone-session"),
  deleteSession: document.querySelector("#delete-session"),
  contextTrigger: document.querySelector("#context-trigger"),
  contextBrief: document.querySelector("#context-brief"),
  contextMenu: document.querySelector("#context-menu"),
  contextState: document.querySelector("#context-state"),
  contextUsed: document.querySelector("#context-used"),
  contextWindow: document.querySelector("#context-window"),
  contextMessages: document.querySelector("#context-messages"),
  contextCost: document.querySelector("#context-cost"),
  autoCompaction: document.querySelector("#auto-compaction"),
  compactNow: document.querySelector("#compact-now"),
  model: document.querySelector("#model-label"),
  thinking: document.querySelector("#thinking-label"),
  connection: document.querySelector("#connection-status span:last-child"),
  conversationScroll: document.querySelector(".conversation-scroll"),
  transcript: document.querySelector("#transcript"),
  conversationLoading: document.querySelector("#conversation-loading"),
  empty: document.querySelector("#empty-state"),
  agentWorkingStatus: document.querySelector("#agent-working-status"),
  agentWorkingClock: document.querySelector("#agent-working-clock"),
  activity: document.querySelector("#activity-list"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  permissionStatus: document.querySelector("#permission-status"),
  queueModeWrap: document.querySelector("#queue-mode-wrap"),
  queueMode: document.querySelector("#queue-mode"),
  queueCount: document.querySelector("#queue-count"),
  send: document.querySelector("#send-message"),
  abort: document.querySelector("#abort-run"),
  dialog: document.querySelector("#ui-dialog"),
  dialogForm: document.querySelector("#dialog-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogMessage: document.querySelector("#dialog-message"),
  dialogControl: document.querySelector("#dialog-control"),
  dialogActions: document.querySelector("#dialog-actions"),
  toasts: document.querySelector("#toast-region"),
  brandNewSession: document.querySelector("#brand-new-session"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  searchSessions: document.querySelector("#search-sessions"),
  searchWrap: document.querySelector("#session-search-wrap"),
  viewOptions: document.querySelector("#view-options"),
  viewMenu: document.querySelector("#view-menu"),
  addWorkspace: document.querySelector("#add-workspace"),
  workspacePicker: document.querySelector("#workspace-picker"),
  approvalMenu: document.querySelector("#approval-menu"),
  commandsTrigger: document.querySelector("#commands-trigger"),
  detailsClose: document.querySelector("#details-close"),
  detailsPanel: document.querySelector(".details-panel"),
  detailsBody: document.querySelector(".details-body"),
  profileTrigger: document.querySelector("#profile-trigger"),
  profileAvatar: document.querySelector("#profile-avatar"),
  profileName: document.querySelector("#profile-name"),
  profilePlan: document.querySelector("#profile-plan"),
  profileMenu: document.querySelector("#profile-menu"),
  profileIdentity: document.querySelector("#profile-identity"),
  profileMenuAvatar: document.querySelector("#profile-menu-avatar"),
  profileMenuName: document.querySelector("#profile-menu-name"),
  profileMenuPlan: document.querySelector("#profile-menu-plan"),
  accountsDialog: document.querySelector("#accounts-dialog"),
  accountsClose: document.querySelector("#accounts-close"),
  accountsActiveAvatar: document.querySelector("#accounts-active-avatar"),
  accountsTitle: document.querySelector("#accounts-title"),
  accountsActiveEmail: document.querySelector("#accounts-active-email"),
  accountsRefresh: document.querySelector("#accounts-refresh"),
  accountsAdd: document.querySelector("#accounts-add"),
  accountsList: document.querySelector("#accounts-list"),
  accountsStatus: document.querySelector("#accounts-status"),
  accountLoginProgress: document.querySelector("#account-login-progress"),
  accountLoginMessage: document.querySelector("#account-login-message"),
  accountLoginCancel: document.querySelector("#account-login-cancel"),
  settingsTrigger: document.querySelector("#settings-trigger"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsClose: document.querySelector("#settings-close"),
  settingsQueueMode: document.querySelector("#settings-queue-mode"),
  providerAdd: document.querySelector("#provider-add"),
  providerList: document.querySelector("#provider-list"),
  providerForm: document.querySelector("#provider-form"),
  providerFormTitle: document.querySelector("#provider-form-title"),
  providerFormClose: document.querySelector("#provider-form-close"),
  providerId: document.querySelector("#provider-id"),
  providerApi: document.querySelector("#provider-api"),
  providerApiLabel: document.querySelector("#provider-api-label"),
  providerApiOptions: document.querySelector("#provider-api-options"),
  providerBaseUrl: document.querySelector("#provider-base-url"),
  providerApiKey: document.querySelector("#provider-api-key"),
  providerKeyHint: document.querySelector("#provider-key-hint"),
  providerModelAdd: document.querySelector("#provider-model-add"),
  providerModelList: document.querySelector("#provider-model-list"),
  providerFormStatus: document.querySelector("#provider-form-status"),
  providerCancel: document.querySelector("#provider-cancel"),
  providerSave: document.querySelector("#provider-save"),
  extensionList: document.querySelector("#extension-list"),
  extensionsCount: document.querySelector("#extensions-count"),
  extensionsStatus: document.querySelector("#extensions-status"),
  extensionsApply: document.querySelector("#extensions-apply"),
  mcpAdd: document.querySelector("#mcp-add"),
  mcpList: document.querySelector("#mcp-list"),
  mcpDiagnostics: document.querySelector("#mcp-diagnostics"),
  mcpExtensionWarning: document.querySelector("#mcp-extension-warning"),
  mcpForm: document.querySelector("#mcp-form"),
  mcpFormTitle: document.querySelector("#mcp-form-title"),
  mcpFormDescription: document.querySelector("#mcp-form-description"),
  mcpFormClose: document.querySelector("#mcp-form-close"),
  mcpName: document.querySelector("#mcp-name"),
  mcpScopeField: document.querySelector("#mcp-scope-field"),
  mcpStdioFields: document.querySelector("#mcp-stdio-fields"),
  mcpHttpFields: document.querySelector("#mcp-http-fields"),
  mcpCommand: document.querySelector("#mcp-command"),
  mcpCwd: document.querySelector("#mcp-cwd"),
  mcpUrl: document.querySelector("#mcp-url"),
  mcpArguments: document.querySelector("#mcp-arguments"),
  mcpAddArgument: document.querySelector("#mcp-add-argument"),
  mcpValuesTitle: document.querySelector("#mcp-values-title"),
  mcpValues: document.querySelector("#mcp-values"),
  mcpAddValue: document.querySelector("#mcp-add-value"),
  mcpEnabled: document.querySelector("#mcp-enabled"),
  mcpFormStatus: document.querySelector("#mcp-form-status"),
  mcpCancel: document.querySelector("#mcp-cancel"),
  mcpSave: document.querySelector("#mcp-save"),
  archivedSessions: document.querySelector("#archived-sessions"),
  archiveDeleteAll: document.querySelector("#archive-delete-all"),
  modelTrigger: document.querySelector("#model-trigger"),
  modelDialog: document.querySelector("#model-dialog"),
  modelDialogClose: document.querySelector("#model-dialog-close"),
  modelDialogCurrent: document.querySelector("#model-dialog-current"),
  thinkingDialogCurrent: document.querySelector("#thinking-dialog-current"),
  thinkingSubmenu: document.querySelector("#thinking-submenu"),
  modelSearch: document.querySelector("#model-search"),
  modelOptions: document.querySelector("#model-options"),
  commandMenu: document.querySelector("#command-menu"),
  attachmentInput: document.querySelector("#attachment-input"),
  attachmentStrip: document.querySelector("#attachment-strip"),
  attachImage: document.querySelector("#attach-image"),
  extensionWidgetsAbove: document.querySelector("#extension-widgets-above"),
  extensionWidgetsBelow: document.querySelector("#extension-widgets-below"),
};

elements.attachmentInput.accept = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_TEXT_MIME_TYPES,
  ...SUPPORTED_TEXT_EXTENSIONS,
].join(",");

const state = {
  sessions: [],
  activeSessionId: null,
  confirmedSessionId: null,
  confirmedSessionTitle: "New Session",
  stream: null,
  streaming: false,
  workingStartedAt: null,
  workingTimer: null,
  liveMessage: null,
  liveParts: new Map(),
  toolActivities: new Map(),
  taskEditCards: new Map(),
  dialogQueue: [],
  dialogOpen: false,
  pendingDialogIds: new Set(),
  extensionStatuses: new Map(),
  extensionWidgets: new Map(),
  extensions: [],
  extensionBaseline: new Map(),
  extensionDraft: new Map(),
  extensionsLoaded: false,
  extensionsLoading: false,
  extensionsApplying: false,
  providers: [],
  providersLoaded: false,
  providersLoading: false,
  providersApplying: false,
  editingProviderId: null,
  accounts: [],
  accountsLoaded: false,
  accountsLoading: false,
  accountsApplying: false,
  accountLoginStatus: "idle",
  accountLoginObservedRunning: false,
  accountLoginPoll: null,
  accountCountdownTimer: null,
  accountsStatusMessage: null,
  mcpServers: [],
  mcpDiagnostics: [],
  mcpLoaded: false,
  mcpLoading: false,
  mcpApplying: false,
  mcpProjectAvailable: false,
  mcpExtensionEnabled: false,
  editingMcpServer: null,
  mcpTransport: "stdio",
  mcpScope: "project",
  mcpTestResults: new Map(),
  mcpTestGeneration: 0,
  mcpRemovedValues: [],
  currentModel: null,
  thinkingLevel: null,
  availableModels: [],
  thinkingLevels: [],
  modelDialogSelectionCount: 0,
  commands: [],
  attachments: [],
  attachmentContext: 0,
  loadingAttachments: false,
  workspacePicking: false,
  submitting: false,
  aborting: false,
  queueMode: readQueueMode(localStorage),
  approvalMode: readApprovalMode(localStorage),
  queueCount: 0,
  queuedMessages: [],
  pendingUserMessages: [],
  sessionView: readSessionView(localStorage),
  sessionPreferences: readSessionPreferences(localStorage),
  visibleSessionLimit: SESSION_BATCH_SIZE,
  expandedWorkspaces: new Set(),
  autoCompactionEnabled: true,
  contextStats: null,
  contextLoading: false,
  contextRequestId: 0,
  sessionOpenRequestId: 0,
  messageSyncRequestId: 0,
  lastMessageTimestamp: null,
  compactViewport: null,
  compacting: false,
};

function setConnection(mode, label) {
  elements.app.dataset.connection = mode;
  elements.connection.textContent = label;
}

function toastIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const circle = document.createElementNS(namespace, "circle");
  const mark = document.createElementNS(namespace, "path");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  circle.setAttribute("cx", "10");
  circle.setAttribute("cy", "10");
  circle.setAttribute("r", "7");
  mark.setAttribute("d", "M10 6.5v4.25M10 13.5h.01");
  svg.append(circle, mark);
  return svg;
}

const toastTimers = new WeakMap();

function scheduleToastRemoval(toast) {
  window.clearTimeout(toastTimers.get(toast));
  toastTimers.set(toast, window.setTimeout(() => {
    toastTimers.delete(toast);
    toast.remove();
  }, 5_000));
}

function matchingToast(message, tone) {
  return [...elements.toasts.children].find((toast) =>
    toast.dataset.tone === tone && toast.querySelector("span")?.textContent === message);
}

function showToast(message, tone = "info") {
  const existingToast = matchingToast(message, tone);
  if (existingToast) {
    scheduleToastRemoval(existingToast);
    return;
  }
  const toast = document.createElement("div");
  const text = document.createElement("span");
  toast.className = "toast";
  toast.dataset.tone = tone;
  text.textContent = message;
  toast.append(toastIcon(), text);
  elements.toasts.append(toast);
  scheduleToastRemoval(toast);
}

const accountResetDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

function activeAccount() {
  return state.accounts.find((account) => account.active) ?? null;
}

function accountLoginBusy() {
  return state.accountLoginStatus === "running" || state.accountLoginStatus === "cancelling";
}

function accountUiBusy() {
  return state.accountsApplying || accountLoginBusy();
}

function setAccountsStatus(message) {
  state.accountsStatusMessage = message;
  elements.accountsStatus.textContent = message ?? `${state.accounts.length} account${state.accounts.length === 1 ? "" : "s"}`;
}

function usageWindows(account) {
  return Array.isArray(account?.usage?.windows) ? account.usage.windows : [];
}

function renderAccountIdentity() {
  const account = activeAccount();
  const name = account?.name ?? "Add account";
  const plan = account?.plan ? `${account.plan} · Codex` : account ? "Codex" : "Not signed in";
  const initials = account?.initials ?? "AI";
  elements.profileAvatar.textContent = initials;
  elements.profileName.textContent = name;
  elements.profilePlan.textContent = plan;
  elements.profileMenuAvatar.textContent = initials;
  elements.profileMenuName.textContent = name;
  elements.profileMenuPlan.textContent = plan;
  elements.accountsActiveAvatar.textContent = initials;
  elements.accountsTitle.textContent = name;
  elements.accountsActiveEmail.textContent = account?.email ?? (account ? plan : "Sign in to use Codex subscription models");
}

function relativeResetTime(resetsAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(resetsAtMs)) return "Reset time unavailable";
  const remaining = resetsAtMs - nowMs;
  if (remaining <= 0) return "Resetting now";
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.ceil(hours / 24)}d`;
}

function accountUsageWindow(window) {
  const item = document.createElement("div");
  const heading = document.createElement("span");
  const label = document.createElement("span");
  const percent = document.createElement("strong");
  const bar = document.createElement("span");
  const fill = document.createElement("span");
  const reset = document.createElement("span");
  const used = Math.max(0, Math.min(100, Number(window.usedPercent) || 0));
  item.className = "usage-window";
  item.dataset.warning = String(used >= 80 && used < 90);
  item.dataset.error = String(used >= 90);
  heading.className = "usage-window-heading";
  label.textContent = window.label || "Limit";
  percent.textContent = `${Math.round(100 - used)}% left`;
  heading.append(label, percent);
  bar.className = "usage-bar";
  fill.style.width = `${used}%`;
  bar.append(fill);
  reset.className = "usage-reset";
  reset.dataset.resetAt = Number.isFinite(window.resetsAtMs) ? String(window.resetsAtMs) : "";
  reset.textContent = Number.isFinite(window.resetsAtMs)
    ? `${relativeResetTime(window.resetsAtMs)} · ${accountResetDateFormatter.format(new Date(window.resetsAtMs))}`
    : "Reset time unavailable";
  item.append(heading, bar, reset);
  return item;
}

function accountCredits(account) {
  const credits = account?.usage?.credits;
  const resetCredits = account?.usage?.resetCredits;
  if (!credits && !resetCredits) return null;
  const row = document.createElement("span");
  row.className = "account-credit-row";
  const parts = [];
  if (resetCredits) parts.push(`${resetCredits.applicableAvailableCount ?? 0} of ${resetCredits.availableCount ?? 0} banked resets available`);
  if (credits?.unlimited) parts.push("Unlimited credits");
  else if (credits?.balance !== undefined) parts.push(`Credit balance ${credits.balance}`);
  row.textContent = parts.join(" · ") || "Credits unavailable";
  return row;
}

function accountIconButton(label, paths, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `account-icon-action ${className}`.trim();
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.append(sessionActionIcon(paths));
  return button;
}

async function switchCodexAccount(account) {
  if (account.active || state.streaming || accountUiBusy()) return;
  state.accountsApplying = true;
  setAccountsStatus(`Switching to ${account.name}…`);
  renderAccounts();
  try {
    const result = await api("/api/accounts/activate", { method: "POST", body: { accountId: account.id } });
    setAccountSnapshot(result.accounts);
    if (result.state) {
      state.activeSessionId = result.state.browserSessionId ?? state.activeSessionId;
      updateRuntime(result.state);
      if (state.activeSessionId) connectEvents();
    } else await refreshState();
    showToast(`Switched to ${account.name}.`);
  } catch (error) {
    showToast(error.message, "error");
    await loadAccounts({ force: true });
  } finally {
    state.accountsApplying = false;
    setAccountsStatus(null);
    renderAccounts();
  }
}

async function renameCodexAccount(account) {
  const label = await localTextDialog({
    title: "Rename account",
    message: "Set a local name for this Codex account. Clear it to use the OpenAI profile name.",
    value: account.name,
    confirmLabel: "Rename",
  });
  if (label === null || accountUiBusy()) return;
  state.accountsApplying = true;
  setAccountsStatus(`Renaming ${account.name}…`);
  renderAccounts();
  try {
    const result = await api("/api/accounts/rename", { method: "POST", body: { accountId: account.id, label } });
    setAccountSnapshot(result.accounts);
  } catch (error) { showToast(error.message, "error"); }
  finally { state.accountsApplying = false; setAccountsStatus(null); renderAccounts(); }
}

async function removeCodexAccount(account) {
  const confirmed = await localConfirmDialog({
    title: `Remove ${account.name}?`,
    message: "This removes the saved Codex sign-in from Pi Harness. You can add it again through OpenAI OAuth.",
    confirmLabel: "Remove",
  });
  if (!confirmed || accountUiBusy()) return;
  state.accountsApplying = true;
  setAccountsStatus(`Removing ${account.name}…`);
  renderAccounts();
  try {
    const result = await api("/api/accounts/remove", { method: "POST", body: { accountId: account.id } });
    setAccountSnapshot(result.accounts);
    if (result.state) {
      state.activeSessionId = result.state.browserSessionId ?? state.activeSessionId;
      updateRuntime(result.state);
      if (state.activeSessionId) connectEvents();
    }
    showToast(`${account.name} removed.`);
  } catch (error) { showToast(error.message, "error"); }
  finally { state.accountsApplying = false; setAccountsStatus(null); renderAccounts(); }
}

function accountCard(account) {
  const card = document.createElement("article");
  card.className = "account-card";
  card.dataset.active = String(account.active);
  const identity = document.createElement("div");
  identity.className = "account-card-identity";
  const avatar = document.createElement("span");
  avatar.className = "account-avatar";
  avatar.textContent = account.initials ?? "AI";
  avatar.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "account-card-copy";
  const name = document.createElement("strong");
  name.textContent = account.name;
  const detail = document.createElement("small");
  detail.textContent = [account.email, account.plan].filter(Boolean).join(" · ") || "OpenAI Codex";
  copy.append(name, detail);
  if (account.active) {
    const badge = document.createElement("span");
    badge.className = "account-active-badge";
    badge.textContent = "Active";
    copy.append(badge);
  }
  identity.append(avatar, copy);
  const usage = document.createElement("div");
  usage.className = "account-usage";
  const windows = usageWindows(account);
  if (windows.length > 0) usage.append(...windows.map(accountUsageWindow));
  else {
    const unavailable = document.createElement("span");
    unavailable.className = "account-credit-row";
    unavailable.textContent = account.usageError ?? "Refresh to load usage limits";
    usage.append(unavailable);
  }
  const credits = accountCredits(account);
  if (credits) usage.append(credits);
  const actions = document.createElement("div");
  actions.className = "account-actions";
  const switchButton = document.createElement("button");
  switchButton.type = "button";
  switchButton.className = "account-switch";
  switchButton.textContent = account.active ? "Active" : "Switch";
  switchButton.setAttribute("aria-label", account.active ? `${account.name} is active` : `Switch to ${account.name}`);
  switchButton.disabled = account.active || state.streaming || accountUiBusy();
  switchButton.addEventListener("click", () => { void switchCodexAccount(account); });
  const rename = accountIconButton(`Rename ${account.name}`, ["M4 16h3l9-9a2.12 2.12 0 0 0-3-3l-9 9v3Z", "m12 5 3 3"]);
  rename.dataset.tooltip = "Rename";
  rename.disabled = accountUiBusy();
  rename.addEventListener("click", () => { void renameCodexAccount(account); });
  const remove = accountIconButton(`Remove ${account.name}`, ["M3.5 5.5h13M8 3.5h4l.75 2H7.25zM5.5 5.5l.75 10h7.5l.75-10M8.25 8.5v4.5M11.75 8.5v4.5"], "danger");
  remove.dataset.tooltip = "Remove";
  remove.disabled = state.streaming || accountUiBusy();
  remove.addEventListener("click", () => { void removeCodexAccount(account); });
  const secondaryActions = document.createElement("div");
  secondaryActions.className = "account-secondary-actions";
  secondaryActions.append(rename, remove);
  actions.append(switchButton, secondaryActions);
  card.append(identity, usage, actions);
  return card;
}

function updateAccountCountdowns() {
  document.querySelectorAll(".usage-reset[data-reset-at]").forEach((element) => {
    const resetsAtMs = Number(element.dataset.resetAt);
    if (Number.isFinite(resetsAtMs)) element.textContent = `${relativeResetTime(resetsAtMs)} · ${accountResetDateFormatter.format(new Date(resetsAtMs))}`;
  });
}

function renderAccounts() {
  renderAccountIdentity();
  elements.accountsList.setAttribute("aria-busy", String(state.accountsLoading));
  elements.accountsRefresh.disabled = accountUiBusy() || state.accountsLoading || state.accounts.length === 0;
  elements.accountsAdd.disabled = accountUiBusy() || state.streaming;
  if (state.accounts.length > 0) elements.accountsList.replaceChildren(...state.accounts.map(accountCard));
  else {
    const empty = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    empty.className = "accounts-empty";
    title.textContent = "No accounts yet";
    detail.textContent = "Add an OpenAI ChatGPT Plus or Pro account to use subscription models and track limits.";
    empty.append(title, detail);
    elements.accountsList.replaceChildren(empty);
  }
  if (!state.accountsLoading && !accountUiBusy()) setAccountsStatus(state.accountsStatusMessage);
  elements.send.disabled = state.submitting || elements.input.disabled || accountUiBusy();
  refreshAttachmentAvailability();
  updateAccountCountdowns();
}

function setAccountSnapshot(accounts) {
  state.accounts = Array.isArray(accounts) ? accounts : [];
  state.accountsLoaded = true;
  renderAccounts();
}

async function loadAccounts({ force = false } = {}) {
  if (state.accountsLoading || (state.accountsLoaded && !force)) return;
  state.accountsLoading = true;
  renderAccounts();
  try { setAccountSnapshot((await api("/api/accounts")).accounts); }
  catch (error) { showToast(error.message, "error"); }
  finally { state.accountsLoading = false; renderAccounts(); }
}

async function refreshAccountUsage(accountId) {
  if (accountUiBusy() || state.accounts.length === 0) return;
  state.accountsApplying = true;
  setAccountsStatus("Refreshing usage…");
  renderAccounts();
  try {
    const result = await api("/api/accounts/usage", { method: "POST", body: accountId ? { accountId } : {} });
    setAccountsStatus("Usage updated just now");
    setAccountSnapshot(result.accounts);
  } catch (error) {
    setAccountsStatus(null);
    showToast(error.message, "error");
  }
  finally { state.accountsApplying = false; renderAccounts(); }
}

function clearAccountLoginPoll() {
  if (state.accountLoginPoll) clearTimeout(state.accountLoginPoll);
  state.accountLoginPoll = null;
}

function renderAccountLogin(status = {}) {
  state.accountLoginStatus = status.status ?? "idle";
  const running = accountLoginBusy();
  if (running) state.accountLoginObservedRunning = true;
  elements.accountLoginProgress.hidden = !running;
  elements.accountLoginCancel.disabled = state.accountLoginStatus === "cancelling";
  const event = status.event;
  elements.accountLoginMessage.textContent = event?.type === "device_code"
    ? `Code ${event.userCode} · ${event.verificationUri}`
    : event?.message ?? (state.accountLoginStatus === "cancelling" ? "Cancelling sign-in…" : "Waiting for OpenAI…");
  if (status.accounts) setAccountSnapshot(status.accounts);
  renderAccounts();
}

function finishAccountLogin(status) {
  if (accountLoginBusy() || !state.accountLoginObservedRunning) return;
  state.accountLoginObservedRunning = false;
  if (status.status === "success") {
    void refreshState()
      .then(() => { if (state.activeSessionId) connectEvents(); })
      .catch((error) => showToast(error.message, "error"));
    showToast("Account added.");
  } else if (status.status === "error") showToast(status.error ?? "Codex sign-in failed", "error");
}

async function pollAccountLogin() {
  clearAccountLoginPoll();
  try {
    const status = await api("/api/accounts/login");
    renderAccountLogin(status);
    if (accountLoginBusy()) state.accountLoginPoll = setTimeout(() => { void pollAccountLogin(); }, 700);
    else finishAccountLogin(status);
  } catch (error) {
    if (accountLoginBusy()) {
      elements.accountLoginMessage.textContent = "Connection interrupted; retrying…";
      state.accountLoginPoll = setTimeout(() => { void pollAccountLogin(); }, 1_500);
    } else showToast(error.message, "error");
  }
}

async function startAccountLogin() {
  if (state.streaming || accountUiBusy()) return;
  renderAccountLogin({ status: "running", event: { message: "Opening secure Codex sign-in…" } });
  try {
    renderAccountLogin(await api("/api/accounts/login", { method: "POST", body: {} }));
    void pollAccountLogin();
  } catch (error) {
    renderAccountLogin({ status: "error", error: error.message });
    state.accountLoginObservedRunning = false;
    showToast(error.message, "error");
  }
}

async function cancelAccountLogin() {
  if (state.accountLoginStatus !== "running") return;
  renderAccountLogin({ status: "cancelling" });
  try { await api("/api/accounts/login/cancel", { method: "POST", body: {} }); }
  catch (error) { showToast(error.message, "error"); }
  void pollAccountLogin();
}

let conversationScrollFrame = 0;

function scrollConversationToEnd() {
  const scroller = elements.conversationScroll;
  scroller.scrollTop = scroller.scrollHeight;
  if (conversationScrollFrame) cancelAnimationFrame(conversationScrollFrame);
  conversationScrollFrame = requestAnimationFrame(() => {
    scroller.scrollTop = scroller.scrollHeight;
    conversationScrollFrame = 0;
  });
}

function modelAcceptsImages(model = state.currentModel) {
  return Array.isArray(model?.input) && model.input.includes("image");
}

function refreshAttachmentAvailability() {
  elements.attachImage.disabled = elements.input.disabled || state.submitting || state.loadingAttachments;
  const imageNote = modelAcceptsImages() ? `up to ${MAX_IMAGE_ATTACHMENT_COUNT} images` : "text files only for this model";
  elements.attachImage.setAttribute("aria-label", `Attach up to ${MAX_ATTACHMENT_COUNT} files (${imageNote})`);
}

function removeAttachment(index) {
  state.attachments.splice(index, 1);
  renderAttachments();
}

function attachmentPreview(attachment) {
  if (attachment.kind === "image") {
    const image = document.createElement("img");
    image.src = attachment.previewUrl;
    image.alt = "";
    return image;
  }
  const fileType = document.createElement("span");
  fileType.className = "attachment-file-preview";
  fileType.textContent = attachment.name.split(".").at(-1).slice(0, 4).toUpperCase() || "TXT";
  fileType.setAttribute("aria-hidden", "true");
  return fileType;
}

function attachmentChip(attachment, index) {
  const chip = document.createElement("div");
  chip.className = "attachment-chip";
  const preview = attachmentPreview(attachment);
  const copy = document.createElement("span");
  copy.className = "attachment-copy";
  const name = document.createElement("strong");
  name.textContent = attachment.name;
  const size = document.createElement("small");
  size.textContent = attachmentLabelBytes(attachment.size);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "attachment-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  remove.dataset.tooltip = "Remove";
  remove.addEventListener("click", () => removeAttachment(index));
  copy.append(name, size);
  chip.append(preview, copy, remove);
  return chip;
}

function renderAttachments() {
  elements.attachmentStrip.replaceChildren(...state.attachments.map(attachmentChip));
  elements.attachmentStrip.hidden = state.attachments.length === 0;
  scrollConversationToEnd();
}

function clearAttachments() {
  state.attachmentContext += 1;
  state.attachments = [];
  renderAttachments();
}

async function addAttachmentFiles(fileList) {
  const files = [...fileList];
  if (state.loadingAttachments) throw new TypeError("Wait for the current attachments to finish loading");
  if (state.attachments.length + files.length > MAX_ATTACHMENT_COUNT) {
    throw new TypeError(`Attach up to ${MAX_ATTACHMENT_COUNT} files`);
  }
  const context = state.attachmentContext;
  state.loadingAttachments = true;
  refreshAttachmentAvailability();
  try {
    const additions = await loadAttachments(files, state.attachments,
      () => context === state.attachmentContext, { allowImages: modelAcceptsImages() });
    state.attachments.push(...additions);
    renderAttachments();
  } finally {
    state.loadingAttachments = false;
    refreshAttachmentAvailability();
  }
}

function attachmentPayloads() {
  const images = state.attachments.filter((attachment) => attachment.kind === "image").map((attachment) => attachment.image);
  const references = state.attachments.filter((attachment) => attachment.kind === "text").map((attachment) => attachment.reference);
  return {
    ...(images.length ? { images } : {}),
    ...(references.length ? { references } : {}),
  };
}

function pendingUserContent(message) {
  const content = message ? [{ type: "text", text: message }] : [];
  for (const attachment of state.attachments) {
    content.push(attachment.kind === "image"
      ? { type: "image" }
      : { type: "text", text: `[Text reference: ${attachment.name}]` });
  }
  return content;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseType = response.headers.get("content-type") ?? "";
  const payload = responseType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.error ?? `Request failed (${response.status})`);
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

let describedSessionButton;
let describedIconButton;

function sessionDisplayName(session) {
  return session.name || "Untitled session";
}

function hideSessionTooltip() {
  describedSessionButton?.removeAttribute("aria-describedby");
  describedSessionButton = undefined;
  elements.sessionTooltip.hidden = true;
}

function showSessionTooltip(session, anchor) {
  if (describedIconButton) return;
  hideSessionTooltip();
  describedSessionButton = anchor.querySelector(".session-entry");
  describedSessionButton.setAttribute("aria-describedby", "session-tooltip");
  elements.sessionTooltipTitle.textContent = sessionDisplayName(session);
  elements.sessionTooltipWorkspace.textContent = `Workspace · ${session.cwd || "Ungrouped"}`;
  elements.sessionTooltip.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = elements.sessionTooltip.getBoundingClientRect();
  const right = anchorRect.right + 8;
  const left = anchorRect.left - tooltipRect.width - 8;
  const preferredLeft = right + tooltipRect.width <= innerWidth - 8 ? right : left;
  elements.sessionTooltip.style.left = `${Math.max(8, Math.min(preferredLeft, innerWidth - tooltipRect.width - 8))}px`;
  elements.sessionTooltip.style.top = `${Math.max(8, Math.min(anchorRect.top, innerHeight - tooltipRect.height - 8))}px`;
}

function hideIconTooltip() {
  describedIconButton?.removeAttribute("aria-describedby");
  describedIconButton = undefined;
  elements.iconTooltip.hidden = true;
}

function positionIconTooltip(anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = elements.iconTooltip.getBoundingClientRect();
  const centeredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
  const below = anchorRect.bottom + 7;
  const preferredTop = below + tooltipRect.height <= innerHeight - 8
    ? below
    : anchorRect.top - tooltipRect.height - 7;
  elements.iconTooltip.style.left = `${Math.max(8, Math.min(centeredLeft, innerWidth - tooltipRect.width - 8))}px`;
  elements.iconTooltip.style.top = `${Math.max(8, preferredTop)}px`;
}

function showIconTooltip(anchor) {
  hideIconTooltip();
  hideSessionTooltip();
  describedIconButton = anchor;
  anchor.setAttribute("aria-describedby", "icon-tooltip");
  (anchor.closest("dialog[open]") ?? document.body).append(elements.iconTooltip);
  elements.iconTooltip.textContent = anchor.dataset.tooltip;
  elements.iconTooltip.hidden = false;
  positionIconTooltip(anchor);
}

function sessionActionIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

function updateSessionPreferences(preferences, message, restoreFocus) {
  try {
    writeSessionPreferences(localStorage, preferences);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    showToast("Session sidebar preferences could not be saved.", "error");
    return;
  }
  state.sessionPreferences = preferences;
  hideSessionTooltip();
  renderSessions();
  renderArchivedSessions();
  showToast(message);
  restoreFocus?.();
}

function sessionActionButton({ label, tooltip, paths, pressed, action }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-row-action";
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = tooltip;
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
  button.append(sessionActionIcon(paths));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  return button;
}

function sessionControlFocus(sessionId, selector) {
  return () => (elements.sessionList.querySelector(`[data-session-id="${sessionId}"] ${selector}`)
    ?? elements.sessionList.querySelector(".session-entry")
    ?? elements.profileTrigger).focus();
}

function focusAfterSessionRemoval(row) {
  const neighbor = [row.nextElementSibling, row.previousElementSibling]
    .find((candidate) => candidate?.classList.contains("session-row"));
  return () => {
    const nearby = neighbor?.dataset.sessionId
      ? elements.sessionList.querySelector(`[data-session-id="${neighbor.dataset.sessionId}"] .session-entry`)
      : null;
    (nearby ?? elements.sessionList.querySelector(".session-entry") ?? elements.profileTrigger).focus();
  };
}

const SESSION_PIN_ICON_PATHS = Object.freeze([
  "M7 3.5h6l-.75 5 2 2V12h-9v-1.5l2-2z",
  "M10 12v5",
]);
const SESSION_ARCHIVE_ICON_PATHS = Object.freeze([
  "M2.75 3.5h14.5V7H2.75z",
  "M3.5 7h13v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15z",
  "M8 10h4",
]);
const SESSION_RESTORE_ICON_PATHS = Object.freeze([
  "M5.5 7H2.75V4.25",
  "M3 7a7 7 0 1 1-.2 5.6",
]);
const SESSION_DELETE_ICON_PATHS = Object.freeze([
  "M3.5 5.5h13",
  "M8 3.5h4l.75 2H7.25z",
  "M5.5 5.5l.75 10h7.5l.75-10",
  "M8.25 8.5v4.5M11.75 8.5v4.5",
]);

function sessionPinnedMark() {
  const icon = sessionActionIcon(SESSION_PIN_ICON_PATHS);
  icon.classList.add("session-pinned-mark");
  return icon;
}

const SESSION_WORKING_CELLS = Object.freeze([
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
]);

function sessionWorkingCell(namespace, [x, y], index) {
  const cell = document.createElementNS(namespace, "rect");
  cell.classList.add("session-working-cell");
  cell.setAttribute("x", String(x));
  cell.setAttribute("y", String(y));
  cell.setAttribute("width", "2");
  cell.setAttribute("height", "2");
  cell.style.animationDelay = `${(index - SESSION_WORKING_CELLS.length) * 125}ms`;
  return cell;
}

function sessionWorkingIndicator() {
  const namespace = "http://www.w3.org/2000/svg";
  const indicator = document.createElementNS(namespace, "svg");
  indicator.classList.add("session-working-indicator");
  indicator.setAttribute("width", "10");
  indicator.setAttribute("height", "10");
  indicator.setAttribute("viewBox", "0 0 10 10");
  indicator.setAttribute("shape-rendering", "crispEdges");
  indicator.setAttribute("aria-hidden", "true");
  indicator.append(...SESSION_WORKING_CELLS.map((cell, index) => sessionWorkingCell(namespace, cell, index)));
  return indicator;
}

function sessionOpenButton(session) {
  const button = document.createElement("button");
  const nameText = sessionDisplayName(session);
  const working = session.id === state.activeSessionId && state.streaming;
  button.type = "button";
  button.className = "session-entry";
  button.setAttribute("aria-current", String(session.id === state.activeSessionId));
  if (working) button.setAttribute("aria-label", `${nameText}, working`);
  const name = document.createElement("span");
  name.className = "session-name";
  name.textContent = nameText;
  if (working) button.append(sessionWorkingIndicator());
  if (state.sessionPreferences.pinned.includes(session.id)) button.append(sessionPinnedMark());
  button.append(name);
  button.addEventListener("click", () => { void openSession({ sessionId: session.id }); });
  return button;
}

function pinSessionButton(session) {
  const pinned = state.sessionPreferences.pinned.includes(session.id);
  const verb = pinned ? "Unpin" : "Pin";
  return sessionActionButton({
    label: `${verb} ${sessionDisplayName(session)}`,
    tooltip: verb,
    paths: SESSION_PIN_ICON_PATHS,
    pressed: pinned,
    action: () => updateSessionPreferences(
      togglePinnedSession(state.sessionPreferences, session.id),
      pinned ? "Session unpinned." : "Session pinned.",
      sessionControlFocus(session.id, ".session-row-action[aria-pressed]"),
    ),
  });
}

function archiveSessionButton(session, row) {
  return sessionActionButton({
    label: `Archive ${sessionDisplayName(session)}`,
    tooltip: "Archive",
    paths: SESSION_ARCHIVE_ICON_PATHS,
    action: () => updateSessionPreferences(
      archiveSession(state.sessionPreferences, session.id),
      "Session archived locally.",
      focusAfterSessionRemoval(row),
    ),
  });
}

function bindSessionTooltip(row, session) {
  row.addEventListener("pointerenter", () => showSessionTooltip(session, row));
  row.addEventListener("pointerleave", hideSessionTooltip);
  row.addEventListener("focusin", () => showSessionTooltip(session, row));
  row.addEventListener("focusout", (event) => {
    if (!row.contains(event.relatedTarget)) hideSessionTooltip();
  });
}

function sessionEntry(session) {
  const row = document.createElement("div");
  row.className = "session-row";
  row.dataset.sessionId = session.id;
  const actions = document.createElement("div");
  actions.className = "session-row-actions";
  actions.append(pinSessionButton(session), archiveSessionButton(session, row));
  row.append(sessionOpenButton(session), actions);
  bindSessionTooltip(row, session);
  return row;
}

function sessionMoreButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "session-more";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function toggleWorkspaceGroup(key) {
  if (state.expandedWorkspaces.has(key)) state.expandedWorkspaces.delete(key);
  else state.expandedWorkspaces.add(key);
  renderSessions();
}

function workspaceGroupHeader(group, expanded) {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "workspace-group-header";
  header.setAttribute("aria-expanded", String(expanded));
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.classList.add("workspace-group-chevron");
  chevron.setAttribute("viewBox", "0 0 20 20");
  chevron.setAttribute("aria-hidden", "true");
  const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  chevronPath.setAttribute("d", expanded ? "m6.5 8 3.5 3.5L13.5 8" : "m8 6.5 3.5 3.5L8 13.5");
  chevron.append(chevronPath);
  const label = document.createElement("strong");
  label.textContent = group.label;
  const count = document.createElement("small");
  count.textContent = String(group.sessions.length);
  header.append(chevron, label, count);
  header.addEventListener("click", () => toggleWorkspaceGroup(group.key));
  return header;
}

function workspaceGroupNode(group) {
  const expanded = state.expandedWorkspaces.has(group.key);
  const visible = expanded ? group.sessions : group.sessions.slice(0, COLLAPSED_WORKSPACE_SIZE);
  const section = document.createElement("section");
  section.className = "workspace-group";
  section.append(workspaceGroupHeader(group, expanded), ...visible.map(sessionEntry));
  if (group.sessions.length > COLLAPSED_WORKSPACE_SIZE) {
    const hiddenCount = group.sessions.length - COLLAPSED_WORKSPACE_SIZE;
    const label = expanded ? "Show fewer" : `Show ${hiddenCount} more sessions`;
    section.append(sessionMoreButton(label, () => toggleWorkspaceGroup(group.key)));
  }
  return section;
}

function sidebarSessions() {
  return unarchivedSessions(state.sessions, state.sessionPreferences);
}

function sessionPartitions(sessions) {
  const pinnedIds = new Set(state.sessionPreferences.pinned);
  return {
    pinned: sessions.filter((session) => pinnedIds.has(session.id)),
    regular: sessions.filter((session) => !pinnedIds.has(session.id)),
  };
}

function pinnedSessionSection(sessions) {
  const section = document.createElement("section");
  section.className = "pinned-sessions";
  section.setAttribute("aria-labelledby", "pinned-sessions-title");
  const title = document.createElement("h3");
  title.id = "pinned-sessions-title";
  title.className = "pinned-sessions-title";
  title.textContent = "Pinned";
  section.append(title, ...sessions.map(sessionEntry));
  return section;
}

function recentSessionSection(sessions) {
  const section = document.createElement("section");
  section.className = "recent-sessions";
  section.setAttribute("aria-labelledby", "recent-sessions-title");
  const title = document.createElement("h3");
  title.id = "recent-sessions-title";
  title.className = "recent-sessions-title";
  title.textContent = "Recents";
  section.append(title, ...sessions.map(sessionEntry));
  return section;
}

function recentSessionsTitle() {
  const title = document.createElement("h3");
  title.className = "recent-sessions-title";
  title.textContent = "Recents";
  return title;
}

function sessionNodes({ pinned, regular }) {
  if (pinned.length === 0) return regular.map(sessionEntry);
  return [
    pinnedSessionSection(pinned),
    ...(regular.length > 0 ? [recentSessionSection(regular)] : []),
  ];
}

function renderSessionSearch(query) {
  const matches = orderedSessions(matchingSessions(sidebarSessions(), query), state.sessionView.orderBy);
  elements.sessionList.replaceChildren(...sessionNodes(sessionPartitions(matches)));
  return matches.length;
}

function renderSessionList() {
  const ordered = orderedSessions(sidebarSessions(), state.sessionView.orderBy);
  const { pinned, regular } = sessionPartitions(ordered);
  const visible = visibleListSessions(regular, "", state.visibleSessionLimit);
  const nodes = sessionNodes({ pinned, regular: visible });
  if (visible.length < regular.length) {
    nodes.push(sessionMoreButton(`Show ${Math.min(SESSION_BATCH_SIZE, regular.length - visible.length)} more sessions`, () => {
      state.visibleSessionLimit += SESSION_BATCH_SIZE;
      renderSessions();
    }));
  }
  elements.sessionList.replaceChildren(...nodes);
  return pinned.length + visible.length;
}

function renderWorkspaceSessions() {
  const sessions = sidebarSessions();
  const ordered = orderedSessions(sessions, state.sessionView.orderBy);
  const { pinned, regular } = sessionPartitions(ordered);
  const regularIds = new Set(regular.map((session) => session.id));
  const groups = workspaceGroups(sessions, state.sessionView.orderBy)
    .map((group) => ({ ...group, sessions: group.sessions.filter((session) => regularIds.has(session.id)) }))
    .filter((group) => group.sessions.length > 0);
  const pinnedNodes = pinned.length > 0 ? [pinnedSessionSection(pinned)] : [];
  const recentTitle = pinned.length > 0 && groups.length > 0 ? [recentSessionsTitle()] : [];
  elements.sessionList.replaceChildren(...pinnedNodes, ...recentTitle, ...groups.map(workspaceGroupNode));
  return pinned.length + groups.length;
}

function renderSessions() {
  const query = elements.filter.value.trim();
  let visibleCount;
  if (query) visibleCount = renderSessionSearch(query);
  else if (state.sessionView.groupBy === "workspace") visibleCount = renderWorkspaceSessions();
  else visibleCount = renderSessionList();
  if (visibleCount > 0) return;
  const note = document.createElement("p");
  note.className = "session-preview";
  note.textContent = query ? "No matching sessions" : "No visible sessions";
  elements.sessionList.append(note);
}

const archiveDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function archivedSessionCopy(session) {
  const copy = document.createElement("span");
  copy.className = "archive-copy";
  const title = document.createElement("strong");
  title.textContent = sessionDisplayName(session);
  const updated = document.createElement("time");
  updated.dateTime = session.updatedAt;
  updated.textContent = archiveDateFormatter.format(new Date(session.updatedAt));
  copy.append(title, updated);
  return copy;
}

function archiveActionFocus() {
  return () => {
    const action = elements.archivedSessions.querySelector(".archive-action");
    const fallback = elements.archiveDeleteAll.hidden
      ? document.querySelector("#settings-tab-archive")
      : elements.archiveDeleteAll;
    (action ?? fallback).focus();
  };
}

function archiveActionButton(label, tooltip, paths, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `archive-action ${className}`;
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = tooltip;
  button.append(sessionActionIcon(paths));
  button.addEventListener("click", action);
  return button;
}

async function deleteArchivedSession(session) {
  const confirmed = await localConfirmDialog({
    title: "Delete archived session?",
    message: `Delete “${sessionDisplayName(session)}” permanently? This cannot be undone.`,
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  try {
    const result = await api("/api/sessions/delete", { method: "POST", body: { sessionId: session.id } });
    if (result.activeClosed) deactivateSession();
    state.sessions = state.sessions.filter((candidate) => candidate.id !== session.id);
    updateSessionPreferences(
      restoreSession(state.sessionPreferences, session.id),
      "Archived session deleted permanently.",
      archiveActionFocus(),
    );
  } catch (error) {
    showToast(error.message, "error");
  }
}

function deleteArchivedSessionButton(session) {
  return archiveActionButton(
    `Delete ${sessionDisplayName(session)}`,
    "Delete",
    SESSION_DELETE_ICON_PATHS,
    "archive-delete",
    () => { void deleteArchivedSession(session); },
  );
}

function restoreArchivedSessionButton(session) {
  return archiveActionButton(
    `Restore ${sessionDisplayName(session)}`,
    "Restore",
    SESSION_RESTORE_ICON_PATHS,
    "archive-restore",
    () => updateSessionPreferences(
      restoreSession(state.sessionPreferences, session.id),
      "Session restored to the sidebar.",
      archiveActionFocus(),
    ),
  );
}

function archivedSessionRow(session) {
  const row = document.createElement("article");
  row.className = "archive-row";
  const actions = document.createElement("div");
  actions.className = "archive-actions";
  actions.append(deleteArchivedSessionButton(session), restoreArchivedSessionButton(session));
  row.append(archivedSessionCopy(session), actions);
  return row;
}

function currentArchivedSessions() {
  return orderedSessions(archivedSessions(state.sessions, state.sessionPreferences), "updated");
}

async function deleteAllArchivedSessions() {
  const archived = currentArchivedSessions();
  if (archived.length === 0) return;
  const confirmed = await localConfirmDialog({
    title: "Delete all archived sessions?",
    message: `Permanently delete ${archived.length} archived sessions? This cannot be undone.`,
    confirmLabel: "Delete all",
  });
  if (!confirmed) return;
  elements.archiveDeleteAll.disabled = true;
  const deletedIds = [];
  let activeClosed = false;
  try {
    for (const session of archived) {
      const result = await api("/api/sessions/delete", { method: "POST", body: { sessionId: session.id } });
      deletedIds.push(session.id);
      activeClosed ||= result.activeClosed;
    }
    if (activeClosed) deactivateSession();
    const deleted = new Set(deletedIds);
    state.sessions = state.sessions.filter((session) => !deleted.has(session.id));
    const preferences = deletedIds.reduce(restoreSession, state.sessionPreferences);
    updateSessionPreferences(preferences, `${deletedIds.length} archived sessions deleted permanently.`, archiveActionFocus());
  } catch (error) {
    if (activeClosed) deactivateSession();
    if (deletedIds.length > 0) {
      state.sessionPreferences = deletedIds.reduce(restoreSession, state.sessionPreferences);
      writeSessionPreferences(localStorage, state.sessionPreferences);
    }
    await refreshSessionCatalog();
    showToast(`Delete all stopped after ${deletedIds.length} deletions: ${error.message}`, "error");
  } finally {
    elements.archiveDeleteAll.disabled = false;
  }
}

function renderArchivedSessions() {
  const archived = currentArchivedSessions();
  elements.archiveDeleteAll.hidden = archived.length === 0;
  if (archived.length > 0) {
    elements.archivedSessions.replaceChildren(...archived.map(archivedSessionRow));
    return;
  }
  const empty = document.createElement("p");
  empty.className = "archive-empty";
  empty.textContent = "No archived sessions";
  elements.archivedSessions.replaceChildren(empty);
}

function detailSection(label, content, tone = "default") {
  if (content === undefined) return null;
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const code = document.createElement("pre");
  code.textContent = boundedToolDetail(content);
  if (tone === "error") code.dataset.error = "true";
  section.append(heading, code);
  return section;
}

function setDetailsPanelOpen(open) {
  elements.app.dataset.detailsCollapsed = String(!open);
  elements.detailsPanel.inert = !open;
  elements.detailsPanel.setAttribute("aria-hidden", String(!open));
}

function showToolDetails({ title, input, output, error = false }) {
  setDetailsPanelOpen(true);
  elements.detailsBody.replaceChildren();
  const titleNode = document.createElement("h2");
  titleNode.className = "detail-title";
  titleNode.textContent = title || "Tool details";
  const sections = [detailSection("Input", input), detailSection("Output", output, error ? "error" : "default")].filter(Boolean);
  elements.detailsBody.append(titleNode, ...sections, elements.activity);
}

function inlineMarkdownNode(token) {
  if (token.type === "text") return document.createTextNode(token.text);
  if (token.type === "code") {
    const code = document.createElement("code");
    code.className = "inline-code";
    code.textContent = token.text;
    return code;
  }
  if (token.type === "strong") {
    const strong = document.createElement("strong");
    strong.textContent = token.text;
    return strong;
  }
  const link = document.createElement("a");
  link.href = token.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.textContent = token.label;
  return link;
}

function appendInlineMarkdown(parent, tokens) {
  parent.append(...tokens.map(inlineMarkdownNode));
}

function copyButtonIcon(copied = false) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  if (copied) {
    const check = document.createElementNS(namespace, "path");
    check.setAttribute("d", "m4.5 10.25 3.25 3.25 7.75-8");
    svg.append(check);
  } else {
    const back = document.createElementNS(namespace, "rect");
    const front = document.createElementNS(namespace, "rect");
    for (const [name, value] of Object.entries({ x: "3.5", y: "3.5", width: "9", height: "9", rx: "2" })) back.setAttribute(name, value);
    for (const [name, value] of Object.entries({ x: "7.5", y: "7.5", width: "9", height: "9", rx: "2" })) front.setAttribute(name, value);
    svg.append(back, front);
  }
  return svg;
}

function setCopyButtonState(button, label, copied) {
  button.replaceChildren(copyButtonIcon(copied));
  button.dataset.tooltip = copied ? "Copied" : "Copy";
  button.setAttribute("aria-label", copied ? `${label} copied` : `Copy ${label.toLocaleLowerCase()}`);
}

function showCopySuccess(button, label) {
  button.disabled = true;
  setCopyButtonState(button, label, true);
  showToast(`${label} copied`);
  window.setTimeout(() => {
    button.disabled = false;
    setCopyButtonState(button, label, false);
  }, 2_000);
}

async function copyText(button, text, label) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
    await navigator.clipboard.writeText(text);
    showCopySuccess(button, label);
  } catch {
    showToast(`Could not copy ${label.toLocaleLowerCase()}.`, "error");
  }
}

function copyButton(text, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  setCopyButtonState(button, label, false);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyText(button, text, label);
  });
  return button;
}

function codeBlockNode(block) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-header";
  const language = document.createElement("span");
  language.textContent = block.language || "Code";
  header.append(language, copyButton(block.text, "Code", "copy-button"));
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block.text;
  pre.append(code);
  wrapper.append(header, pre);
  return wrapper;
}

function tableRowNode(cells, alignments, cellTag) {
  const row = document.createElement("tr");
  cells.forEach((tokens, index) => {
    const cell = document.createElement(cellTag);
    cell.dataset.align = alignments[index];
    appendInlineMarkdown(cell, tokens);
    row.append(cell);
  });
  return row;
}

function tableNode(block) {
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  head.append(tableRowNode(block.headings, block.alignments, "th"));
  body.append(...block.rows.map((row) => tableRowNode(row, block.alignments, "td")));
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function listNode(block) {
  const list = document.createElement(block.ordered ? "ol" : "ul");
  if (block.ordered && block.start !== 1) list.start = block.start;
  for (const tokens of block.items) {
    const entry = document.createElement("li");
    appendInlineMarkdown(entry, tokens);
    list.append(entry);
  }
  return list;
}

function markdownBlockNode(block) {
  if (block.type === "codeBlock") return codeBlockNode(block);
  if (block.type === "table") return tableNode(block);
  if (block.type === "list") return listNode(block);
  const tag = block.type === "heading" ? `h${block.level}` : "p";
  const element = document.createElement(tag);
  appendInlineMarkdown(element, block.children);
  return element;
}

function markdownTextBlock(text) {
  const cleanText = messageTextPart(text);
  if (!cleanText) return null;
  const container = document.createElement("div");
  container.className = "message-text markdown-body";
  container.append(...parseMarkdown(cleanText).map(markdownBlockNode));
  return container;
}

function textBlock(text, className = "message-text") {
  const cleanText = displayText(text);
  if (!cleanText) return null;
  const block = document.createElement("div");
  block.className = className;
  block.textContent = cleanText;
  return block;
}

function subagentNoticeIcon(pathData) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  const path = document.createElementNS(namespace, "path");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");
  path.setAttribute("d", pathData);
  icon.append(path);
  return icon;
}

function subagentNoticeMeta(label, value, pathData) {
  const item = document.createElement("span");
  const copy = document.createElement("span");
  item.className = "subagent-notice-meta-item";
  copy.append(Object.assign(document.createElement("small"), { textContent: label }), document.createTextNode(` ${value}`));
  item.append(subagentNoticeIcon(pathData), copy);
  return item;
}

function subagentNoticeSection(label, text, pathData, className = "") {
  const section = document.createElement("section");
  const heading = document.createElement("div");
  const paragraph = document.createElement("p");
  section.className = `subagent-notice-section ${className}`.trim();
  heading.append(subagentNoticeIcon(pathData), Object.assign(document.createElement("strong"), { textContent: label }));
  paragraph.textContent = text;
  section.append(heading, paragraph);
  return section;
}

function subagentNoticeBlock(content) {
  const notice = parseSubagentNotice(content);
  if (!notice) return null;
  const card = document.createElement("aside");
  const header = document.createElement("header");
  const title = document.createElement("div");
  const metadata = document.createElement("div");
  card.className = "subagent-notice";
  card.setAttribute("aria-label", `Sub-agent update: ${notice.title}`);
  title.append(Object.assign(document.createElement("strong"), { textContent: notice.title }), Object.assign(document.createElement("small"), { textContent: "Asked parent" }));
  header.append(subagentNoticeIcon("M5 14.5v-1.25A3.25 3.25 0 0 1 8.25 10h3.5A3.25 3.25 0 0 1 15 13.25v1.25M10 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"), title);
  metadata.className = "subagent-notice-meta";
  metadata.append(
    subagentNoticeMeta("Depth", notice.depth, "M4 6.5 10 3l6 3.5-6 3.5-6-3.5Zm0 3.5 6 3.5 6-3.5M4 13.5 10 17l6-3.5"),
    subagentNoticeMeta("Reason", notice.reason.replaceAll("_", " "), "M5 4.5h4l2 2h4v9H5v-11Zm4 0v3h3"),
    subagentNoticeMeta("Type", notice.type, "M3.5 6.5V4h2.5l8.5 8.5-3 3L3 7Z"),
  );
  if (notice.blocking) metadata.append(subagentNoticeMeta("Blocking", "Yes", "M10 3 17 16H3L10 3Zm0 4v4m0 2.5v.1"));
  card.append(header, metadata);
  if (notice.message) card.append(subagentNoticeSection("Message", notice.message, "M3.5 4.5h13v9h-7l-4 3v-3h-2v-9Z"));
  if (notice.recommendation) card.append(subagentNoticeSection("Recommendation", notice.recommendation, "m4 10 3.5 3.5L16 5", "subagent-notice-recommendation"));
  return card;
}

function thinkingBlock(thinking) {
  const details = document.createElement("details");
  details.className = "thinking-block operational-row";
  const summary = document.createElement("summary");
  const marker = document.createElement("span");
  marker.className = "operational-marker";
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("strong");
  label.textContent = "Thinking";
  const hint = document.createElement("span");
  hint.className = "operational-hint";
  hint.textContent = "View reasoning";
  summary.append(marker, label, hint);
  const content = markdownTextBlock(thinking);
  details.append(summary, content);
  return details;
}

function toolCallButton(part) {
  const toolName = part.name || "Tool";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-row operational-row";
  const marker = document.createElement("span");
  marker.className = "operational-marker";
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("strong");
  label.textContent = toolName;
  const hint = document.createElement("span");
  hint.className = "operational-hint";
  hint.textContent = "View request";
  button.append(marker, label, hint);
  button.setAttribute("aria-label", `View ${toolName} tool request`);
  button.addEventListener("click", () => showToolDetails({ title: toolName, input: part.arguments }));
  return button;
}

function messagePartNode(part) {
  if (part?.type === "text") return markdownTextBlock(part.text);
  if (part?.type === "thinking" && displayText(part.thinking)) return thinkingBlock(part.thinking);
  if (part?.type === "image") return textBlock("Image attachment", "image-block");
  if (part?.type === "toolCall") return toolCallButton(part);
  return null;
}

function renderMessageContent(body, message, { live = false } = {}) {
  body.replaceChildren();
  let blocks = [];
  const subagentNotice = message.role === "custom" && typeof message.content === "string"
    ? subagentNoticeBlock(message.content)
    : null;
  if (subagentNotice) blocks = [subagentNotice];
  else if (typeof message.content === "string") blocks = [markdownTextBlock(message.content)];
  else if (Array.isArray(message.content)) blocks = message.content.map(messagePartNode);
  else if (message.role === "bashExecution") blocks = [textBlock(message.output, "tool-output")];
  blocks = blocks.filter(Boolean);
  if (blocks.length === 0 && !live) blocks.push(textBlock(message.errorMessage || "No text output"));
  body.append(...blocks.filter(Boolean));
}

function enableToolResultDetails(article, message) {
  article.tabIndex = 0;
  article.setAttribute("role", "button");
  article.setAttribute("aria-label", `View ${message.toolName || "tool"} result details`);
  const openDetails = () => showToolDetails({
    title: message.toolName || "Tool",
    output: messageText(message),
    error: Boolean(message.isError),
  });
  article.addEventListener("click", openDetails);
  article.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetails(); }
  });
}

function roleLabel(presentation) {
  if (presentation.error) return "Error";
  if (presentation.role === "assistant") return "Pi";
  if (presentation.role === "user") return "You";
  if (presentation.role === "thinking") return "Thinking";
  if (presentation.role === "bashExecution") return "Command";
  if (presentation.role === "toolResult" || presentation.role === "tool") return presentation.header || "Tool";
  return presentation.header || "Message";
}

function messageStatus(presentation) {
  if (presentation.error) return "Failed";
  if (presentation.role === "toolResult" || presentation.role === "bashExecution") return "Completed";
  return "";
}

function answerText(message) {
  if (typeof message?.content === "string") return messageTextPart(message.content);
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => messageTextPart(part.text))
    .filter(Boolean)
    .join("\n");
}

function isOperationalOnlyMessage(message, presentation) {
  if (presentation.role !== "assistant" || !Array.isArray(message?.content)) return false;
  return message.content.length > 0
    && message.content.every((part) => part?.type === "thinking" || part?.type === "toolCall");
}

function applyMessagePresentation(article, message, fallbackRole) {
  const presentation = messagePresentation(message, fallbackRole);
  article.dataset.role = presentation.role;
  article.dataset.error = String(presentation.error);
  article.setAttribute("aria-label", roleLabel(presentation));
  if (isOperationalOnlyMessage(message, presentation)) article.dataset.operationalOnly = "true";
  else delete article.dataset.operationalOnly;
  article.querySelector(".message-role-label").textContent = roleLabel(presentation);
  const status = article.querySelector(".message-status");
  status.textContent = messageStatus(presentation);
  status.hidden = !status.textContent;
  return presentation;
}

function appendMessageCopy(article, message) {
  article.querySelector(".message-copy")?.remove();
  const role = message?.role ?? "assistant";
  if (role !== "user" && role !== "assistant") return;
  const text = answerText(message);
  if (text) article.append(copyButton(text, "Message", "message-copy"));
}

function turnActivityNode() {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  const rule = document.createElement("span");
  const body = document.createElement("p");
  details.className = "turn-activity";
  label.className = "turn-activity-label";
  rule.className = "turn-activity-rule";
  rule.setAttribute("aria-hidden", "true");
  body.className = "turn-activity-body";
  label.textContent = "Worked";
  summary.append(label, rule);
  details.append(summary, body);
  return details;
}

function activityToolNames(details) {
  try { return JSON.parse(details.dataset.tools || "[]"); }
  catch { return []; }
}

function updateTurnActivity(details, timestamp) {
  if (timestamp) {
    details.dataset.startTime ||= timestamp;
    details.dataset.endTime = timestamp;
  }
  const tools = activityToolNames(details);
  const count = Number(details.dataset.toolCount || 0);
  const names = tools.slice(0, 3).join(", ");
  const more = tools.length > 3 ? ` and ${tools.length - 3} more` : "";
  const reasoning = details.dataset.reasoning === "true";
  details.querySelector(".turn-activity-label").textContent = elapsedActivityLabel(
    details.dataset.startTime,
    details.dataset.endTime,
  );
  details.querySelector(".turn-activity-body").textContent = count > 0
    ? `Used ${names}${more} across ${count} action${count === 1 ? "" : "s"}${reasoning ? ", with reasoning" : ""}.`
    : "Reviewed the request and prepared the response.";
}

function adjacentTurnActivity(article) {
  const previous = article.previousElementSibling;
  if (previous?.classList.contains("turn-activity")) return previous;
  const details = turnActivityNode();
  article.before(details);
  return details;
}

function collectOperationalContent(article) {
  const body = article.querySelector(".message-body");
  const operations = [...body.children].filter((node) => node.matches(".thinking-block, .tool-row"));
  const operationalArticle = article.matches('[data-role="toolResult"], [data-role="tool"], [data-role="bashExecution"]');
  if (operations.length === 0 && !operationalArticle) return false;
  const details = adjacentTurnActivity(article);
  const names = new Set(activityToolNames(details));
  const requestedTools = operations
    .filter((node) => node.matches(".tool-row"))
    .map((node) => node.querySelector("strong")?.textContent.trim())
    .filter(Boolean);
  requestedTools.forEach((name) => names.add(name));
  if (requestedTools.length > 0) {
    details.dataset.hasRequests = "true";
    details.dataset.toolCount = String(Number(details.dataset.toolCount || 0) + requestedTools.length);
  } else if (operationalArticle && details.dataset.hasRequests !== "true") {
    const name = article.querySelector(".message-role-label")?.textContent.trim();
    if (name) names.add(name);
    details.dataset.toolCount = String(Number(details.dataset.toolCount || 0) + 1);
  }
  if (operations.some((node) => node.matches(".thinking-block"))) details.dataset.reasoning = "true";
  details.dataset.tools = JSON.stringify([...names]);
  if (article.dataset.error === "true") details.dataset.error = "true";
  updateTurnActivity(details, article.dataset.timestamp);
  operations.forEach((node) => node.remove());
  if (operationalArticle || body.children.length === 0) article.remove();
  return true;
}

function conversationSeparator(timestamp) {
  const separator = document.createElement("div");
  const time = document.createElement("time");
  separator.className = "conversation-separator";
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", conversationTimestampLabel(timestamp));
  time.dateTime = timestamp.toISOString();
  time.textContent = conversationTimestampLabel(timestamp);
  separator.append(time);
  return separator;
}

function appendConversationSeparator(timestamp) {
  if (!timestamp) return;
  const day = localDayKey(timestamp);
  if (day && day !== localDayKey(state.lastMessageTimestamp)) {
    elements.transcript.append(conversationSeparator(timestamp));
  }
  state.lastMessageTimestamp = timestamp;
}

function messageHeaderNode() {
  const header = document.createElement("div");
  header.className = "message-header";
  const marker = document.createElement("span");
  marker.className = "message-role-marker";
  marker.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "message-role-label";
  const status = document.createElement("span");
  status.className = "message-status";
  status.hidden = true;
  header.append(marker, label, status);
  return header;
}

function appendMessage(message, { live = false } = {}) {
  if (!message || typeof message !== "object" || (message.role === "custom" && message.display === false)) return null;
  elements.empty.hidden = true;
  const article = document.createElement("article");
  const body = document.createElement("div");
  article.className = "message";
  body.className = "message-body";
  const timestamp = messageTimestamp(message) ?? (live || message.role === "user" ? new Date() : null);
  if (timestamp) article.dataset.timestamp = timestamp.toISOString();
  if (live) article.dataset.live = "true";
  article.append(messageHeaderNode(), body);
  const presentation = applyMessagePresentation(article, message, "assistant");
  renderMessageContent(body, message, { live });
  if (!live) appendMessageCopy(article, message);
  if (presentation.role === "toolResult" || presentation.role === "bashExecution") enableToolResultDetails(article, message);
  appendConversationSeparator(timestamp);
  elements.transcript.append(article);
  const operational = collectOperationalContent(article);
  if (!operational && presentation.role === "assistant") {
    const activity = article.previousElementSibling;
    if (activity?.classList.contains("turn-activity")) updateTurnActivity(activity, article.dataset.timestamp);
  }
  if (state.streaming) elements.transcript.append(elements.agentWorkingStatus);
  scrollConversationToEnd();
  return { article, body };
}

function discardLiveMessage() {
  state.liveMessage?.article.remove();
  resetStreamingState(state);
}

function setConversationLoading(loading) {
  elements.conversationLoading.hidden = !loading;
  elements.transcript.setAttribute("aria-busy", String(loading));
  if (loading) elements.transcript.dataset.loading = "true";
  else delete elements.transcript.dataset.loading;
  if (loading) elements.conversationScroll.scrollTop = 0;
}

function clearRenderedMessages() {
  resetStreamingState(state);
  state.pendingUserMessages = [];
  state.lastMessageTimestamp = null;
  const activeSessionId = String(state.activeSessionId ?? "");
  const preservedEditCards = [];
  for (const [summaryId, card] of state.taskEditCards) {
    card.remove();
    if (card.dataset.sessionId === activeSessionId) preservedEditCards.push(card);
    else state.taskEditCards.delete(summaryId);
  }
  elements.transcript.querySelectorAll(".message, .turn-activity, .conversation-separator, .task-edit-card").forEach((node) => node.remove());
  return preservedEditCards;
}

function renderMessages(messages) {
  setConversationLoading(false);
  const preservedEditCards = clearRenderedMessages();
  elements.empty.hidden = state.activeSessionId !== null || (Array.isArray(messages) && messages.length > 0);
  for (const message of messages ?? []) appendMessage(message);
  elements.transcript.append(...preservedEditCards);
  if (preservedEditCards.length > 0) scrollConversationToEnd();
}

function taskEditIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElement("span");
  const svg = document.createElementNS(namespace, "svg");
  const rectangle = document.createElementNS(namespace, "rect");
  const plus = document.createElementNS(namespace, "path");
  icon.className = "task-edit-icon";
  icon.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 20 20");
  for (const [name, value] of Object.entries({ x: "3.5", y: "3.5", width: "13", height: "13", rx: "2.5" })) rectangle.setAttribute(name, value);
  plus.setAttribute("d", "M7 10h6M10 7v6");
  svg.append(rectangle, plus);
  icon.append(svg);
  return icon;
}

function taskEditAction(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `task-edit-action ${className}`;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function setTaskEditCounts(container, additions, deletions, binary = false) {
  const added = document.createElement("span");
  added.textContent = binary ? "binary" : `+${additions}`;
  if (binary) container.replaceChildren(added);
  else {
    const deleted = document.createElement("span");
    deleted.textContent = `-${deletions}`;
    container.replaceChildren(added, deleted);
  }
}

function updateTaskEditCard(card, summary) {
  card.querySelector(".task-edit-title").textContent = `${summary.undone ? "Undid edits to" : "Edited"} ${summary.files.length} file${summary.files.length === 1 ? "" : "s"}`;
  setTaskEditCounts(card.querySelector(".task-edit-total"), summary.additions, summary.deletions);
  const undo = card.querySelector(".task-edit-undo");
  undo.disabled = summary.undone;
  undo.textContent = summary.undone ? "Undone" : "Undo ↶";
}

function taskEditFileNode(file) {
  const row = document.createElement("div");
  const filePath = document.createElement("span");
  const counts = document.createElement("span");
  row.className = "task-edit-file";
  filePath.className = "task-edit-path";
  filePath.textContent = file.path;
  filePath.title = file.path;
  counts.className = "task-edit-counts";
  setTaskEditCounts(counts, file.additions, file.deletions, file.binary);
  row.append(filePath, counts);
  return row;
}

function taskEditIdentity() {
  const identity = document.createElement("div");
  const titleWrap = document.createElement("div");
  const title = document.createElement("strong");
  const total = document.createElement("span");
  identity.className = "task-edit-identity";
  title.className = "task-edit-title";
  total.className = "task-edit-total";
  titleWrap.append(title, total);
  identity.append(taskEditIcon(), titleWrap);
  return identity;
}

function taskEditActions(summary, card) {
  const actions = document.createElement("div");
  actions.className = "task-edit-actions";
  const undo = taskEditAction("Undo ↶", "task-edit-undo", async () => {
    undo.disabled = true;
    try {
      const response = await api(`/api/task-edits/${encodeURIComponent(summary.id)}/undo`, { method: "POST", body: {} });
      Object.assign(summary, response.summary);
      updateTaskEditCard(card, summary);
      showToast("Task edits undone.");
    } catch (error) { undo.disabled = false; showToast(error.message, "error"); }
  });
  const review = taskEditAction("Review", "task-edit-review", async () => {
    try {
      const response = await api(`/api/task-edits/${encodeURIComponent(summary.id)}`);
      showToolDetails({ title: `Edited ${summary.files.length} files`, output: response.patch || "No textual diff" });
    } catch (error) { showToast(error.message, "error"); }
  });
  actions.append(undo, review);
  return actions;
}

function renderTaskEditSummary(summary) {
  if (!summary?.id || !Array.isArray(summary.files) || state.taskEditCards.has(summary.id)) return;
  const card = document.createElement("section");
  const header = document.createElement("header");
  const files = document.createElement("div");
  card.className = "task-edit-card";
  card.dataset.summaryId = summary.id;
  card.dataset.sessionId = String(state.activeSessionId ?? "");
  card.setAttribute("aria-label", `Edited ${summary.files.length} files`);
  header.append(taskEditIdentity(), taskEditActions(summary, card));
  files.className = "task-edit-files";
  files.append(...summary.files.map(taskEditFileNode));
  card.append(header, files);
  updateTaskEditCard(card, summary);
  state.taskEditCards.set(summary.id, card);
  elements.empty.hidden = true;
  elements.transcript.append(card);
  if (state.streaming) elements.transcript.append(elements.agentWorkingStatus);
  scrollConversationToEnd();
}

function addActivity(label, tone = "idle") {
  const node = document.createElement("li");
  node.className = "activity-node";
  node.dataset.tone = tone;
  const dot = document.createElement("span");
  dot.className = "activity-dot";
  dot.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "activity-label";
  text.textContent = label;
  node.append(dot, text);
  elements.activity.append(node);
  while (elements.activity.children.length > 10) {
    const removed = elements.activity.firstElementChild;
    if (removed.dataset.toolCallId) state.toolActivities.delete(removed.dataset.toolCallId);
    if (removed.dataset.extensionStatusKey) state.extensionStatuses.delete(removed.dataset.extensionStatusKey);
    removed.remove();
  }
  return { node, text };
}

function toolEventOutput(event) {
  const payload = event.result ?? event.partialResult;
  if (!payload) return undefined;
  return messageText(payload) || payload;
}

function updateToolActivity(event, phase) {
  const toolCallId = event.toolCallId;
  if (!toolCallId) return;
  let activity = state.toolActivities.get(toolCallId);
  if (!activity) {
    activity = { ...addActivity(toolActivityLabel(event.toolName, "start"), "live"), input: event.args };
    activity.node.dataset.toolCallId = toolCallId;
    state.toolActivities.set(toolCallId, activity);
  }
  activity.input = event.args ?? activity.input;
  activity.output = toolEventOutput(event) ?? activity.output;
  activity.text.textContent = toolActivityLabel(event.toolName, phase, event.isError);
  activity.node.dataset.tone = phase === "end" ? (event.isError ? "error" : "idle") : "live";
  activity.node.tabIndex = 0;
  activity.node.setAttribute("role", "button");
  activity.node.setAttribute("aria-label", `View ${event.toolName ?? "tool"} execution details`);
  activity.node.onclick = () => showToolDetails({
    title: event.toolName || "Tool",
    input: activity.input,
    output: activity.output,
    error: Boolean(event.isError),
  });
  activity.node.onkeydown = (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      activity.node.click();
    }
  };
}

function resetActivity() {
  state.toolActivities.clear();
  state.extensionStatuses.clear();
  state.extensionWidgets.clear();
  elements.activity.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "details-empty";
  empty.textContent = "Select a tool activity to view its details";
  elements.detailsBody.replaceChildren(empty, elements.activity);
  setDetailsPanelOpen(false);
  renderExtensionWidgets();
  document.title = "Pi Harness";
}

function modelIdentity(model) {
  if (!model) return "—";
  return model.id?.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`;
}

function renderContextStats(stats = state.contextStats) {
  const usage = stats?.contextUsage ?? null;
  elements.contextBrief.textContent = formatContextPercent(usage?.percent);
  elements.contextUsed.textContent = formatTokenCount(usage?.tokens);
  elements.contextWindow.textContent = formatTokenCount(usage?.contextWindow);
  elements.contextMessages.textContent = stats?.totalMessages === null || stats?.totalMessages === undefined
    ? "—"
    : String(Math.round(stats.totalMessages));
  elements.contextCost.textContent = formatSessionCost(stats?.cost);
  elements.contextState.textContent = state.compacting ? "Compacting" : state.contextLoading ? "Loading" : "Ready";
  elements.autoCompaction.setAttribute("aria-checked", String(state.autoCompactionEnabled));
  elements.autoCompaction.querySelector("strong").textContent = state.autoCompactionEnabled ? "On" : "Off";
  elements.autoCompaction.disabled = state.contextLoading || state.compacting;
  elements.compactNow.disabled = state.contextLoading || state.compacting || state.streaming;
}

async function refreshContextStats() {
  const sessionId = state.activeSessionId;
  if (!sessionId) return;
  const requestId = ++state.contextRequestId;
  state.contextLoading = true;
  renderContextStats();
  try {
    const result = await api("/api/command", { method: "POST", body: { type: "get_session_stats" } });
    if (state.activeSessionId === sessionId && state.contextRequestId === requestId) {
      state.contextStats = normalizeSessionStats(result.data);
    }
  } catch (error) {
    if (state.activeSessionId === sessionId && state.contextRequestId === requestId) showToast(error.message, "error");
  } finally {
    if (state.activeSessionId === sessionId && state.contextRequestId === requestId) {
      state.contextLoading = false;
      renderContextStats();
    }
  }
}

function updateModelState(runtimeState = {}) {
  const previousModel = modelIdentity(state.currentModel);
  state.currentModel = runtimeModel(state.currentModel, runtimeState);
  const model = state.currentModel;
  if (modelIdentity(model) !== previousModel) state.attachmentContext += 1;
  state.thinkingLevel = runtimeState.thinkingLevel ?? state.thinkingLevel;
  elements.model.textContent = model ? modelLabel(model) : "Pi model";
  elements.thinking.textContent = state.thinkingLevel ?? "—";
  elements.modelDialogCurrent.textContent = model ? modelLabel(model) : "Pi model";
  elements.thinkingDialogCurrent.textContent = state.thinkingLevel ?? "—";
  refreshAttachmentAvailability();
}

function updateRuntime(runtimeState = {}) {
  updateModelState(runtimeState);
  if (runtimeState.sessionName) elements.sessionTitle.textContent = runtimeState.sessionName;
  if (typeof runtimeState.isStreaming === "boolean") setStreaming(runtimeState.isStreaming);
  if (Number.isSafeInteger(runtimeState.pendingMessageCount)) setQueueCount(runtimeState.pendingMessageCount);
  if (typeof runtimeState.autoCompactionEnabled === "boolean") state.autoCompactionEnabled = runtimeState.autoCompactionEnabled;
  elements.contextTrigger.hidden = false;
  elements.sessionActions.hidden = false;
  renderContextStats();
}

function setQueueCount(count) {
  state.queueCount = Number.isSafeInteger(count) && count > 0 ? count : 0;
  elements.queueCount.hidden = state.queueCount === 0;
  elements.queueCount.textContent = state.queueCount ? String(state.queueCount) : "";
  elements.queueModeWrap.title = state.queueCount
    ? `${state.queueCount} queued message${state.queueCount === 1 ? "" : "s"}`
    : "How messages are handled while Pi is working";
}

function updateAgentWorkingClock() {
  if (state.workingStartedAt === null) return;
  const elapsed = Math.max(0, Date.now() - state.workingStartedAt);
  elements.agentWorkingClock.hidden = elapsed < 15_000;
  elements.agentWorkingClock.textContent = formatRunDuration(elapsed);
}

function syncAgentWorkingStatus(streaming) {
  elements.agentWorkingStatus.hidden = !streaming;
  if (!streaming) {
    window.clearInterval(state.workingTimer);
    state.workingStartedAt = null;
    state.workingTimer = null;
    elements.agentWorkingClock.hidden = true;
    elements.agentWorkingClock.textContent = "";
    return;
  }
  elements.transcript.append(elements.agentWorkingStatus);
  if (state.workingStartedAt === null) state.workingStartedAt = Date.now();
  updateAgentWorkingClock();
  if (state.workingTimer === null) state.workingTimer = window.setInterval(updateAgentWorkingClock, 1_000);
}

function setStreaming(streaming) {
  const changed = state.streaming !== streaming;
  state.streaming = streaming;
  syncAgentWorkingStatus(streaming);
  if (changed) renderSessions();
  elements.abort.hidden = !streaming;
  elements.abort.disabled = !streaming || state.aborting;
  elements.sessionActions.disabled = streaming;
  elements.permissionStatus.hidden = streaming;
  if (streaming) closeApprovalMenu();
  elements.queueModeWrap.hidden = !streaming;
  const action = streaming ? "Queue message" : "Send message";
  elements.send.querySelector("span:first-child").textContent = action;
  elements.send.setAttribute("aria-label", action);
  elements.send.dataset.tooltip = streaming ? "Queue" : "Send";
  renderContextStats();
  renderAccounts();
}

function setQueueMode(mode, { persist = true } = {}) {
  state.queueMode = mode;
  elements.queueMode.value = mode;
  elements.settingsQueueMode.textContent = mode === "steer" ? "Steer" : "Follow up";
  if (!persist) return;
  try { writeQueueMode(localStorage, mode); }
  catch { showToast("Queue preference could not be saved.", "error"); }
}

function removeClearedQueuedMessages(queueValue) {
  const { remaining, removed } = takeClearedQueueRecords(state.queuedMessages, queueValue);
  state.queuedMessages = remaining;
  state.pendingUserMessages = state.pendingUserMessages.filter((record) => !removed.includes(record));
  for (const record of removed) record.article.remove();
  return removed.some((record) => record.hadImages);
}

function handleQueueUpdate(event) {
  setQueueCount(queueMessageCount(event));
}

function restoreQueuedReferences(queue) {
  const unpacked = unpackReferenceQueue(queue);
  if (unpacked.references.length === 0) return { queue: unpacked.messages, inlined: false };
  const additions = unpacked.references.map((reference) => ({
    kind: "text",
    name: reference.name,
    size: textReferenceBytes(reference),
    reference,
  }));
  try {
    assertAttachmentCapacity(state.attachments, additions);
    state.attachments.push(...additions);
    renderAttachments();
    return { queue: unpacked.messages, inlined: false };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return {
      queue: Object.fromEntries(["steering", "followUp"].map((kind) =>
        [kind, queue[kind].map(inlineReferencePrompt)])),
      inlined: true,
    };
  }
}

function applyClearedQueue(queue) {
  const count = queueMessageCount(queue);
  const lostImages = removeClearedQueuedMessages(queue);
  const restored = restoreQueuedReferences(queue);
  elements.input.value = restoredQueueText(restored.queue, elements.input.value);
  resizeComposer();
  void updateCommandSuggestions();
  setQueueCount(0);
  state.queuedMessages = [];
  if (count > 0) showToast(`Restored ${count} queued message${count === 1 ? "" : "s"}.`);
  if (lostImages) showToast("Queued image attachments could not be restored.", "warn");
  if (restored.inlined) showToast("Queued text references were restored inline because attachment limits were reached.", "warn");
}

async function abortRun() {
  if (!state.streaming || state.aborting) return;
  state.aborting = true;
  elements.abort.disabled = true;
  elements.abort.setAttribute("aria-busy", "true");
  try {
    await clearQueueBeforeAbort(
      (command) => api("/api/command", { method: "POST", body: command }),
      applyClearedQueue,
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.aborting = false;
    elements.abort.disabled = !state.streaming;
    elements.abort.removeAttribute("aria-busy");
  }
}

function handleMessageUpdate(event) {
  const delta = event.assistantMessageEvent;
  if (!delta || typeof delta !== "object") return;
  if (!state.liveMessage) state.liveMessage = appendMessage({ role: delta.type?.startsWith("thinking") ? "thinking" : "assistant", content: "" }, { live: true });
  if (delta.type === "toolcall_start") addActivity(`Tool: ${delta.toolName ?? "unknown"}`, "live");
  state.liveMessage.body.textContent = applyStreamingDelta(state.liveParts, delta);
  scrollConversationToEnd();
}

function messageTransportText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.find((part) => part?.type === "text")?.text ?? "";
}

function handleMessageEnd(event) {
  const message = event.message;
  if (message?.role === "assistant" && state.liveMessage) {
    applyMessagePresentation(state.liveMessage.article, message, "assistant");
    delete state.liveMessage.article.dataset.live;
    renderMessageContent(state.liveMessage.body, message);
    appendMessageCopy(state.liveMessage.article, message);
    collectOperationalContent(state.liveMessage.article);
    resetStreamingState(state);
    scrollConversationToEnd();
    return;
  }
  if (message?.role === "user") {
    const index = state.pendingUserMessages.findIndex((record) => record.message === messageTransportText(message));
    if (index >= 0) {
      const [record] = state.pendingUserMessages.splice(index, 1);
      state.queuedMessages = state.queuedMessages.filter((queued) => queued !== record);
      applyMessagePresentation(record.article, message, "user");
      renderMessageContent(record.article.querySelector(".message-body"), message);
      appendMessageCopy(record.article, message);
      scrollConversationToEnd();
      return;
    }
  }
  if (message) appendMessage(message);
}

function updateExtensionStatus(request) {
  const current = state.extensionStatuses.get(request.statusKey);
  if (!request.statusText) {
    current?.node.remove();
    state.extensionStatuses.delete(request.statusKey);
    return;
  }
  if (current) current.text.textContent = request.statusText;
  else {
    const activity = addActivity(request.statusText, "live");
    activity.node.dataset.extensionStatusKey = request.statusKey;
    state.extensionStatuses.set(request.statusKey, activity);
  }
}

function renderExtensionWidgets() {
  for (const [placement, container] of [["aboveEditor", elements.extensionWidgetsAbove], ["belowEditor", elements.extensionWidgetsBelow]]) {
    const widgets = [...state.extensionWidgets.values()].filter((widget) => widget.placement === placement);
    container.replaceChildren(...widgets.map((widget) => {
      const section = document.createElement("section");
      section.className = "extension-widget";
      section.append(...widget.lines.map((line) => {
        const row = document.createElement("div");
        row.textContent = line;
        return row;
      }));
      return section;
    }));
    container.hidden = widgets.length === 0;
  }
  scrollConversationToEnd();
}

function updateExtensionWidget(request) {
  if (!request.widgetLines?.length) state.extensionWidgets.delete(request.widgetKey);
  else state.extensionWidgets.set(request.widgetKey, { lines: request.widgetLines, placement: request.widgetPlacement });
  renderExtensionWidgets();
}

function handleExtensionNotice(request) {
  if (request.method === "notify") showToast(request.message, request.notifyType === "error" ? "error" : request.notifyType === "warning" ? "warn" : "info");
  else if (request.method === "setStatus") updateExtensionStatus(request);
  else if (request.method === "setWidget") updateExtensionWidget(request);
  else if (request.method === "setTitle") document.title = request.title;
  else if (request.method === "set_editor_text") {
    elements.input.value = request.text;
    resizeComposer();
    void updateCommandSuggestions();
  }
}

function handleExtensionRequest(request) {
  if (FIRE_AND_FORGET_UI_METHODS.has(request.method)) {
    handleExtensionNotice(request);
    return;
  }
  if (typeof request.id !== "string" || !request.id) {
    showToast("Pi sent an invalid interaction request.", "error");
    return;
  }
  if (state.pendingDialogIds.has(request.id)) return;
  state.pendingDialogIds.add(request.id);
  state.dialogQueue.push(request);
  showNextDialog();
}

function setDialogPending(pending) {
  elements.dialog.dataset.pending = String(pending);
  elements.dialogActions.querySelectorAll("button").forEach((button) => { button.disabled = pending; });
}

async function respondAndCloseDialog(request, response) {
  setDialogPending(true);
  try {
    await api("/api/command", { method: "POST", body: { type: "extension_ui_response", id: request.id, ...response } });
    state.pendingDialogIds.delete(request.id);
    closeDialog();
  } catch (error) {
    setDialogPending(false);
    showToast(error.message, "error");
  }
}

function dialogButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", action);
  return button;
}

function closeDialog() {
  delete elements.dialog.dataset.pending;
  elements.dialog.oncancel = null;
  elements.dialog.close();
  elements.dialogControl.replaceChildren();
  elements.dialogActions.replaceChildren();
  state.dialogOpen = false;
  showNextDialog();
  if (!state.dialogOpen && !elements.input.disabled) elements.input.focus();
}

function clearDialogState() {
  state.dialogQueue = [];
  state.pendingDialogIds.clear();
  if (!state.dialogOpen) return;
  delete elements.dialog.dataset.pending;
  elements.dialog.oncancel = null;
  elements.dialog.close();
  elements.dialogControl.replaceChildren();
  elements.dialogActions.replaceChildren();
  state.dialogOpen = false;
}

function selectDialogControl(request, dialogSelection) {
  const list = document.createElement("div");
  list.className = "choice-list";
  list.setAttribute("role", "listbox");
  for (const option of request.options ?? []) {
    const choice = dialogButton(String(option), "choice", () => {
      dialogSelection.value = String(option);
      list.querySelectorAll("button").forEach((button) => button.setAttribute("aria-selected", String(button === choice)));
      dialogSelection.onChange?.();
    });
    choice.setAttribute("role", "option");
    choice.setAttribute("aria-selected", "false");
    list.append(choice);
  }
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const choices = [...list.querySelectorAll("button")];
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = (choices.indexOf(document.activeElement) + direction + choices.length) % choices.length;
    if (choices[next]) { event.preventDefault(); choices[next].focus(); }
  });
  return list;
}

function valueDialogControl(request) {
  if (request.method !== "input" && request.method !== "editor") return null;
  const control = document.createElement(request.method === "editor" ? "textarea" : "input");
  control.value = request.prefill ?? "";
  if (request.placeholder) control.placeholder = request.placeholder;
  control.maxLength = 64 * 1024;
  return control;
}

function dialogApprovalResponse(request, dialogSelection, valueControl) {
  if (request.method === "confirm") return { confirmed: true };
  if (request.method === "select" && dialogSelection.value === undefined) return null;
  return { value: request.method === "select" ? dialogSelection.value : valueControl?.value ?? "" };
}

function showNextDialog() {
  if (state.dialogOpen || state.dialogQueue.length === 0) return;
  state.dialogOpen = true;
  const request = state.dialogQueue.shift();
  const dialogSelection = { value: undefined };
  const valueControl = valueDialogControl(request);
  const control = request.method === "select" ? selectDialogControl(request, dialogSelection) : valueControl;
  elements.dialogTitle.textContent = request.title || "Input required";
  elements.dialogMessage.textContent = request.message || "Pi is waiting for your response.";
  elements.dialogControl.replaceChildren(...(control ? [control] : []));
  const cancel = dialogButton("Cancel", "", () => { void respondAndCloseDialog(request, { cancelled: true }); });
  const approve = dialogButton(request.method === "confirm" ? "Allow" : "Continue", "primary", () => {
    const response = dialogApprovalResponse(request, dialogSelection, valueControl);
    if (response) void respondAndCloseDialog(request, response);
  });
  approve.disabled = request.method === "select";
  dialogSelection.onChange = () => { approve.disabled = false; };
  elements.dialogActions.replaceChildren(cancel, approve);
  elements.dialog.oncancel = (event) => {
    event.preventDefault();
    if (elements.dialog.dataset.pending !== "true") void respondAndCloseDialog(request, { cancelled: true });
  };
  elements.dialog.showModal();
  if (valueControl) valueControl.focus();
  else if (request.method === "select") control?.querySelector("button")?.focus();
  else approve.focus();
}

function handleLifecycleEvent(event) {
  const activity = lifecycleActivity(event);
  if (!activity) return;
  if (typeof activity.compacting === "boolean") {
    state.compacting = activity.compacting;
    renderContextStats();
  }
  addActivity(activity.label, activity.tone);
  if (activity.error) showToast(activity.error, "error");
  if (event.type === "compaction_end") void refreshContextStats();
}

function handleEvent(event) {
  switch (event.type) {
    case "agent_start":
      setStreaming(true);
      addActivity("Agent started", "live");
      break;
    case "agent_settled":
      setStreaming(false);
      setQueueCount(0);
      state.queuedMessages = [];
      state.pendingUserMessages = [];
      clearDialogState();
      discardLiveMessage();
      addActivity("Agent settled", "idle");
      refreshState();
      if (!elements.contextMenu.hidden) void refreshContextStats();
      break;
    case "message_update": handleMessageUpdate(event); break;
    case "message_end": handleMessageEnd(event); break;
    case "tool_execution_start": updateToolActivity(event, "start"); break;
    case "tool_execution_update": updateToolActivity(event, "update"); break;
    case "tool_execution_end": updateToolActivity(event, "end"); break;
    case "workspace_edit_summary": renderTaskEditSummary(event); break;
    case "account_login":
      renderAccountLogin(event);
      if (!accountLoginBusy()) {
        finishAccountLogin(event);
        void loadAccounts({ force: true });
      }
      break;
    case "session_changed": void syncSessionMessages(state.stream, { reload: true }); break;
    case "queue_update": handleQueueUpdate(event); break;
    case "auto_retry_start":
    case "auto_retry_end":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "compaction_start":
    case "compaction_end": handleLifecycleEvent(event); break;
    case "extension_error": showToast(event.error ?? "Extension failed", "error"); break;
    case "extension_ui_request": handleExtensionRequest(event); break;
    case "browser_error": showToast(event.error ?? "Pi browser event failed", "error"); break;
    default:
      if (!SAFE_IGNORED_EVENT_TYPES.has(event.type)) showToast("Pi sent an unsupported event.", "warn");
      break;
  }
}

async function syncSessionMessages(stream = state.stream, { reload = false } = {}) {
  if (!stream || stream !== state.stream || state.streaming || state.activeSessionId === null) return;
  const sessionRequestId = state.sessionOpenRequestId;
  const syncRequestId = ++state.messageSyncRequestId;
  try {
    if (reload) {
      const refreshed = await api("/api/sessions/refresh", { method: "POST", body: {} });
      if (stream !== state.stream || sessionRequestId !== state.sessionOpenRequestId || syncRequestId !== state.messageSyncRequestId) return;
      if (refreshed.state) {
        state.activeSessionId = refreshed.state.browserSessionId ?? state.activeSessionId;
        state.confirmedSessionId = state.activeSessionId;
        updateRuntime(refreshed.state);
      }
    }
    const messages = await api("/api/command", { method: "POST", body: { type: "get_messages" } });
    if (stream !== state.stream || sessionRequestId !== state.sessionOpenRequestId || syncRequestId !== state.messageSyncRequestId) return;
    renderMessages(messages.data?.messages ?? []);
  } catch (error) {
    if (stream === state.stream && sessionRequestId === state.sessionOpenRequestId) showToast(error.message, "error");
  }
}

function connectEvents() {
  state.stream?.close();
  const stream = new EventSource("/api/events");
  const sessionRequestId = state.sessionOpenRequestId;
  let hasOpened = false;
  state.stream = stream;
  stream.onopen = () => {
    if (stream !== state.stream || sessionRequestId !== state.sessionOpenRequestId) return;
    setConnection("connected", "Connected");
    void syncSessionMessages(stream, { reload: hasOpened });
    hasOpened = true;
  };
  stream.onerror = () => {
    if (stream === state.stream && sessionRequestId === state.sessionOpenRequestId) setConnection("error", "Reconnecting");
  };
  stream.onmessage = (message) => {
    if (stream !== state.stream || sessionRequestId !== state.sessionOpenRequestId) return;
    try { handleEvent(JSON.parse(message.data)); }
    catch { showToast("Pi sent an unreadable event", "error"); }
  };
}

async function refreshState() {
  try {
    const runtimeState = await api("/api/state");
    if (runtimeState.active) updateRuntime(runtimeState);
    else updateModelState(runtimeState);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function openSession(selection) {
  if (accountUiBusy()) {
    showToast("Wait for the account update to finish.", "warn");
    return false;
  }
  const requestId = ++state.sessionOpenRequestId;
  state.messageSyncRequestId += 1;
  state.stream?.close();
  state.stream = null;
  const previousSessionId = state.confirmedSessionId;
  const previousTitle = state.confirmedSessionTitle;
  const optimisticSession = state.sessions.find((session) => session.id === selection.sessionId);
  state.activeSessionId = selection.sessionId ?? null;
  elements.app.dataset.sessionActive = "true";
  elements.sessionTitle.textContent = optimisticSession?.name || "New session";
  elements.input.disabled = true;
  elements.send.disabled = true;
  refreshAttachmentAvailability();
  renderSessions();
  setConversationLoading(true);
  setConnection("starting", "Opening");
  let opened = false;
  try {
    const openSessionResult = await api("/api/sessions/open", { method: "POST", body: selection });
    if (requestId !== state.sessionOpenRequestId) return false;
    opened = true;
    state.activeSessionId = openSessionResult.state?.browserSessionId ?? selection.sessionId ?? null;
    if (previousSessionId && previousSessionId !== state.activeSessionId) {
      clearAttachments();
      state.contextStats = null;
      state.contextLoading = false;
      state.contextRequestId += 1;
    }
    const selected = state.sessions.find((session) => session.id === state.activeSessionId);
    elements.sessionTitle.textContent = openSessionResult.state?.sessionName || selected?.name || "New session";
    state.confirmedSessionId = state.activeSessionId;
    state.confirmedSessionTitle = elements.sessionTitle.textContent;
    updateRuntime(openSessionResult.state);
    renderSessions();
    clearRenderedMessages();
    elements.empty.hidden = true;
    const messages = await api("/api/command", { method: "POST", body: { type: "get_messages" } });
    if (requestId !== state.sessionOpenRequestId) return false;
    resetActivity();
    renderMessages(messages.data?.messages ?? []);
    connectEvents();
    elements.input.disabled = false;
    elements.send.disabled = false;
    refreshAttachmentAvailability();
    if (!elements.contextMenu.hidden) void refreshContextStats();
    elements.input.focus();
    return true;
  } catch (error) {
    if (requestId !== state.sessionOpenRequestId) return false;
    setConversationLoading(false);
    if (!opened) {
      state.activeSessionId = previousSessionId;
      elements.app.dataset.sessionActive = String(previousSessionId !== null);
      elements.sessionTitle.textContent = previousTitle;
      renderSessions();
    }
    elements.input.disabled = false;
    elements.send.disabled = false;
    refreshAttachmentAvailability();
    setConnection("error", "Open failed");
    if (state.activeSessionId !== null) connectEvents();
    showToast(error.message, "error");
    return false;
  }
}

function localTextDialog({ title, message, placeholder = "", value = "", confirmLabel = "Continue" }) {
  return new Promise((resolve) => {
    state.dialogOpen = true;
    elements.dialogTitle.textContent = title;
    elements.dialogMessage.textContent = message;
    const input = document.createElement("input");
    input.placeholder = placeholder;
    input.value = value;
    elements.dialogControl.replaceChildren(input);
    const finish = (result) => {
      elements.dialog.oncancel = null;
      elements.dialog.close();
      elements.dialogControl.replaceChildren();
      elements.dialogActions.replaceChildren();
      state.dialogOpen = false;
      resolve(result);
      showNextDialog();
    };
    elements.dialogActions.replaceChildren(
      dialogButton("Cancel", "", () => finish(null)),
      dialogButton(confirmLabel, "primary", () => finish(input.value.trim() || null)),
    );
    elements.dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
    elements.dialog.showModal();
    input.focus();
    input.select();
  });
}

function localConfirmDialog({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    state.dialogOpen = true;
    elements.dialogTitle.textContent = title;
    elements.dialogMessage.textContent = message;
    elements.dialogControl.replaceChildren();
    const finish = (result) => {
      elements.dialog.oncancel = null;
      elements.dialog.close();
      elements.dialogActions.replaceChildren();
      state.dialogOpen = false;
      resolve(result);
      showNextDialog();
    };
    elements.dialogActions.replaceChildren(
      dialogButton("Cancel", "", () => finish(false)),
      dialogButton(confirmLabel, "danger", () => finish(true)),
    );
    elements.dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
    elements.dialog.showModal();
  });
}

function localInputDialog(title, message, placeholder) {
  return localTextDialog({ title, message, placeholder, confirmLabel: "Open" });
}

async function refreshSessionCatalog() {
  const result = await api("/api/sessions");
  state.sessions = result.sessions ?? [];
  renderSessions();
  renderArchivedSessions();
}

function deactivateSession() {
  state.sessionOpenRequestId += 1;
  state.messageSyncRequestId += 1;
  setConversationLoading(false);
  state.stream?.close();
  state.stream = null;
  state.activeSessionId = null;
  state.confirmedSessionId = null;
  state.confirmedSessionTitle = "New Session";
  state.currentModel = null;
  state.contextStats = null;
  elements.app.dataset.sessionActive = "false";
  elements.sessionTitle.textContent = "New Session";
  elements.sessionActions.hidden = true;
  elements.contextTrigger.hidden = true;
  elements.input.disabled = false;
  elements.send.disabled = false;
  clearAttachments();
  resetActivity();
  renderMessages([]);
  elements.input.focus();
  void refreshState();
}

async function renameActiveSession() {
  closeSessionMenu();
  const name = await localTextDialog({
    title: "Rename session",
    message: "Set the name stored by the active Pi session.",
    value: elements.sessionTitle.textContent,
    confirmLabel: "Rename",
  });
  if (!name) return;
  try {
    await api("/api/command", { method: "POST", body: { type: "set_session_name", name } });
    elements.sessionTitle.textContent = name;
    state.confirmedSessionTitle = name;
    await refreshSessionCatalog();
  } catch (error) { showToast(error.message, "error"); }
}

async function cloneActiveSession() {
  closeSessionMenu();
  try {
    const result = await api("/api/sessions/clone", { method: "POST", body: {} });
    if (result.cancelled) { showToast("Pi cancelled the session clone.", "warn"); return; }
    await refreshSessionCatalog();
    await openSession({ sessionId: result.state.browserSessionId });
    showToast("Session cloned.");
  } catch (error) { showToast(error.message, "error"); }
}

async function deleteActiveSession() {
  closeSessionMenu();
  const confirmed = await localConfirmDialog({
    title: "Delete session?",
    message: `Delete “${elements.sessionTitle.textContent}” permanently? This cannot be undone.`,
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  try {
    await api("/api/sessions/delete", { method: "POST", body: { sessionId: state.activeSessionId } });
    deactivateSession();
    await refreshSessionCatalog();
    showToast("Session deleted.");
  } catch (error) { showToast(error.message, "error"); }
}

function resizeComposer() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
  scrollConversationToEnd();
}

function positionAbove(anchor, popup, { align = "right", gap = 6 } = {}) {
  popup.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const preferredLeft = align === "right" ? anchorRect.right - popupRect.width : anchorRect.left;
  popup.style.left = `${Math.max(8, Math.min(preferredLeft, innerWidth - popupRect.width - 8))}px`;
  popup.style.top = `${Math.max(8, anchorRect.top - popupRect.height - gap)}px`;
}

function positionBelow(anchor, popup, { align = "right", gap = 6 } = {}) {
  popup.hidden = false;
  const anchorRect = anchor.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const preferredLeft = align === "right" ? anchorRect.right - popupRect.width : anchorRect.left;
  popup.style.left = `${Math.max(8, Math.min(preferredLeft, innerWidth - popupRect.width - 8))}px`;
  popup.style.top = `${Math.min(innerHeight - popupRect.height - 8, anchorRect.bottom + gap)}px`;
}

function closeProfileMenu({ restoreFocus = false } = {}) {
  elements.profileMenu.hidden = true;
  elements.profileTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.profileTrigger.focus();
}

function toggleProfileMenu() {
  if (!elements.profileMenu.hidden) { closeProfileMenu({ restoreFocus: true }); return; }
  closeSessionMenu();
  closeCommandMenu();
  closeViewMenu();
  closeContextMenu();
  closeApprovalMenu();
  renderAccountIdentity();
  positionAbove(elements.profileTrigger, elements.profileMenu, { align: "left", gap: 7 });
  elements.profileTrigger.setAttribute("aria-expanded", "true");
  elements.profileMenu.querySelector("button")?.focus();
}

function openAccountsDialog({ refreshUsage = false } = {}) {
  closeProfileMenu();
  if (!elements.accountsDialog.open) {
    elements.accountsDialog.showModal();
    elements.accountsTitle.focus({ preventScroll: true });
    hideIconTooltip();
  }
  renderAccounts();
  void loadAccounts({ force: true }).then(() => {
    if (refreshUsage) void refreshAccountUsage(activeAccount()?.id);
  });
  void pollAccountLogin();
  clearInterval(state.accountCountdownTimer);
  state.accountCountdownTimer = setInterval(updateAccountCountdowns, 30_000);
}

function closeAccountsDialog() {
  if (state.accountsApplying) return;
  clearAccountLoginPoll();
  clearInterval(state.accountCountdownTimer);
  state.accountCountdownTimer = null;
  elements.accountsDialog.close();
  elements.profileTrigger.focus();
}

function closeSessionMenu({ restoreFocus = false } = {}) {
  elements.sessionMenu.hidden = true;
  elements.sessionActions.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.sessionActions.focus();
}

function toggleSessionMenu() {
  if (!elements.sessionMenu.hidden) { closeSessionMenu({ restoreFocus: true }); return; }
  positionBelow(elements.sessionActions, elements.sessionMenu);
  elements.sessionActions.setAttribute("aria-expanded", "true");
  elements.sessionMenu.querySelector("button")?.focus();
}

function closeContextMenu({ restoreFocus = false } = {}) {
  elements.contextMenu.hidden = true;
  elements.contextTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.contextTrigger.focus();
}

function toggleContextMenu() {
  if (!elements.contextMenu.hidden) {
    closeContextMenu({ restoreFocus: true });
    return;
  }
  renderContextStats();
  positionBelow(elements.contextTrigger, elements.contextMenu);
  elements.contextTrigger.setAttribute("aria-expanded", "true");
  void refreshContextStats();
}

const APPROVAL_MODE_DETAILS = Object.freeze({
  "read-only": {
    label: "Read Only",
    paths: [
      "M10 2.75 16 5v4.5c0 3.7-2.35 6.35-6 7.75-3.65-1.4-6-4.05-6-7.75V5z",
      "m7.25 9.75 1.75 1.75 3.75-4",
    ],
  },
  "workspace-write": {
    label: "Workspace Write",
    viewBox: "0 0 16 16",
    filled: true,
    paths: [
      "M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z",
      "M11.3525 5.64688V6.85688H5V5.64688H11.3525Z",
      "M9.5824 8.29376V9.50376H5V8.29376H9.5824Z",
      "M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z",
      "M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z",
    ],
  },
  "full-access": {
    label: "Full Access",
    paths: ["M10 2.75 16 5v4.5c0 3.7-2.35 6.35-6 7.75-3.65-1.4-6-4.05-6-7.75V5z", "M10 6.5v4M10 13.5h.01"],
  },
});

function approvalModeIcon(detail) {
  const icon = sessionActionIcon(detail.paths);
  if (detail.viewBox) icon.setAttribute("viewBox", detail.viewBox);
  if (detail.filled) {
    icon.classList.add("approval-filled-icon");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("fill", "none");
    icon.querySelectorAll("path").forEach((path) => path.setAttribute("fill", "currentColor"));
  }
  return icon;
}

function renderApprovalMode() {
  const detail = APPROVAL_MODE_DETAILS[state.approvalMode];
  elements.permissionStatus.querySelector("span").textContent = detail.label;
  elements.permissionStatus.setAttribute("aria-label", `Tool access mode: ${detail.label}`);
  elements.permissionStatus.querySelector("svg").replaceWith(approvalModeIcon(detail));
  elements.approvalMenu.querySelectorAll("[data-approval-mode]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.approvalMode === state.approvalMode));
  });
}

function closeApprovalMenu({ restoreFocus = false } = {}) {
  elements.approvalMenu.hidden = true;
  elements.permissionStatus.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.permissionStatus.focus();
}

function toggleApprovalMenu() {
  if (!elements.approvalMenu.hidden) { closeApprovalMenu({ restoreFocus: true }); return; }
  renderApprovalMode();
  positionAbove(elements.permissionStatus, elements.approvalMenu, { align: "left", gap: 8 });
  elements.permissionStatus.setAttribute("aria-expanded", "true");
  elements.approvalMenu.querySelector("button")?.focus();
}

async function syncApprovalMode() {
  await api("/api/approval-mode", { method: "POST", body: { mode: state.approvalMode } });
}

async function selectApprovalMode(mode) {
  const previous = state.approvalMode;
  state.approvalMode = mode;
  renderApprovalMode();
  closeApprovalMenu({ restoreFocus: true });
  try {
    writeApprovalMode(localStorage, mode);
    await syncApprovalMode();
  } catch (error) {
    state.approvalMode = previous;
    renderApprovalMode();
    try { writeApprovalMode(localStorage, previous); } catch {}
    showToast(error.message, "error");
  }
}

function closeViewMenu({ restoreFocus = false } = {}) {
  elements.viewMenu.hidden = true;
  elements.viewOptions.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.viewOptions.focus();
}

function updateViewMenuChecks() {
  elements.viewMenu.querySelectorAll("[data-view-group]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.viewGroup === state.sessionView.groupBy));
  });
  elements.viewMenu.querySelectorAll("[data-view-order]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.viewOrder === state.sessionView.orderBy));
  });
}

function setSessionView(preference) {
  state.sessionView = preference;
  state.visibleSessionLimit = SESSION_BATCH_SIZE;
  state.expandedWorkspaces.clear();
  try { writeSessionView(localStorage, preference); }
  catch { showToast("Session view preference could not be saved.", "error"); }
  updateViewMenuChecks();
  renderSessions();
  closeViewMenu({ restoreFocus: true });
}

function toggleViewMenu() {
  if (!elements.viewMenu.hidden) {
    closeViewMenu({ restoreFocus: true });
    return;
  }
  updateViewMenuChecks();
  positionBelow(elements.viewOptions, elements.viewMenu);
  elements.viewOptions.setAttribute("aria-expanded", "true");
  elements.viewMenu.querySelector("button")?.focus();
}

function closeModelDialog({ restoreFocus = false } = {}) {
  if (elements.modelDialog.open) elements.modelDialog.close();
  elements.modelTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.modelTrigger.focus();
}

function recordModelDialogSelection() {
  state.modelDialogSelectionCount += 1;
  if (state.modelDialogSelectionCount < 2) return false;
  closeModelDialog({ restoreFocus: true });
  return true;
}

function modelLabel(model) {
  return model?.name || model?.id || "Unnamed model";
}

function modelGroup(provider) {
  const group = document.createElement("div");
  group.className = "popup-group";
  group.textContent = provider || "Other";
  return group;
}

async function selectModel(option, model) {
  if (state.loadingAttachments) {
    showToast("Wait for attached images to finish loading before changing models.", "error");
    return;
  }
  if (state.attachments.length > 0 && !modelAcceptsImages(model)) {
    showToast("Remove attached images before selecting a text-only model.", "error");
    return;
  }
  option.disabled = true;
  try {
    const modelUpdateResult = await api("/api/command", { method: "POST", body: { type: "set_model", provider: model.provider, modelId: model.id } });
    const selectedModel = modelUpdateResult.data ?? model;
    const runtimeState = await api("/api/state");
    const nextState = { ...runtimeState, model: selectedModel };
    if (runtimeState.active) updateRuntime(nextState);
    else updateModelState(nextState);
    await loadThinkingLevels();
    renderModelOptions();
    if (!recordModelDialogSelection()) {
      elements.modelOptions.querySelector('[aria-selected="true"]')?.focus();
    }
  } catch (error) {
    showToast(error.message, "error");
    option.disabled = false;
  }
}

function modelOption(model) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "popup-option";
  option.setAttribute("role", "option");
  const selected = model.provider === state.currentModel?.provider && model.id === state.currentModel?.id;
  option.setAttribute("aria-selected", String(selected));
  const label = document.createElement("span");
  label.textContent = modelLabel(model);
  const detail = document.createElement("small");
  detail.textContent = model.id;
  option.append(label, detail);
  option.addEventListener("click", () => { void selectModel(option, model); });
  return option;
}

function renderModelOptions() {
  const query = elements.modelSearch.value.trim().toLocaleLowerCase();
  const visibleModels = state.availableModels.filter((model) =>
    [model.provider, model.id, model.name].some((field) => field?.toLocaleLowerCase().includes(query)));
  elements.modelOptions.replaceChildren();
  let currentProvider;
  for (const model of visibleModels) {
    if (model.provider !== currentProvider) {
      currentProvider = model.provider;
      elements.modelOptions.append(modelGroup(currentProvider));
    }
    elements.modelOptions.append(modelOption(model));
  }
  if (visibleModels.length > 0) return;
  const empty = document.createElement("p");
  empty.className = "session-preview";
  empty.textContent = "No matching models";
  elements.modelOptions.append(empty);
}

function renderThinkingOptions() {
  elements.thinkingSubmenu.replaceChildren();
  for (const level of state.thinkingLevels) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "popup-option";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(level === state.thinkingLevel));
    option.textContent = level;
    option.addEventListener("click", async () => {
      option.disabled = true;
      try {
        await api("/api/command", { method: "POST", body: { type: "set_thinking_level", level } });
        const runtimeState = await api("/api/state");
        if (runtimeState.active) updateRuntime(runtimeState);
        else updateModelState(runtimeState);
        renderThinkingOptions();
        if (!recordModelDialogSelection()) {
          elements.thinkingSubmenu.querySelector('[aria-checked="true"]')?.focus();
        }
      } catch (error) {
        showToast(error.message, "error");
        option.disabled = false;
      }
    });
    elements.thinkingSubmenu.append(option);
  }
}

async function loadThinkingLevels() {
  const thinkingLevelsResult = await api("/api/command", { method: "POST", body: { type: "get_available_thinking_levels" } });
  state.thinkingLevels = thinkingLevelsResult.data?.levels ?? ["off"];
  renderThinkingOptions();
}

async function openModelDialog() {
  if (elements.modelDialog.open) {
    closeModelDialog({ restoreFocus: true });
    return;
  }
  state.modelDialogSelectionCount = 0;
  elements.modelTrigger.setAttribute("aria-expanded", "true");
  elements.modelDialog.showModal();
  elements.modelSearch.value = "";
  try {
    const [modelsResult] = await Promise.all([
      api("/api/command", { method: "POST", body: { type: "get_available_models" } }),
      loadThinkingLevels(),
    ]);
    state.availableModels = modelsResult.data?.models ?? [];
    renderModelOptions();
    elements.modelSearch.focus();
  } catch (error) {
    closeModelDialog({ restoreFocus: true });
    showToast(error.message, "error");
  }
}

function closeCommandMenu({ restoreFocus = false } = {}) {
  elements.commandMenu.hidden = true;
  elements.commandsTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.commandsTrigger.focus();
}

function chooseCommand(command) {
  elements.input.value = `/${command.name} `;
  resizeComposer();
  closeCommandMenu();
  elements.input.focus();
}

function commandOption(command) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "command-option";
  option.setAttribute("role", "option");
  const name = document.createElement("strong");
  name.textContent = `/${command.name}`;
  const description = document.createElement("span");
  description.textContent = command.description || `${command.source || "Pi"} command`;
  option.append(name, description);
  option.addEventListener("click", () => chooseCommand(command));
  return option;
}

function renderCommands(commands) {
  elements.commandMenu.replaceChildren(...commands.map(commandOption));
  if (commands.length > 0) return;
  const empty = document.createElement("p");
  empty.className = "session-preview command-empty";
  empty.textContent = "No matching commands";
  elements.commandMenu.append(empty);
}

async function loadCommands() {
  if (state.commands.length > 0) return state.commands;
  const commandsResult = await api("/api/command", { method: "POST", body: { type: "get_commands" } });
  state.commands = commandsResult.data?.commands ?? [];
  return state.commands;
}

function showCommandMenu(commands, { focusFirst = false } = {}) {
  renderCommands(commands);
  elements.commandMenu.style.width = `${elements.composer.getBoundingClientRect().width}px`;
  positionAbove(elements.composer, elements.commandMenu, { align: "left", gap: 8 });
  elements.commandsTrigger.setAttribute("aria-expanded", "true");
  if (focusFirst) elements.commandMenu.querySelector("button")?.focus();
}

async function updateCommandSuggestions() {
  const requestedInput = elements.input.value;
  const match = requestedInput.match(/^\/([^\s]*)$/);
  if (!match) { closeCommandMenu(); return; }
  try {
    const commands = await loadCommands();
    if (elements.input.value !== requestedInput) return;
    const query = match[1].toLocaleLowerCase();
    showCommandMenu(commands.filter((command) =>
      [command.name, command.description].some((field) => field?.toLocaleLowerCase().includes(query))));
  } catch (error) {
    closeCommandMenu();
    showToast(error.message, "error");
  }
}

async function openCommandMenu() {
  if (!elements.commandMenu.hidden) {
    closeCommandMenu({ restoreFocus: true });
    return;
  }
  if (elements.input.disabled) return;
  try {
    showCommandMenu(await loadCommands(), { focusFirst: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

const HARNESS_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000];

function retryableHarnessError(error) {
  return error instanceof TypeError || error.message === "Authentication required";
}

function announceHarnessWait(error) {
  const authenticationRequired = error.message === "Authentication required";
  setConnection("starting", authenticationRequired ? "Waiting for sign-in" : "Waiting for Pi");
  showToast(authenticationRequired
    ? "Waiting for one-time Pi Harness authentication."
    : "Waiting for Pi Harness to start.", "warn");
}

async function authenticateWhenAvailable() {
  let attempt = 0;
  let announced = false;
  while (true) {
    try {
      await authenticate();
      return;
    } catch (error) {
      if (!retryableHarnessError(error)) throw error;
      if (!announced) announceHarnessWait(error);
      announced = true;
      const delay = HARNESS_RETRY_DELAYS_MS[Math.min(attempt, HARNESS_RETRY_DELAYS_MS.length - 1)];
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function authenticate() {
  const token = decodeURIComponent(location.hash.slice(1));
  if (token) {
    await api("/api/auth", { method: "POST", body: { token } });
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  const sessionsResult = await api("/api/sessions");
  state.sessions = sessionsResult.sessions ?? [];
  await loadAccounts({ force: true });
  if (activeAccount()) void refreshAccountUsage(activeAccount().id);

  let runtimeState;
  try {
    const refreshed = await api("/api/sessions/refresh", { method: "POST", body: {} });
    runtimeState = refreshed.active ? { ...refreshed.state, active: true } : await api("/api/state");
  } catch {
    runtimeState = await api("/api/state");
  }
  if (runtimeState.active) {
    state.activeSessionId = runtimeState.browserSessionId ?? null;
    elements.app.dataset.sessionActive = "true";
    const selected = state.sessions.find((session) => session.id === state.activeSessionId);
    elements.sessionTitle.textContent = runtimeState.sessionName || selected?.name || "New session";
    state.confirmedSessionId = state.activeSessionId;
    state.confirmedSessionTitle = elements.sessionTitle.textContent;
    updateRuntime(runtimeState);
    elements.input.disabled = false;
    elements.send.disabled = false;
    refreshAttachmentAvailability();
    const messages = await api("/api/command", { method: "POST", body: { type: "get_messages" } });
    resetActivity();
    renderMessages(messages.data?.messages ?? []);
    connectEvents();
  } else {
    updateModelState(runtimeState);
    elements.input.disabled = false;
    elements.send.disabled = false;
    refreshAttachmentAvailability();
    elements.input.focus();
  }
  renderSessions();
  await syncApprovalMode();
  setConnection("connected", runtimeState.active ? "Connected" : "Ready");
}

async function requestWorkspace() {
  const selection = await api("/api/workspaces/pick", { method: "POST", body: {} });
  return selection.cancelled ? null : selection.cwd;
}

function setWorkspacePickerBusy(busy) {
  for (const button of [elements.newSession, elements.brandNewSession, elements.addWorkspace, elements.workspacePicker]) {
    button.disabled = busy;
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }
}

async function chooseWorkspace() {
  if (state.workspacePicking) return;
  state.workspacePicking = true;
  setWorkspacePickerBusy(true);
  try {
    const cwd = await requestWorkspace();
    if (cwd) await openSession({ cwd });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.workspacePicking = false;
    setWorkspacePickerBusy(false);
  }
}

function applyTheme(choice) {
  const resolved = choice === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : choice;
  document.body.dataset.theme = resolved;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === choice);
  });
}

setQueueMode(state.queueMode, { persist: false });
renderApprovalMode();

elements.filter.addEventListener("input", () => {
  state.visibleSessionLimit = SESSION_BATCH_SIZE;
  renderSessions();
});
elements.newSession.addEventListener("click", chooseWorkspace);
elements.brandNewSession.addEventListener("click", chooseWorkspace);
elements.addWorkspace.addEventListener("click", chooseWorkspace);
elements.workspacePicker.addEventListener("click", chooseWorkspace);
elements.searchSessions.addEventListener("click", () => {
  const opening = elements.searchWrap.hidden;
  elements.searchWrap.hidden = !opening;
  elements.searchSessions.setAttribute("aria-expanded", String(opening));
  if (opening) elements.filter.focus();
});
elements.viewOptions.addEventListener("click", toggleViewMenu);
elements.sessionActions.addEventListener("click", toggleSessionMenu);
elements.renameSession.addEventListener("click", () => { void renameActiveSession(); });
elements.cloneSession.addEventListener("click", () => { void cloneActiveSession(); });
elements.deleteSession.addEventListener("click", () => { void deleteActiveSession(); });
elements.viewMenu.querySelectorAll("[data-view-group]").forEach((button) => {
  button.addEventListener("click", () => setSessionView({ ...state.sessionView, groupBy: button.dataset.viewGroup }));
});
elements.viewMenu.querySelectorAll("[data-view-order]").forEach((button) => {
  button.addEventListener("click", () => setSessionView({ ...state.sessionView, orderBy: button.dataset.viewOrder }));
});
function moveMenuFocus(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const options = [...event.currentTarget.querySelectorAll("button")];
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const next = (options.indexOf(document.activeElement) + direction + options.length) % options.length;
  event.preventDefault();
  options[next]?.focus();
}

elements.viewMenu.addEventListener("keydown", moveMenuFocus);
elements.approvalMenu.addEventListener("keydown", moveMenuFocus);
elements.profileMenu.addEventListener("keydown", moveMenuFocus);
function setSidebarCollapsed(collapsed) {
  elements.app.dataset.sidebarCollapsed = String(collapsed);
  elements.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  elements.sidebarToggle.setAttribute("aria-label", label);
  elements.sidebarToggle.dataset.tooltip = label;
}
function syncSidebarToViewport() {
  const compact = innerWidth <= 600;
  if (compact === state.compactViewport) return;
  state.compactViewport = compact;
  setSidebarCollapsed(compact);
}
elements.sidebarToggle.addEventListener("click", () => {
  setSidebarCollapsed(elements.app.dataset.sidebarCollapsed !== "true");
});
addEventListener("resize", syncSidebarToViewport);
addEventListener("resize", hideSessionTooltip);
addEventListener("resize", hideIconTooltip);
addEventListener("resize", closeProfileMenu);
elements.sessionList.addEventListener("scroll", hideSessionTooltip, { passive: true });
document.addEventListener("scroll", hideIconTooltip, { capture: true, passive: true });
document.addEventListener("pointerover", (event) => {
  const anchor = event.target.closest?.("[data-tooltip]");
  if (anchor && anchor !== describedIconButton) showIconTooltip(anchor);
});
document.addEventListener("pointerout", (event) => {
  const anchor = event.target.closest?.("[data-tooltip]");
  if (anchor && !anchor.contains(event.relatedTarget)) hideIconTooltip();
});
document.addEventListener("focusin", (event) => {
  const anchor = event.target.closest?.("[data-tooltip]");
  if (anchor) showIconTooltip(anchor);
});
document.addEventListener("focusout", (event) => {
  if (describedIconButton && !describedIconButton.contains(event.relatedTarget)) hideIconTooltip();
});
syncSidebarToViewport();
setDetailsPanelOpen(false);
elements.detailsClose.addEventListener("click", () => setDetailsPanelOpen(false));
elements.profileTrigger.addEventListener("click", toggleProfileMenu);
elements.profileIdentity.addEventListener("click", () => openAccountsDialog());
elements.accountsClose.addEventListener("click", closeAccountsDialog);
elements.accountsDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeAccountsDialog(); });
elements.accountsRefresh.addEventListener("click", () => { void refreshAccountUsage(); });
elements.accountsAdd.addEventListener("click", () => { void startAccountLogin(); });
elements.accountLoginCancel.addEventListener("click", () => { void cancelAccountLogin(); });
elements.commandsTrigger.addEventListener("click", openCommandMenu);
elements.contextTrigger.addEventListener("click", toggleContextMenu);
elements.autoCompaction.addEventListener("click", async () => {
  const previous = state.autoCompactionEnabled;
  const enabled = !previous;
  state.autoCompactionEnabled = enabled;
  renderContextStats();
  try {
    await api("/api/command", { method: "POST", body: { type: "set_auto_compaction", enabled } });
  } catch (error) {
    state.autoCompactionEnabled = previous;
    renderContextStats();
    showToast(error.message, "error");
  }
});
elements.compactNow.addEventListener("click", async () => {
  if (state.compacting || state.streaming) return;
  state.compacting = true;
  renderContextStats();
  try {
    await api("/api/command", { method: "POST", body: { type: "compact" } });
    await refreshContextStats();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.compacting = false;
    renderContextStats();
  }
});
elements.modelTrigger.addEventListener("click", () => { void openModelDialog(); });
elements.modelDialogClose.addEventListener("click", () => closeModelDialog({ restoreFocus: true }));
elements.modelDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModelDialog({ restoreFocus: true });
});
elements.modelSearch.addEventListener("input", renderModelOptions);
document.addEventListener("pointerdown", (event) => {
  if (!elements.sessionMenu.hidden && !elements.sessionMenu.contains(event.target) && !elements.sessionActions.contains(event.target)) closeSessionMenu();
  if (!elements.commandMenu.hidden && !elements.commandMenu.contains(event.target) && !elements.commandsTrigger.contains(event.target)) closeCommandMenu();
  if (!elements.viewMenu.hidden && !elements.viewMenu.contains(event.target) && !elements.viewOptions.contains(event.target)) closeViewMenu();
  if (!elements.contextMenu.hidden && !elements.contextMenu.contains(event.target) && !elements.contextTrigger.contains(event.target)) closeContextMenu();
  if (!elements.approvalMenu.hidden && !elements.approvalMenu.contains(event.target) && !elements.permissionStatus.contains(event.target)) closeApprovalMenu();
  if (!elements.profileMenu.hidden && !elements.profileMenu.contains(event.target) && !elements.profileTrigger.contains(event.target)) closeProfileMenu();
  if (!elements.providerApiOptions.hidden && !elements.providerApiOptions.contains(event.target) && !elements.providerApi.contains(event.target)) closeProviderApiMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.sessionMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeSessionMenu({ restoreFocus: true }); }
  else if (!elements.commandMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeCommandMenu({ restoreFocus: true }); }
  else if (!elements.viewMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeViewMenu({ restoreFocus: true }); }
  else if (!elements.contextMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeContextMenu({ restoreFocus: true }); }
  else if (!elements.approvalMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeApprovalMenu({ restoreFocus: true }); }
  else if (!elements.profileMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeProfileMenu({ restoreFocus: true }); }
  else if (!elements.providerApiOptions.hidden) { event.preventDefault(); event.stopPropagation(); closeProviderApiMenu({ restoreFocus: true }); }
  else if (state.streaming && !elements.dialog.open && !elements.settingsDialog.open && !elements.accountsDialog.open && !elements.modelDialog.open) {
    event.preventDefault();
    event.stopPropagation();
    void abortRun();
  }
}, true);
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const providerApiOptionButtons = [...elements.providerApiOptions.querySelectorAll("[data-provider-api]")];

function setProviderApi(api, { focus = false } = {}) {
  const selected = providerApiOptionButtons.find((option) => option.dataset.providerApi === api) ?? providerApiOptionButtons[0];
  elements.providerApi.value = selected.dataset.providerApi;
  elements.providerApiLabel.textContent = selected.textContent;
  for (const option of providerApiOptionButtons) option.setAttribute("aria-selected", String(option === selected));
  if (focus) selected.focus();
}

function closeProviderApiMenu({ restoreFocus = false } = {}) {
  elements.providerApiOptions.hidden = true;
  elements.providerApi.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.providerApi.focus();
}

function openProviderApiMenu({ focus = "selected" } = {}) {
  elements.providerApiOptions.hidden = false;
  elements.providerApi.setAttribute("aria-expanded", "true");
  const selectedIndex = providerApiOptionButtons.findIndex((option) => option.getAttribute("aria-selected") === "true");
  const index = focus === "first" ? 0 : focus === "last" ? providerApiOptionButtons.length - 1 : Math.max(0, selectedIndex);
  providerApiOptionButtons[index].focus();
}

function moveProviderApiOption(event) {
  const currentIndex = providerApiOptionButtons.indexOf(event.currentTarget);
  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % providerApiOptionButtons.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + providerApiOptionButtons.length) % providerApiOptionButtons.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = providerApiOptionButtons.length - 1;
  else return;
  event.preventDefault();
  providerApiOptionButtons[nextIndex].focus();
}

function providerActionButton(label, paths, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `provider-action ${className}`.trim();
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.append(sessionActionIcon(paths));
  return button;
}

function providerCredentialLabel(provider) {
  if (provider.credentialType === "oauth") return "OAuth connected";
  if (provider.credentialType === "models_config") return "Key configured in models.json";
  if (provider.credentialConfigured) return "API key saved";
  return "No credential saved";
}

function providerCard(provider) {
  const card = document.createElement("article");
  card.className = "provider-card";
  const copy = document.createElement("div");
  copy.className = "provider-card-copy";
  const heading = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = provider.id;
  const count = document.createElement("span");
  count.textContent = `${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`;
  heading.append(name, count);
  const endpoint = document.createElement("small");
  endpoint.textContent = provider.baseUrl || "Provider override";
  const credential = document.createElement("small");
  credential.className = provider.credentialConfigured ? "provider-credential configured" : "provider-credential";
  credential.textContent = providerCredentialLabel(provider);
  copy.append(heading, endpoint, credential);
  const actions = document.createElement("div");
  actions.className = "provider-card-actions";
  if (provider.editable) {
    const edit = providerActionButton(`Edit ${provider.id}`, ["M5 14.75 5.5 13l7.8-7.8 1.5 1.5L7 16.5H5z", "m12.5 4.5 1-1a1.4 1.4 0 0 1 2 2l-1 1"]);
    edit.addEventListener("click", () => openProviderForm(provider));
    actions.append(edit);
  }
  const remove = providerActionButton(`Remove ${provider.id}`, ["M3.5 5.5h13M8 3.5h4l.75 2H7.25zM5.5 5.5l.75 10h7.5l.75-10M8.25 8.5v4.5M11.75 8.5v4.5"], "danger");
  remove.addEventListener("click", () => { void removeProvider(provider); });
  actions.append(remove);
  card.append(copy, actions);
  return card;
}

function renderProviders() {
  elements.providerList.setAttribute("aria-busy", "false");
  if (state.providers.length > 0) {
    elements.providerList.replaceChildren(...state.providers.map(providerCard));
    return;
  }
  const empty = document.createElement("div");
  empty.className = "provider-empty";
  const title = document.createElement("strong");
  title.textContent = "No custom providers";
  const detail = document.createElement("span");
  detail.textContent = "Add a provider to make its models available in Pi.";
  empty.append(title, detail);
  elements.providerList.replaceChildren(empty);
}

function setProviderRecords(providers) {
  state.providers = Array.isArray(providers) ? providers : [];
  state.providersLoaded = true;
  renderProviders();
}

async function loadProviders({ force = false } = {}) {
  if (state.providersLoading || (state.providersLoaded && !force)) return;
  state.providersLoading = true;
  elements.providerList.setAttribute("aria-busy", "true");
  try {
    const result = await api("/api/providers");
    setProviderRecords(result.providers);
  } catch (error) {
    elements.providerList.setAttribute("aria-busy", "false");
    const message = document.createElement("p");
    message.className = "provider-load-error";
    message.textContent = "Provider settings could not be loaded.";
    elements.providerList.replaceChildren(message);
    showToast(error.message, "error");
  } finally {
    state.providersLoading = false;
  }
}

function providerModelRow(model = {}) {
  const row = document.createElement("fieldset");
  row.className = "provider-model-row";
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = model.id ? `Model ${model.id}` : "Model configuration";
  row.dataset.reasoning = String(model.reasoning === true);
  row.dataset.imageInput = String(model.input?.includes("image") === true);
  const fields = document.createElement("div");
  fields.className = "provider-model-fields";
  const field = (labelText, name, { value = "", type = "text", placeholder = "", required = false } = {}) => {
    const label = document.createElement("label");
    const labelCopy = document.createElement("span");
    labelCopy.textContent = labelText;
    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.required = required;
    if (type === "number") { input.min = "1"; input.max = "10000000"; input.step = "1"; }
    label.append(labelCopy, input);
    return label;
  };
  fields.append(
    field("Model ID", "modelId", { value: model.id, placeholder: "model-id", required: true }),
    field("Display name", "modelName", { value: model.name, placeholder: "Optional" }),
    field("Context window", "contextWindow", { value: model.contextWindow, type: "number", placeholder: "128000" }),
    field("Max output", "maxTokens", { value: model.maxTokens, type: "number", placeholder: "16384" }),
  );
  const remove = providerActionButton("Remove model", ["M4.5 10h11"], "provider-model-remove");
  remove.addEventListener("click", () => {
    if (elements.providerModelList.children.length === 1) return;
    row.remove();
  });
  row.append(legend, fields, remove);
  return row;
}

function closeProviderForm({ restoreFocus = false } = {}) {
  closeProviderApiMenu();
  state.editingProviderId = null;
  elements.providerForm.hidden = true;
  elements.providerList.hidden = false;
  elements.providerAdd.disabled = false;
  elements.providerApiKey.value = "";
  elements.providerModelList.replaceChildren();
  if (restoreFocus) elements.providerAdd.focus();
}

function openProviderForm(provider = null) {
  state.editingProviderId = provider?.id ?? null;
  elements.providerFormTitle.textContent = provider ? `Edit ${provider.id}` : "Add provider";
  elements.providerId.value = provider?.id ?? "";
  elements.providerId.readOnly = Boolean(provider);
  setProviderApi(provider?.api || "openai-completions");
  closeProviderApiMenu();
  elements.providerBaseUrl.value = provider?.baseUrl ?? "";
  elements.providerApiKey.value = "";
  elements.providerApiKey.disabled = provider?.credentialType === "oauth";
  elements.providerKeyHint.textContent = provider?.credentialType === "oauth"
    ? "Managed by Pi OAuth"
    : provider?.credentialConfigured ? "Leave blank to keep the current credential" : "Optional when configured elsewhere";
  elements.providerModelList.replaceChildren(...(provider?.models?.length ? provider.models : [{}]).map(providerModelRow));
  elements.providerFormStatus.textContent = "";
  elements.providerList.hidden = true;
  elements.providerForm.hidden = false;
  elements.providerAdd.disabled = true;
  elements.providerId.focus();
}

function providerFormModels() {
  return [...elements.providerModelList.children].map((row) => {
    const value = (name) => row.querySelector(`[name="${name}"]`).value.trim();
    return {
      id: value("modelId"),
      name: value("modelName"),
      reasoning: row.dataset.reasoning === "true",
      input: row.dataset.imageInput === "true" ? ["text", "image"] : ["text"],
      contextWindow: value("contextWindow"),
      maxTokens: value("maxTokens"),
    };
  });
}

async function saveProvider(event) {
  event.preventDefault();
  if (state.providersApplying || !elements.providerForm.reportValidity()) return;
  state.providersApplying = true;
  elements.providerSave.disabled = true;
  elements.providerFormStatus.textContent = "Saving and reloading Pi…";
  const apiKey = elements.providerApiKey.value;
  const body = {
    provider: {
      id: elements.providerId.value.trim(),
      baseUrl: elements.providerBaseUrl.value.trim(),
      api: elements.providerApi.value,
      models: providerFormModels(),
    },
    credentialAction: apiKey ? "replace" : "preserve",
    ...(apiKey ? { apiKey } : {}),
  };
  elements.providerApiKey.value = "";
  try {
    const result = await api("/api/providers/apply", { method: "POST", body });
    setProviderRecords(result.providers);
    closeProviderForm({ restoreFocus: true });
    if (result.reloaded) updateRuntime(await api("/api/state"));
    showToast(result.reloaded ? "Provider saved and Pi reloaded." : "Provider saved for new Pi sessions.");
  } catch (error) {
    elements.providerFormStatus.textContent = "Provider was not saved";
    showToast(error.message, "error");
  } finally {
    state.providersApplying = false;
    elements.providerSave.disabled = false;
  }
}

function localProviderRemovalDialog(provider) {
  return new Promise((resolve) => {
    state.dialogOpen = true;
    elements.dialogTitle.textContent = `Remove ${provider.id}?`;
    elements.dialogMessage.textContent = provider.credentialConfigured
      ? "Choose whether Pi should keep its saved credential for later reuse."
      : "This removes the provider and its custom models from Pi.";
    elements.dialogControl.replaceChildren();
    const finish = (result) => {
      elements.dialog.oncancel = null;
      elements.dialog.close();
      elements.dialogActions.replaceChildren();
      state.dialogOpen = false;
      resolve(result);
      showNextDialog();
    };
    const actions = [dialogButton("Cancel", "", () => finish(null))];
    if (provider.credentialConfigured) actions.push(dialogButton("Keep credential", "", () => finish(false)));
    actions.push(dialogButton(provider.credentialConfigured ? "Delete credential" : "Remove", "danger", () => finish(provider.credentialConfigured)));
    elements.dialogActions.replaceChildren(...actions);
    elements.dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
    elements.dialog.showModal();
  });
}

async function removeProvider(provider) {
  const deleteCredential = await localProviderRemovalDialog(provider);
  if (deleteCredential === null) return;
  state.providersApplying = true;
  try {
    const result = await api("/api/providers/remove", {
      method: "POST",
      body: { providerId: provider.id, deleteCredential },
    });
    setProviderRecords(result.providers);
    elements.providerAdd.focus();
    if (state.currentModel?.provider?.trim().toLowerCase() === provider.id) state.currentModel = null;
    const runtimeState = await api("/api/state");
    if (runtimeState.active) updateRuntime(runtimeState);
    else updateModelState(runtimeState);
    showToast(result.reloaded ? "Provider removed and Pi reloaded." : "Provider removed for new Pi sessions.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.providersApplying = false;
  }
}

function mcpSourceLabel(source) {
  const scope = source.scope === "project" ? "Project" : source.scope === "agent" ? "Pi agent" : "Global";
  return `${scope} · ${source.file}`;
}

function mcpActionButton(label, paths, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mcp-action ${className}`.trim();
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.append(sessionActionIcon(paths));
  return button;
}

function mcpStatusCopy(server) {
  const tested = state.mcpTestResults.get(server.name);
  if (tested?.ok) return `${tested.toolCount} tool${tested.toolCount === 1 ? "" : "s"} available`;
  if (tested && !tested.ok) return tested.error || "Connection failed";
  if (server.config.disabled) return "Turned off";
  return "Ready to connect";
}

function mcpShadowDefinitions(server) {
  if (!server.duplicate) return null;
  const details = document.createElement("details");
  details.className = "mcp-shadows";
  const summary = document.createElement("summary");
  summary.textContent = `${server.shadowedCount} other definition${server.shadowedCount === 1 ? "" : "s"}`;
  const list = document.createElement("div");
  for (const definition of server.definitions.filter((entry) => !entry.effective)) {
    const row = document.createElement("span");
    row.textContent = `${mcpSourceLabel(definition.source)} · shadowed`;
    list.append(row);
  }
  details.append(summary, list);
  return details;
}

async function testMcpServer(server) {
  if (state.mcpApplying || state.mcpLoading) return;
  const generation = state.mcpTestGeneration;
  state.mcpApplying = true;
  syncMcpBusyState();
  try {
    const result = await api("/api/mcp/test", { method: "POST", body: { name: server.name, sourceId: server.source.id } });
    if (generation !== state.mcpTestGeneration) return;
    state.mcpTestResults.set(server.name, result);
    renderMcpServers();
    showToast(result.ok ? `${server.name} connected.` : result.error, result.ok ? "info" : "error");
  } catch (error) { showToast(error.message, "error"); }
  finally {
    state.mcpApplying = false;
    syncMcpBusyState();
  }
}

async function mutateMcp(request, successMessage) {
  if (state.mcpApplying || state.mcpLoading) return null;
  state.mcpApplying = true;
  state.mcpTestGeneration += 1;
  syncMcpBusyState();
  try {
    const result = await api("/api/mcp/mutate", { method: "POST", body: request });
    setMcpSnapshot(result.snapshot);
    if (result.test) state.mcpTestResults.set(result.test.server, result.test);
    showToast(`${successMessage}${result.reloaded ? " Other Pi sessions need /mcp reload." : ""}`);
    return result;
  } catch (error) {
    showToast(error.message, "error");
    await loadMcpSettings({ force: true });
    return null;
  } finally {
    state.mcpApplying = false;
    syncMcpBusyState();
  }
}

async function toggleMcpServer(server, toggle) {
  toggle.disabled = true;
  await mutateMcp({ action: "toggle", name: server.name, sourceId: server.source.id, enabled: server.config.disabled },
    `${server.name} ${server.config.disabled ? "enabled" : "disabled"}.`);
}

function mcpInlineSecretKeys(server) {
  return [...(server.config.env ?? []), ...(server.config.headers ?? [])]
    .filter((row) => row.inline)
    .map((row) => ({ location: (server.config.env ?? []).includes(row) ? "env" : "headers", key: row.key }));
}

async function migrateMcpSecrets(server) {
  const confirmed = await localConfirmDialog({
    title: `Move ${server.name} secrets?`,
    message: "Move detected inline credentials into Pi's private MCP credential file. Comments and ordinary settings stay in place.",
    confirmLabel: "Move secrets",
  });
  if (!confirmed) return;
  await mutateMcp({ action: "migrate-inline-secrets", name: server.name, sourceId: server.source.id, keys: mcpInlineSecretKeys(server) },
    `${server.name} credentials moved to private storage.`);
}

function localMcpRemovalDialog(server) {
  return new Promise((resolve) => {
    state.dialogOpen = true;
    elements.dialogTitle.textContent = `Remove ${server.name}?`;
    const revealed = server.definitions?.filter((definition) => !definition.effective).at(-1);
    elements.dialogMessage.textContent = revealed
      ? `This removes the effective definition. ${server.name} from ${mcpSourceLabel(revealed.source)} will become active.`
      : "Remove this MCP server definition?";
    elements.dialogControl.replaceChildren();
    const finish = (result) => {
      elements.dialog.oncancel = null;
      elements.dialog.close();
      elements.dialogActions.replaceChildren();
      state.dialogOpen = false;
      resolve(result);
      showNextDialog();
    };
    const actions = [dialogButton("Cancel", "", () => finish(null))];
    if (server.credentialCount > 0) actions.push(dialogButton("Keep credentials", "", () => finish(false)));
    actions.push(dialogButton(server.credentialCount > 0 ? "Delete credentials" : "Remove", "danger", () => finish(server.credentialCount > 0)));
    elements.dialogActions.replaceChildren(...actions);
    elements.dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
    elements.dialog.showModal();
  });
}

async function removeMcpServer(server) {
  const deleteCredentials = await localMcpRemovalDialog(server);
  if (deleteCredentials === null) return;
  const result = await mutateMcp({ action: "remove", name: server.name, sourceId: server.source.id, deleteCredentials }, `${server.name} removed.`);
  if (result?.revealed) showToast(`${result.revealed.name} now resolves from ${mcpSourceLabel(result.revealed.source)}.`, "warn");
}

function mcpServerCard(server) {
  const card = document.createElement("article");
  card.className = "mcp-card";
  card.dataset.enabled = String(!server.config.disabled);
  const heading = document.createElement("div");
  heading.className = "mcp-card-heading";
  const copy = document.createElement("div");
  copy.className = "mcp-card-copy";
  const name = document.createElement("strong");
  name.textContent = server.name;
  const badge = document.createElement("span");
  badge.textContent = server.config.managed ? "Managed" : server.config.transport === "stdio" ? "Stdio" : "HTTP";
  const source = document.createElement("small");
  source.textContent = mcpSourceLabel(server.source);
  const status = document.createElement("small");
  status.className = `mcp-card-status${state.mcpTestResults.get(server.name)?.ok ? " connected" : ""}`;
  status.textContent = mcpStatusCopy(server);
  copy.append(name, badge, source, status);
  const actions = document.createElement("div");
  actions.className = "mcp-card-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "extension-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", `${server.config.disabled ? "Enable" : "Disable"} ${server.name}`);
  toggle.setAttribute("aria-checked", String(!server.config.disabled));
  toggle.disabled = state.mcpApplying;
  toggle.addEventListener("click", () => { void toggleMcpServer(server, toggle); });
  const test = mcpActionButton(`Test ${server.name}`, ["M4 10h2.25l1.5 3.25L11 6l1.75 4H16"], "mcp-test");
  test.disabled = state.mcpApplying;
  test.addEventListener("click", () => { void testMcpServer(server, card); });
  actions.append(toggle, test);
  if (!server.config.managed) {
    const edit = mcpActionButton(`Edit ${server.name}`, ["M5 14.75 5.5 13l7.8-7.8 1.5 1.5L7 16.5H5z", "m12.5 4.5 1-1a1.4 1.4 0 0 1 2 2l-1 1"]);
    edit.disabled = state.mcpApplying;
    edit.addEventListener("click", () => openMcpForm(server));
    const remove = mcpActionButton(`Remove ${server.name}`, ["M3.5 5.5h13M8 3.5h4l.75 2H7.25zM5.5 5.5l.75 10h7.5l.75-10M8.25 8.5v4.5M11.75 8.5v4.5"], "danger");
    remove.disabled = state.mcpApplying;
    remove.addEventListener("click", () => { void removeMcpServer(server); });
    actions.append(edit, remove);
  }
  heading.append(copy, actions);
  card.append(heading);
  const inlineKeys = mcpInlineSecretKeys(server);
  if (inlineKeys.length > 0) {
    const warning = document.createElement("button");
    warning.type = "button";
    warning.className = "mcp-migrate";
    warning.disabled = state.mcpApplying;
    warning.textContent = `${inlineKeys.length} inline secret${inlineKeys.length === 1 ? "" : "s"} · Move to private storage`;
    warning.addEventListener("click", () => { void migrateMcpSecrets(server); });
    card.append(warning);
  }
  const shadows = mcpShadowDefinitions(server);
  if (shadows) card.append(shadows);
  return card;
}

function renderMcpDiagnostics() {
  elements.mcpDiagnostics.hidden = state.mcpDiagnostics.length === 0;
  elements.mcpDiagnostics.replaceChildren(...state.mcpDiagnostics.map((diagnostic) => {
    const row = document.createElement("p");
    row.textContent = `${diagnostic.source?.file ?? "MCP config"}: ${diagnostic.message}`;
    return row;
  }));
}

function syncMcpBusyState() {
  const surfaceBusy = state.mcpApplying || state.mcpLoading;
  for (const control of elements.mcpForm.querySelectorAll("button, input")) control.disabled = surfaceBusy;
  if (!surfaceBusy) document.querySelector('[data-mcp-scope="project"]').disabled = !state.mcpProjectAvailable;
  elements.settingsClose.disabled = state.mcpApplying;
  elements.settingsTrigger.disabled = state.mcpApplying;
  elements.profileTrigger.disabled = state.mcpApplying;
  for (const tab of settingsTabs) tab.disabled = state.mcpApplying;
  renderMcpServers();
}

function renderMcpServers() {
  elements.mcpList.setAttribute("aria-busy", state.mcpLoading ? "true" : "false");
  elements.mcpAdd.disabled = state.mcpApplying || state.mcpLoading || !elements.mcpForm.hidden;
  elements.mcpExtensionWarning.hidden = state.mcpExtensionEnabled;
  renderMcpDiagnostics();
  if (state.mcpServers.length > 0) elements.mcpList.replaceChildren(...state.mcpServers.map(mcpServerCard));
  else {
    const empty = document.createElement("div");
    empty.className = "mcp-empty";
    const title = document.createElement("strong");
    title.textContent = "No MCP servers";
    const detail = document.createElement("span");
    detail.textContent = "Add a local command or Streamable HTTP endpoint.";
    empty.append(title, detail);
    elements.mcpList.replaceChildren(empty);
  }
}

function setMcpSnapshot(snapshot) {
  state.mcpTestGeneration += 1;
  state.mcpTestResults.clear();
  state.mcpServers = Array.isArray(snapshot.servers) ? snapshot.servers : [];
  state.mcpDiagnostics = Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : [];
  state.mcpProjectAvailable = snapshot.projectAvailable ?? state.mcpProjectAvailable;
  state.mcpExtensionEnabled = snapshot.extensionEnabled ?? state.mcpExtensionEnabled;
  state.mcpLoaded = true;
  renderMcpServers();
}

async function loadMcpSettings({ force = false } = {}) {
  if (state.mcpLoading || (state.mcpLoaded && !force)) return;
  state.mcpLoading = true;
  syncMcpBusyState();
  try { setMcpSnapshot(await api("/api/mcp")); }
  catch (error) {
    elements.mcpList.setAttribute("aria-busy", "false");
    showToast(error.message, "error");
  } finally {
    state.mcpLoading = false;
    syncMcpBusyState();
  }
}

function setMcpSegment(selector, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.mcpTransport === value || button.dataset.mcpScope === value));
  });
}

function setMcpTransport(transport) {
  if (state.mcpTransport !== transport && elements.mcpValues.children.length > 0) {
    for (const row of elements.mcpValues.querySelectorAll(".mcp-value-row")) {
      if (row.dataset.originalKey) state.mcpRemovedValues.push({
        location: row.dataset.location,
        key: row.dataset.originalKey,
        private: row.dataset.originalPrivate === "true",
      });
    }
    elements.mcpValues.replaceChildren();
    elements.mcpFormStatus.textContent = "Environment or header rows were cleared for the new transport.";
  }
  state.mcpTransport = transport;
  setMcpSegment("[data-mcp-transport]", transport);
  elements.mcpStdioFields.hidden = transport !== "stdio";
  elements.mcpHttpFields.hidden = transport !== "streamable-http";
  const editingSameTransport = state.editingMcpServer?.config.transport === transport;
  elements.mcpCommand.required = transport === "stdio" && !(editingSameTransport && state.editingMcpServer.config.commandMasked);
  elements.mcpUrl.required = transport === "streamable-http" && !(editingSameTransport && state.editingMcpServer.config.urlMasked);
  elements.mcpValuesTitle.textContent = transport === "stdio" ? "Environment variables" : "HTTP headers";
  elements.mcpAddValue.textContent = transport === "stdio" ? "Add variable" : "Add header";
}

function setMcpScope(scope) {
  state.mcpScope = scope;
  setMcpSegment("[data-mcp-scope]", scope);
}

function mcpRemoveRowButton(label) {
  const remove = mcpActionButton(label, ["M4.5 10h11"]);
  remove.classList.add("mcp-row-remove");
  return remove;
}

function mcpArgumentRow(value = "") {
  const row = document.createElement("div");
  row.className = "mcp-argument-row";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 16384;
  input.value = value;
  input.placeholder = "Argument";
  const remove = mcpRemoveRowButton("Remove argument");
  remove.addEventListener("click", () => row.remove());
  row.append(input, remove);
  return row;
}

function mcpValueRow(value = {}, location = state.mcpTransport === "stdio" ? "env" : "headers") {
  const row = document.createElement("div");
  row.className = "mcp-value-row";
  row.dataset.location = location;
  row.dataset.originalKey = value.key ?? "";
  row.dataset.originalPrivate = String(value.private === true);
  row.dataset.originalInline = String(value.inline === true);
  row.dataset.originalMasked = String(value.masked === true);
  const incompatible = (state.mcpTransport === "stdio" && location === "headers")
    || (state.mcpTransport === "streamable-http" && location === "env");
  if (incompatible) {
    row.classList.add("incompatible");
    row.title = `Legacy ${location === "env" ? "environment variable" : "HTTP header"} is incompatible with this transport; remove it to repair the server.`;
  }
  const key = document.createElement("input");
  key.type = "text";
  key.maxLength = 128;
  key.value = value.key ?? "";
  key.placeholder = location === "env" ? "VARIABLE_NAME" : "Header-Name";
  key.readOnly = Boolean(value.private || value.inline || value.masked);
  const field = document.createElement("input");
  field.type = value.private || value.inline ? "password" : "text";
  field.maxLength = 16384;
  field.value = value.masked ? "" : value.value ?? "";
  field.placeholder = value.private ? "Saved secret — leave blank to keep" : value.inline ? "Inline secret — migrate before editing" : value.masked ? "Configured — enter to replace" : "Value";
  const secret = document.createElement("button");
  secret.type = "button";
  secret.className = "mcp-secret-toggle";
  secret.setAttribute("role", "switch");
  secret.setAttribute("aria-checked", String(value.private || value.inline));
  secret.textContent = "Secret";
  secret.addEventListener("click", () => {
    const enabled = secret.getAttribute("aria-checked") !== "true";
    secret.setAttribute("aria-checked", String(enabled));
    field.type = enabled ? "password" : "text";
  });
  const remove = mcpRemoveRowButton(`Remove ${location === "env" ? "variable" : "header"}`);
  remove.addEventListener("click", () => {
    if (row.dataset.originalKey) state.mcpRemovedValues.push({
      location: row.dataset.location,
      key: row.dataset.originalKey,
      private: row.dataset.originalPrivate === "true",
    });
    row.remove();
  });
  row.append(key, field, secret, remove);
  return row;
}

function closeMcpForm({ restoreFocus = false, force = false } = {}) {
  if (state.mcpApplying && !force) return;
  state.editingMcpServer = null;
  state.mcpRemovedValues = [];
  elements.mcpForm.hidden = true;
  elements.mcpList.hidden = false;
  elements.mcpAdd.disabled = state.mcpLoading || state.mcpApplying;
  elements.mcpArguments.replaceChildren();
  elements.mcpValues.replaceChildren();
  if (restoreFocus) elements.mcpAdd.focus();
}

function openMcpForm(server = null) {
  if (state.mcpApplying || state.mcpLoading) return;
  state.editingMcpServer = server;
  state.mcpRemovedValues = [];
  elements.mcpFormTitle.textContent = server ? `Edit ${server.name}` : "Add MCP server";
  elements.mcpFormDescription.textContent = server ? mcpSourceLabel(server.source) : "Configure a stdio command or Streamable HTTP endpoint.";
  elements.mcpName.value = server?.name ?? "";
  elements.mcpName.readOnly = false;
  elements.mcpScopeField.hidden = Boolean(server);
  const defaultScope = state.mcpProjectAvailable ? "project" : "global";
  setMcpScope(server?.source.scope === "project" ? "project" : defaultScope);
  const projectButton = document.querySelector('[data-mcp-scope="project"]');
  projectButton.disabled = !state.mcpProjectAvailable;
  setMcpTransport(server?.config.transport ?? "stdio");
  const command = server?.config.command ?? [];
  elements.mcpCommand.value = server?.config.commandMasked ? "" : command[0] ?? "";
  elements.mcpCommand.placeholder = server?.config.commandMasked ? "Configured command — enter to replace" : "npx";
  elements.mcpCwd.value = server?.config.cwdMasked ? "" : server?.config.cwd ?? "";
  elements.mcpCwd.placeholder = server?.config.cwdMasked ? "Configured directory — enter to replace" : "Use the active project";
  elements.mcpUrl.value = server?.config.urlMasked ? "" : server?.config.url ?? "";
  elements.mcpUrl.placeholder = server?.config.urlMasked ? "Configured URL — enter to replace" : "https://tools.example.com/mcp";
  elements.mcpArguments.replaceChildren(...(server?.config.commandMasked ? [] : command.slice(1).map(mcpArgumentRow)));
  const environmentRows = (server?.config.env ?? []).map((row) => mcpValueRow(row, "env"));
  const headerRows = (server?.config.headers ?? []).map((row) => mcpValueRow(row, "headers"));
  elements.mcpValues.replaceChildren(...environmentRows, ...headerRows);
  elements.mcpEnabled.setAttribute("aria-checked", String(!server?.config.disabled));
  const incompatibleCount = elements.mcpValues.querySelectorAll(".incompatible").length;
  elements.mcpFormStatus.textContent = incompatibleCount
    ? `${incompatibleCount} legacy credential row${incompatibleCount === 1 ? " is" : "s are"} incompatible with this transport; remove before saving.`
    : "";
  elements.mcpList.hidden = true;
  elements.mcpForm.hidden = false;
  elements.mcpAdd.disabled = true;
  elements.mcpName.focus();
}

function mcpCredentialRowId(location, key) {
  return `${location}:${location === "headers" ? key.toLowerCase() : key}`;
}

function mcpFormRows() {
  const configValues = { env: {}, headers: {} };
  const credentials = [];
  for (const row of elements.mcpValues.querySelectorAll(".mcp-value-row")) {
    const [keyInput, valueInput] = row.querySelectorAll("input");
    const key = keyInput.value.trim();
    const value = valueInput.value;
    if (!key) continue;
    const location = row.dataset.location;
    const secret = row.querySelector(".mcp-secret-toggle").getAttribute("aria-checked") === "true";
    const originalPrivate = row.dataset.originalPrivate === "true";
    const originalInline = row.dataset.originalInline === "true";
    const originalKey = row.dataset.originalKey;
    if (originalKey && originalKey !== key && !originalPrivate && !originalInline && row.dataset.originalMasked !== "true") {
      state.mcpRemovedValues.push({ location, key: originalKey, private: false });
    }
    if (secret) {
      if (value) credentials.push({ location, key, action: "replace", value });
      else if (originalPrivate) credentials.push({ location, key, action: "preserve" });
      if (value && originalKey && !originalPrivate) state.mcpRemovedValues.push({ location, key: originalKey, private: false });
      if (!value && !originalPrivate && !originalInline) continue;
    } else {
      if (originalPrivate && !value) throw new TypeError(`Enter a replacement value before making ${key} non-secret`);
      if (value) configValues[location][key] = value;
    }
    if (!secret && originalPrivate) credentials.push({ location, key: originalKey || key, action: "delete" });
  }
  for (const removed of state.mcpRemovedValues) {
    if (removed.private) credentials.push({ location: removed.location, key: removed.key, action: "delete" });
  }
  const credentialMap = new Map();
  for (const credential of credentials) {
    const id = mcpCredentialRowId(credential.location, credential.key);
    const existing = credentialMap.get(id);
    if (credential.action === "delete" && existing && existing.action !== "delete") continue;
    credentialMap.set(id, credential);
  }
  return { configValues, credentials: [...credentialMap.values()] };
}

function mcpFormRequest() {
  const editing = state.editingMcpServer;
  const enabled = elements.mcpEnabled.getAttribute("aria-checked") === "true";
  const { configValues, credentials } = mcpFormRows();
  const config = { transport: state.mcpTransport, disabled: !enabled };
  const clearFields = state.mcpTransport === "stdio"
    ? ["url", "headers"]
    : ["command", "args", "env", "environment", "cwd"];
  if (state.mcpTransport === "stdio") {
    if (elements.mcpCommand.value.trim()) config.command = elements.mcpCommand.value.trim();
    const args = [...elements.mcpArguments.querySelectorAll("input")].map((input) => input.value).filter(Boolean);
    if (args.length > 0 || elements.mcpCommand.value.trim()) config.args = args;
    if (elements.mcpCwd.value.trim()) config.cwd = elements.mcpCwd.value.trim();
    if (Object.keys(configValues.env).length > 0) config[state.editingMcpServer?.config.envField ?? "env"] = configValues.env;
  } else {
    if (elements.mcpUrl.value.trim()) config.url = elements.mcpUrl.value.trim();
    if (Object.keys(configValues.headers).length > 0) config.headers = configValues.headers;
  }
  const clearValues = state.mcpRemovedValues
    .filter((row) => !row.private && !Object.keys(configValues[row.location]).some((key) => mcpCredentialRowId(row.location, key) === mcpCredentialRowId(row.location, row.key)))
    .map(({ location, key }) => ({ location, key }));
  if (!editing) return { action: "add", name: elements.mcpName.value.trim(), target: state.mcpScope, config, credentials };
  const name = editing.name;
  return {
    action: "update",
    name,
    sourceId: editing.source.id,
    newName: elements.mcpName.value.trim(),
    config,
    credentials,
    clearFields,
    clearValues,
  };
}

async function saveMcpServer(event) {
  event.preventDefault();
  if (state.mcpApplying || !elements.mcpForm.reportValidity()) return;
  state.mcpApplying = true;
  state.mcpTestGeneration += 1;
  syncMcpBusyState();
  elements.mcpFormStatus.textContent = "Saving, testing, and reloading Pi…";
  try {
    const editing = Boolean(state.editingMcpServer);
    const request = mcpFormRequest();
    const result = await api("/api/mcp/mutate", { method: "POST", body: request });
    setMcpSnapshot(result.snapshot);
    if (result.test) state.mcpTestResults.set(result.test.server, result.test);
    closeMcpForm({ restoreFocus: true, force: true });
    showToast(`${editing ? "MCP server updated." : "MCP server added."}${result.reloaded ? " Other Pi sessions need /mcp reload." : ""}`);
  } catch (error) {
    elements.mcpFormStatus.textContent = error.code === "MCP_CONNECTION_FAILED" ? "Connection failed — turn Enabled off to save without testing" : "MCP server was not saved";
    showToast(error.message, "error");
  } finally {
    state.mcpApplying = false;
    syncMcpBusyState();
  }
}

function extensionsChanged() {
  return state.extensions.some((extension) => (
    state.extensionDraft.get(extension.id) !== state.extensionBaseline.get(extension.id)
  ));
}

function syncExtensionSummary() {
  const enabledCount = [...state.extensionDraft.values()].filter(Boolean).length;
  elements.extensionsCount.textContent = `${enabledCount} of ${state.extensions.length} on`;
  elements.extensionsStatus.textContent = extensionsChanged() ? "Changes not applied" : "All changes applied";
  elements.extensionsApply.disabled = state.extensionsApplying || !extensionsChanged();
}

function setExtensionDraft(extension, enabled, card, toggle) {
  if (state.extensionsApplying && !toggle.disabled) return;
  state.extensionDraft.set(extension.id, enabled);
  card.dataset.enabled = String(enabled);
  toggle.setAttribute("aria-checked", String(enabled));
  syncExtensionSummary();
}

function extensionCard(extension) {
  const card = document.createElement("article");
  card.className = "extension-card";
  const copy = document.createElement("div");
  copy.className = "extension-card-copy";
  const name = document.createElement("strong");
  name.textContent = extension.name;
  const description = document.createElement("span");
  description.textContent = extension.description;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "extension-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", extension.name);
  toggle.disabled = state.extensionsApplying;
  const enabled = state.extensionDraft.get(extension.id);
  toggle.addEventListener("click", () => setExtensionDraft(extension, !state.extensionDraft.get(extension.id), card, toggle));
  copy.append(name, description);
  card.append(copy, toggle);
  setExtensionDraft(extension, enabled, card, toggle);
  return card;
}

function renderExtensions() {
  elements.extensionList.replaceChildren(...state.extensions.map(extensionCard));
  elements.extensionList.setAttribute("aria-busy", "false");
  syncExtensionSummary();
}

function setExtensionRecords(extensions) {
  state.extensions = extensions;
  state.extensionBaseline = new Map(extensions.map((extension) => [extension.id, extension.enabled]));
  state.extensionDraft = new Map(state.extensionBaseline);
  state.extensionsLoaded = true;
  renderExtensions();
}

async function loadExtensions({ force = false } = {}) {
  if (state.extensionsLoading || (state.extensionsLoaded && !force)) return;
  state.extensionsLoading = true;
  elements.extensionList.setAttribute("aria-busy", "true");
  elements.extensionsStatus.textContent = "Loading extensions…";
  try {
    const result = await api("/api/extensions");
    setExtensionRecords(result.extensions);
  } catch (error) {
    elements.extensionsStatus.textContent = "Extensions could not be loaded";
    showToast(error.message, "error");
  } finally {
    state.extensionsLoading = false;
  }
}

function setExtensionTogglesDisabled(disabled) {
  elements.extensionList.querySelectorAll(".extension-toggle").forEach((toggle) => { toggle.disabled = disabled; });
}

async function applyExtensionChanges() {
  if (state.extensionsApplying || !extensionsChanged()) return;
  state.extensionsApplying = true;
  elements.extensionsApply.disabled = true;
  setExtensionTogglesDisabled(true);
  elements.extensionsStatus.textContent = "Applying and reloading Pi…";
  try {
    const enabled = Object.fromEntries(state.extensionDraft);
    const result = await api("/api/extensions/apply", { method: "POST", body: { enabled } });
    setExtensionRecords(result.extensions);
    showToast(result.reloaded ? "Extensions applied and Pi reloaded." : "Extensions saved for new Pi sessions.");
  } catch (error) {
    await loadExtensions({ force: true });
    showToast(error.message, "error");
  } finally {
    state.extensionsApplying = false;
    setExtensionTogglesDisabled(false);
    syncExtensionSummary();
  }
}

function activateSettingsTab(tab) {
  for (const button of settingsTabs) {
    const active = button === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsTab;
  });
  if (tab.dataset.settingsTab === "archive") renderArchivedSessions();
  if (tab.dataset.settingsTab === "models") void loadProviders();
  if (tab.dataset.settingsTab === "extensions") void loadExtensions();
  if (tab.dataset.settingsTab === "mcp") void loadMcpSettings();
}

function moveSettingsTabFocus(event) {
  const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  let index = settingsTabs.indexOf(event.currentTarget);
  if (offset) index = (index + offset + settingsTabs.length) % settingsTabs.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = settingsTabs.length - 1;
  else return;
  event.preventDefault();
  activateSettingsTab(settingsTabs[index]);
  settingsTabs[index].focus();
}

function closeSettingsDialog() {
  if (state.mcpApplying) return;
  closeProviderForm();
  closeMcpForm();
  elements.settingsDialog.close();
  elements.profileTrigger.focus();
}

elements.dialogForm.addEventListener("submit", (event) => event.preventDefault());
elements.settingsTrigger.addEventListener("click", () => {
  if (state.mcpApplying) return;
  closeProfileMenu();
  renderArchivedSessions();
  void loadProviders();
  void loadExtensions();
  void loadMcpSettings();
  elements.settingsDialog.showModal();
});
elements.settingsClose.addEventListener("click", closeSettingsDialog);
elements.settingsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSettingsDialog();
});
settingsTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateSettingsTab(tab));
  tab.addEventListener("keydown", moveSettingsTabFocus);
});
document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.themeChoice)));
elements.settingsQueueMode.addEventListener("click", () => {
  setQueueMode(state.queueMode === "steer" ? "followUp" : "steer");
});
elements.providerApi.addEventListener("click", () => {
  if (elements.providerApiOptions.hidden) openProviderApiMenu();
  else closeProviderApiMenu({ restoreFocus: true });
});
elements.providerApi.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  openProviderApiMenu({ focus: event.key === "ArrowUp" || event.key === "End" ? "last" : "first" });
});
providerApiOptionButtons.forEach((option) => {
  option.addEventListener("click", () => {
    setProviderApi(option.dataset.providerApi);
    closeProviderApiMenu({ restoreFocus: true });
  });
  option.addEventListener("keydown", moveProviderApiOption);
});
elements.providerApi.parentElement.addEventListener("focusout", () => {
  queueMicrotask(() => {
    if (!elements.providerApi.parentElement.contains(document.activeElement)) closeProviderApiMenu();
  });
});
elements.providerAdd.addEventListener("click", () => openProviderForm());
elements.providerFormClose.addEventListener("click", () => closeProviderForm({ restoreFocus: true }));
elements.providerCancel.addEventListener("click", () => closeProviderForm({ restoreFocus: true }));
elements.providerModelAdd.addEventListener("click", () => elements.providerModelList.append(providerModelRow()));
elements.providerForm.addEventListener("submit", (event) => { void saveProvider(event); });
elements.extensionsApply.addEventListener("click", () => { void applyExtensionChanges(); });
elements.mcpAdd.addEventListener("click", () => openMcpForm());
elements.mcpFormClose.addEventListener("click", () => closeMcpForm({ restoreFocus: true }));
elements.mcpCancel.addEventListener("click", () => closeMcpForm({ restoreFocus: true }));
elements.mcpForm.addEventListener("submit", (event) => { void saveMcpServer(event); });
elements.mcpAddArgument.addEventListener("click", () => elements.mcpArguments.append(mcpArgumentRow()));
elements.mcpAddValue.addEventListener("click", () => elements.mcpValues.append(mcpValueRow()));
elements.mcpEnabled.addEventListener("click", () => {
  elements.mcpEnabled.setAttribute("aria-checked", String(elements.mcpEnabled.getAttribute("aria-checked") !== "true"));
});
document.querySelectorAll("[data-mcp-transport]").forEach((button) => {
  button.addEventListener("click", () => setMcpTransport(button.dataset.mcpTransport));
});
document.querySelectorAll("[data-mcp-scope]").forEach((button) => {
  button.addEventListener("click", () => { if (!button.disabled) setMcpScope(button.dataset.mcpScope); });
});
elements.archiveDeleteAll.addEventListener("click", () => { void deleteAllArchivedSessions(); });
elements.queueMode.addEventListener("change", () => setQueueMode(elements.queueMode.value));
elements.permissionStatus.addEventListener("click", toggleApprovalMenu);
elements.approvalMenu.querySelectorAll("[data-approval-mode]").forEach((button) => {
  button.addEventListener("click", () => { void selectApprovalMode(button.dataset.approvalMode); });
});
elements.attachImage.addEventListener("click", () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener("change", async () => {
  try { await addAttachmentFiles(elements.attachmentInput.files ?? []); }
  catch (error) { showToast(error.message, "error"); }
  finally { elements.attachmentInput.value = ""; }
});
elements.input.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  void addAttachmentFiles(files).catch((error) => showToast(error.message, "error"));
});
elements.composer.addEventListener("dragover", (event) => {
  if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
elements.composer.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  void addAttachmentFiles(files).catch((error) => showToast(error.message, "error"));
});
elements.input.addEventListener("input", () => {
  resizeComposer();
  void updateCommandSuggestions();
});
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && !elements.commandMenu.hidden) {
    const firstCommand = elements.commandMenu.querySelector("button");
    if (firstCommand) { event.preventDefault(); firstCommand.focus(); }
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    const firstCommand = elements.commandMenu.hidden ? null : elements.commandMenu.querySelector("button");
    event.preventDefault();
    if (firstCommand) firstCommand.click();
    else elements.composer.requestSubmit();
  }
});
elements.commandMenu.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const commands = [...elements.commandMenu.querySelectorAll("button")];
  const currentIndex = commands.indexOf(document.activeElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = (currentIndex + direction + commands.length) % commands.length;
  if (commands[nextIndex]) { event.preventDefault(); commands[nextIndex].focus(); }
});
elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.submitting) return;
  if (accountUiBusy()) {
    showToast("Wait for the account update to finish.", "warn");
    return;
  }
  const message = elements.input.value.trim();
  const attachments = attachmentPayloads();
  const images = attachments.images ?? [];
  const references = attachments.references ?? [];
  if (!message && images.length === 0 && references.length === 0) return;
  if (state.activeSessionId === null) {
    const cwd = await requestWorkspace();
    if (!cwd || !await openSession({ cwd })) return;
  }
  if (images.length > 0 && !modelAcceptsImages()) {
    showToast("The selected Pi model does not accept images.", "error");
    return;
  }
  elements.input.value = "";
  resizeComposer();
  const pendingMessage = appendMessage({ role: "user", content: pendingUserContent(message) });
  const queuedKind = state.streaming ? (state.queueMode === "followUp" ? "followUp" : "steering") : null;
  const command = queuedKind
    ? { type: queuedKind === "followUp" ? "follow_up" : "steer", message, ...attachments }
    : { type: "prompt", message, ...attachments };
  const pendingRecord = {
    message: formatPromptWithReferences(message, references),
    article: pendingMessage.article,
  };
  state.pendingUserMessages.push(pendingRecord);
  const queuedRecord = queuedKind
    ? Object.assign(pendingRecord, { kind: queuedKind, hadImages: images.length > 0 })
    : null;
  if (queuedRecord) state.queuedMessages.push(queuedRecord);
  state.submitting = true;
  elements.send.disabled = true;
  refreshAttachmentAvailability();
  try {
    await api("/api/command", { method: "POST", body: command });
    clearAttachments();
  } catch (error) {
    state.pendingUserMessages = state.pendingUserMessages.filter((record) => record !== pendingRecord);
    if (queuedRecord) state.queuedMessages = state.queuedMessages.filter((record) => record !== queuedRecord);
    pendingMessage.article.dataset.error = "true";
    elements.input.value = restoredPrompt(message, elements.input.value);
    resizeComposer();
    showToast(error.message, "error");
  } finally {
    state.submitting = false;
    elements.send.disabled = elements.input.disabled;
    refreshAttachmentAvailability();
  }
});
elements.abort.addEventListener("click", () => { void abortRun(); });

try {
  await authenticateWhenAvailable();
} catch (error) {
  setConnection("error", "Unavailable");
  showToast(error.message, "error");
} finally {
  document.body.removeAttribute("data-booting");
}

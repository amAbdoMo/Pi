import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

const PROVIDER_ID = "openai-codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const PROFILE_CLAIM = "https://api.openai.com/profile";
const AUTH_CLAIM = "https://api.openai.com/auth";
const ACCOUNT_ID = /^acc_[a-f0-9]{24}$/;
const VAULT_VERSION = 1;

function accountError(message, code = "INVALID_ACCOUNT") {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedText(value, max = 160) {
  return typeof value === "string" && value.trim() && value.trim().length <= max
    ? value.trim()
    : undefined;
}

export function decodeJwtPayload(token) {
  if (typeof token !== "string") return {};
  const payload = token.split(".")[1];
  if (!payload) return {};
  try { return record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); }
  catch { return {}; }
}

function oauthCredential(value) {
  const credential = record(value);
  if (credential.type !== "oauth" || typeof credential.access !== "string"
    || typeof credential.refresh !== "string" || !Number.isFinite(credential.expires)) return null;
  return structuredClone(credential);
}

export function codexAccountIdentity(credential) {
  const payload = decodeJwtPayload(credential?.access);
  const profile = record(payload[PROFILE_CLAIM]);
  const auth = record(payload[AUTH_CLAIM]);
  const stableIdentity = boundedText(credential?.accountId, 256)
    ?? boundedText(auth.chatgpt_account_id, 256)
    ?? boundedText(auth.chatgpt_user_id, 256)
    ?? boundedText(auth.user_id, 256)
    ?? boundedText(profile.email, 320)
    ?? boundedText(payload.sub, 256);
  if (!stableIdentity) throw accountError("Codex account identity is unavailable", "ACCOUNT_IDENTITY_UNAVAILABLE");
  const id = `acc_${createHash("sha256").update(stableIdentity).digest("hex").slice(0, 24)}`;
  const email = boundedText(profile.email, 320);
  const accountName = boundedText(profile.name, 160) ?? email?.split("@", 1)[0] ?? "OpenAI account";
  const plan = boundedText(auth.chatgpt_plan_type, 80);
  const chatgptAccountId = boundedText(credential?.accountId, 256) ?? boundedText(auth.chatgpt_account_id, 256);
  return { id, accountName, email, plan, chatgptAccountId };
}

export function accountInitials(name) {
  const words = String(name ?? "").trim().split(/\s+/u).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}` : words[0]?.slice(0, 2);
  return (initials || "AI").toLocaleUpperCase().slice(0, 2);
}

function resetAtMs(window, nowMs) {
  const absolute = finite(window.reset_at);
  if (absolute !== undefined && absolute > 0) return Math.round(absolute * 1000);
  const relative = finite(window.reset_after_seconds);
  if (relative !== undefined && relative >= 0) return Math.round(nowMs + relative * 1000);
  return undefined;
}

function durationLabel(seconds) {
  if (seconds >= 17_000 && seconds <= 19_000) return "5h";
  if (seconds >= 600_000 && seconds <= 610_000) return "7d";
  if (seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return "Limit";
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\brate limit\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function usageWindow(value, label, id, nowMs) {
  const window = record(value);
  const usedPercent = finite(window.used_percent);
  const seconds = finite(window.limit_window_seconds);
  if (usedPercent === undefined || seconds === undefined || seconds <= 0) return null;
  return {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    limitWindowSeconds: seconds,
    ...(resetAtMs(window, nowMs) !== undefined ? { resetsAtMs: resetAtMs(window, nowMs) } : {}),
  };
}

function rateLimitWindows(value, prefix, idPrefix, nowMs) {
  const limit = record(value);
  const windows = [];
  for (const [slot, candidate] of [["primary", limit.primary_window], ["secondary", limit.secondary_window]]) {
    const seconds = finite(record(candidate).limit_window_seconds);
    const duration = seconds === undefined ? "Limit" : durationLabel(seconds);
    const label = prefix ? `${prefix} · ${duration}` : duration;
    const parsed = usageWindow(candidate, label, `${idPrefix}-${slot}`, nowMs);
    if (parsed) windows.push(parsed);
  }
  return windows;
}

function additionalWindows(value, nowMs) {
  const windows = [];
  const seen = new Set();
  const visit = (candidate, labels = [], depth = 0) => {
    if (depth > 4 || candidate === null || candidate === undefined) return;
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, [...labels, String(index + 1)], depth + 1));
      return;
    }
    const object = record(candidate);
    const explicit = boundedText(object.limit_name, 120) ?? boundedText(object.name, 120) ?? boundedText(object.label, 120);
    const nextLabels = explicit ? [...labels.slice(0, -1), explicit] : labels;
    const direct = rateLimitWindows(object, titleCase(nextLabels.at(-1)), `additional-${windows.length}`, nowMs);
    if (direct.length > 0) {
      for (const window of direct) {
        const key = `${window.label}:${window.limitWindowSeconds}:${window.resetsAtMs ?? ""}`;
        if (!seen.has(key)) { seen.add(key); windows.push(window); }
      }
      return;
    }
    for (const [key, nested] of Object.entries(object)) {
      if (["limit_name", "name", "label"].includes(key)) continue;
      const structural = /^(?:rate_?limit|limits?|windows?)$/i.test(key);
      visit(nested, structural ? nextLabels : [...nextLabels, key], depth + 1);
    }
  };
  visit(value);
  return windows;
}

export function extractCodexUsage(payload, nowMs = Date.now()) {
  const root = record(payload);
  const standard = rateLimitWindows(root.rate_limit, "", "standard", nowMs);
  const codeReview = rateLimitWindows(root.code_review_rate_limit, "Code review", "code-review", nowMs);
  const windows = [...standard, ...codeReview, ...additionalWindows(root.additional_rate_limits, nowMs)];
  const credits = record(root.credits);
  const resetCredits = record(root.rate_limit_reset_credits);
  const cleanRange = (value) => Array.isArray(value) && value.length === 2 && value.every((entry) => finite(entry) !== undefined)
    ? value.map(Number)
    : undefined;
  const creditSnapshot = Object.keys(credits).length === 0 ? null : {
    hasCredits: credits.has_credits === true,
    unlimited: credits.unlimited === true,
    overageLimitReached: credits.overage_limit_reached === true,
    ...(typeof credits.balance === "string" || finite(credits.balance) !== undefined ? { balance: String(credits.balance) } : {}),
    ...(cleanRange(credits.approx_local_messages) ? { approxLocalMessages: cleanRange(credits.approx_local_messages) } : {}),
    ...(cleanRange(credits.approx_cloud_messages) ? { approxCloudMessages: cleanRange(credits.approx_cloud_messages) } : {}),
  };
  const resetCreditSnapshot = Object.keys(resetCredits).length === 0 ? null : {
    availableCount: Math.max(0, Math.floor(finite(resetCredits.available_count) ?? 0)),
    applicableAvailableCount: Math.max(0, Math.floor(finite(resetCredits.applicable_available_count) ?? 0)),
  };
  return { windows, credits: creditSnapshot, resetCredits: resetCreditSnapshot };
}

function parseJson(text, label) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw accountError(`${label} is invalid`, "ACCOUNT_STORAGE_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw accountError(`${label} is invalid`, "ACCOUNT_STORAGE_INVALID");
  return value;
}

function emptyVault() {
  return { version: VAULT_VERSION, activeAccountId: null, accounts: {} };
}

function validateVault(value) {
  if (value.version !== VAULT_VERSION || !record(value.accounts) || (value.activeAccountId !== null && typeof value.activeAccountId !== "string")) {
    throw accountError("Codex account storage is invalid", "ACCOUNT_STORAGE_INVALID");
  }
  for (const [id, account] of Object.entries(value.accounts)) {
    if (!ACCOUNT_ID.test(id) || account?.id !== id || !oauthCredential(account.credential)) {
      throw accountError("Codex account storage is invalid", "ACCOUNT_STORAGE_INVALID");
    }
  }
  if (value.activeAccountId !== null && !value.accounts[value.activeAccountId]) {
    throw accountError("Codex account storage is invalid", "ACCOUNT_STORAGE_INVALID");
  }
  return structuredClone(value);
}

async function ensureJsonFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try { await readFile(filePath, "utf8"); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(filePath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch((writeError) => {
      if (writeError?.code !== "EEXIST") throw writeError;
    });
  }
  await chmod(filePath, 0o600).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
}

async function atomicWritePrivate(filePath, contents) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch((error) => { if (error?.code !== "ENOSYS") throw error; });
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function withAccountFiles(vaultPath, authPath, operation) {
  await ensureJsonFile(vaultPath, `${JSON.stringify(emptyVault(), null, 2)}\n`);
  await ensureJsonFile(authPath, "{}\n");
  const releaseVault = await lockfile.lock(vaultPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
  let releaseAuth;
  try {
    releaseAuth = await lockfile.lock(authPath, { realpath: false, retries: { retries: 8, minTimeout: 20, maxTimeout: 100 } });
    const vaultText = await readFile(vaultPath, "utf8");
    const authText = await readFile(authPath, "utf8");
    const vault = validateVault(parseJson(vaultText, "Codex account storage"));
    const auth = parseJson(authText, "Pi authentication storage");
    const outcome = await operation({ vault, auth });
    if (!outcome?.changed) return outcome?.result;
    const nextVaultText = `${JSON.stringify(outcome.vault ?? vault, null, 2)}\n`;
    const nextAuthText = `${JSON.stringify(outcome.auth ?? auth, null, 2)}\n`;
    try {
      await atomicWritePrivate(vaultPath, nextVaultText);
      await atomicWritePrivate(authPath, nextAuthText);
    } catch (error) {
      await atomicWritePrivate(vaultPath, vaultText).catch(() => {});
      await atomicWritePrivate(authPath, authText).catch(() => {});
      throw error;
    }
    return outcome.result;
  } finally {
    await releaseAuth?.().catch(() => {});
    await releaseVault().catch(() => {});
  }
}

function publicUsageWindow(value) {
  const window = record(value);
  const id = boundedText(window.id, 160);
  const label = boundedText(window.label, 160);
  const usedPercent = finite(window.usedPercent);
  const limitWindowSeconds = finite(window.limitWindowSeconds);
  if (!id || !label || usedPercent === undefined || limitWindowSeconds === undefined) return null;
  return {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    limitWindowSeconds,
    ...(finite(window.resetsAtMs) !== undefined ? { resetsAtMs: window.resetsAtMs } : {}),
  };
}

function publicUsage(value) {
  const usage = record(value);
  const windows = Array.isArray(usage.windows) ? usage.windows.slice(0, 32).map(publicUsageWindow).filter(Boolean) : [];
  const credits = record(usage.credits);
  const resetCredits = record(usage.resetCredits);
  return {
    windows,
    credits: Object.keys(credits).length === 0 ? null : {
      hasCredits: credits.hasCredits === true,
      unlimited: credits.unlimited === true,
      overageLimitReached: credits.overageLimitReached === true,
      ...(boundedText(credits.balance, 80) ? { balance: boundedText(credits.balance, 80) } : {}),
      ...(Array.isArray(credits.approxLocalMessages) ? { approxLocalMessages: credits.approxLocalMessages.slice(0, 2).map(Number).filter(Number.isFinite) } : {}),
      ...(Array.isArray(credits.approxCloudMessages) ? { approxCloudMessages: credits.approxCloudMessages.slice(0, 2).map(Number).filter(Number.isFinite) } : {}),
    },
    resetCredits: Object.keys(resetCredits).length === 0 ? null : {
      availableCount: Math.max(0, Math.floor(finite(resetCredits.availableCount) ?? 0)),
      applicableAvailableCount: Math.max(0, Math.floor(finite(resetCredits.applicableAvailableCount) ?? 0)),
    },
  };
}

function publicAccount(account, activeAccountId) {
  const identity = codexAccountIdentity(account.credential);
  const name = boundedText(account.label, 80) ?? identity.accountName;
  return {
    id: account.id,
    provider: PROVIDER_ID,
    name,
    accountName: identity.accountName,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.plan ? { plan: identity.plan } : {}),
    initials: accountInitials(name),
    active: account.id === activeAccountId,
    usage: account.usage ? publicUsage(account.usage) : null,
    usageUpdatedAt: finite(account.usageUpdatedAt) ?? null,
    usageError: boundedText(account.usageError, 160) ?? null,
  };
}

function publicAccounts(vault) {
  return Object.values(vault.accounts)
    .map((account) => publicAccount(account, vault.activeAccountId))
    .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
}

function accountRecord(credential, previous = {}) {
  const identity = codexAccountIdentity(credential);
  return {
    id: identity.id,
    ...(previous.label ? { label: previous.label } : {}),
    credential: oauthCredential(credential),
    ...(previous.usage ? { usage: previous.usage } : {}),
    ...(finite(previous.usageUpdatedAt) !== undefined ? { usageUpdatedAt: previous.usageUpdatedAt } : {}),
    ...(previous.usageError ? { usageError: previous.usageError } : {}),
  };
}

function importCanonicalCredential(vault, auth) {
  const credential = oauthCredential(auth[PROVIDER_ID]);
  if (!credential) return false;
  const identity = codexAccountIdentity(credential);
  const previous = vault.accounts[identity.id];
  const imported = accountRecord(credential, previous);
  const credentialChanged = !previous || JSON.stringify(previous.credential) !== JSON.stringify(imported.credential);
  const activeChanged = vault.activeAccountId !== imported.id;
  vault.accounts[imported.id] = imported;
  vault.activeAccountId = imported.id;
  return credentialChanged || activeChanged;
}

function validateAccountId(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) throw accountError("Account ID is invalid");
  return accountId;
}

function normalizeLabel(label) {
  if (typeof label !== "string" || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) throw accountError("Account label is invalid");
  return label.trim();
}

function combinedSignal(signal, timeoutMs = 15_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal ?? timeout;
}

function cancelledPrompt(...signals) {
  const activeSignals = signals.filter(Boolean);
  return new Promise((_, reject) => {
    const cleanup = () => activeSignals.forEach((signal) => signal.removeEventListener("abort", listeners.get(signal)));
    const listeners = new Map(activeSignals.map((signal) => [signal, () => {
      cleanup();
      reject(signal.reason ?? new Error("Login cancelled"));
    }]));
    const aborted = activeSignals.find((signal) => signal.aborted);
    if (aborted) listeners.get(aborted)();
    else activeSignals.forEach((signal) => signal.addEventListener("abort", listeners.get(signal), { once: true }));
  });
}

export function createAccountManager({
  vaultPath,
  authPath,
  loadOAuth,
  fetch: fetchImpl = globalThis.fetch,
  openUrl = async () => {},
  now = () => Date.now(),
} = {}) {
  if (!vaultPath || !authPath) throw new TypeError("Account vault and auth paths are required");
  if (typeof loadOAuth !== "function") throw new TypeError("loadOAuth is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is required");

  async function loadVault() {
    return withAccountFiles(vaultPath, authPath, async ({ vault, auth }) => {
      const changed = importCanonicalCredential(vault, auth);
      return { changed, vault, auth, result: vault };
    });
  }

  async function listAccounts() {
    return publicAccounts(await loadVault());
  }

  async function mutate(mutator) {
    return withAccountFiles(vaultPath, authPath, async ({ vault, auth }) => {
      importCanonicalCredential(vault, auth);
      const result = await mutator(vault, auth);
      return { changed: true, vault, auth, result: result ?? publicAccounts(vault) };
    });
  }

  async function activateAccount(accountId) {
    const id = validateAccountId(accountId);
    return mutate((vault, auth) => {
      const account = vault.accounts[id];
      if (!account) throw accountError("Codex account was not found", "ACCOUNT_NOT_FOUND");
      const previousActiveId = vault.activeAccountId;
      vault.activeAccountId = id;
      auth[PROVIDER_ID] = structuredClone(account.credential);
      return { accounts: publicAccounts(vault), previousActiveId };
    });
  }

  async function renameAccount(accountId, label) {
    const id = validateAccountId(accountId);
    const normalized = normalizeLabel(label);
    return mutate((vault) => {
      const account = vault.accounts[id];
      if (!account) throw accountError("Codex account was not found", "ACCOUNT_NOT_FOUND");
      if (normalized) account.label = normalized;
      else delete account.label;
      return publicAccounts(vault);
    });
  }

  async function removeAccount(accountId) {
    const id = validateAccountId(accountId);
    return mutate((vault, auth) => {
      const removedAccount = vault.accounts[id];
      if (!removedAccount) throw accountError("Codex account was not found", "ACCOUNT_NOT_FOUND");
      const wasActive = vault.activeAccountId === id;
      const rollback = wasActive ? { account: structuredClone(removedAccount), activeAccountId: id } : null;
      delete vault.accounts[id];
      if (wasActive) {
        vault.activeAccountId = Object.keys(vault.accounts)[0] ?? null;
        if (vault.activeAccountId) auth[PROVIDER_ID] = structuredClone(vault.accounts[vault.activeAccountId].credential);
        else delete auth[PROVIDER_ID];
      }
      return { accounts: publicAccounts(vault), activeChanged: wasActive, rollback };
    });
  }

  async function restoreRemovedAccount(rollback) {
    const account = record(rollback).account;
    const id = validateAccountId(record(rollback).activeAccountId);
    if (account?.id !== id || !oauthCredential(account.credential)) throw accountError("Account rollback is invalid");
    return mutate((vault, auth) => {
      vault.accounts[id] = structuredClone(account);
      vault.activeAccountId = id;
      auth[PROVIDER_ID] = structuredClone(account.credential);
      return publicAccounts(vault);
    });
  }

  async function addAccount({ signal = new AbortController().signal, onEvent = () => {} } = {}) {
    if (signal.aborted) throw accountError("Codex sign-in was cancelled", "ACCOUNT_LOGIN_CANCELLED");
    let oauth;
    try { oauth = await loadOAuth(); }
    catch { throw accountError("Codex sign-in is unavailable", "ACCOUNT_LOGIN_UNAVAILABLE"); }
    if (!oauth || typeof oauth.login !== "function") throw accountError("Codex sign-in is unavailable", "ACCOUNT_LOGIN_UNAVAILABLE");
    if (signal.aborted) throw accountError("Codex sign-in was cancelled", "ACCOUNT_LOGIN_CANCELLED");
    const notify = (event) => {
      if (event?.type === "auth_url" && typeof event.url === "string") void openUrl(event.url);
      onEvent(record(event));
    };
    let credential;
    try {
      credential = await oauth.login({
        signal,
        notify,
        prompt(prompt) {
          if (prompt.type === "select") return Promise.resolve(prompt.options?.[0]?.id);
          if (prompt.type === "manual_code") return cancelledPrompt(prompt.signal, signal);
          return cancelledPrompt(prompt.signal, signal);
        },
      });
    } catch (error) {
      if (signal.aborted || error?.name === "AbortError") throw accountError("Codex sign-in was cancelled", "ACCOUNT_LOGIN_CANCELLED");
      throw accountError("Codex sign-in failed", "ACCOUNT_LOGIN_FAILED");
    }
    const normalized = oauthCredential({ ...credential, type: "oauth" });
    if (!normalized) throw accountError("Codex sign-in returned an invalid credential", "ACCOUNT_LOGIN_FAILED");
    return mutate((vault, auth) => {
      const identity = codexAccountIdentity(normalized);
      const previousAccount = vault.accounts[identity.id] ? structuredClone(vault.accounts[identity.id]) : null;
      const previousActiveId = vault.activeAccountId;
      vault.accounts[identity.id] = accountRecord(normalized, previousAccount ?? {});
      if (!vault.activeAccountId) vault.activeAccountId = identity.id;
      const activeCredentialChanged = vault.activeAccountId === identity.id;
      if (activeCredentialChanged) auth[PROVIDER_ID] = structuredClone(normalized);
      const rollback = activeCredentialChanged ? { accountId: identity.id, previousAccount, previousActiveId } : null;
      return { accounts: publicAccounts(vault), activeCredentialChanged, rollback };
    });
  }

  async function restoreAddedAccount(rollback) {
    const rollbackRecord = record(rollback);
    const id = validateAccountId(rollbackRecord.accountId);
    const previousActiveId = rollbackRecord.previousActiveId === null ? null : validateAccountId(rollbackRecord.previousActiveId);
    const previousAccount = rollbackRecord.previousAccount;
    if (previousAccount !== null && (previousAccount?.id !== id || !oauthCredential(previousAccount.credential))) {
      throw accountError("Account rollback is invalid");
    }
    return mutate((vault, auth) => {
      if (previousAccount) vault.accounts[id] = structuredClone(previousAccount);
      else delete vault.accounts[id];
      vault.activeAccountId = previousActiveId;
      if (previousActiveId) auth[PROVIDER_ID] = structuredClone(vault.accounts[previousActiveId].credential);
      else delete auth[PROVIDER_ID];
      return publicAccounts(vault);
    });
  }

  async function refreshOne(account, signal) {
    let credential = structuredClone(account.credential);
    if (credential.expires <= now() + 60_000) {
      try {
        const oauth = await loadOAuth();
        credential = oauthCredential({ ...await oauth.refresh(credential, combinedSignal(signal)), type: "oauth" });
      } catch (error) {
        if (signal?.aborted) throw error;
        credential = null;
      }
      if (!credential) return { credential: account.credential, usage: null, usageError: "Sign in again to refresh this account." };
    }
    try {
      const identity = codexAccountIdentity(credential);
      const response = await fetchImpl(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${credential.access}`,
          Accept: "application/json",
          "User-Agent": "pi-harness",
          ...(identity.chatgptAccountId ? { "chatgpt-account-id": identity.chatgptAccountId } : {}),
        },
        signal: combinedSignal(signal),
      });
      if (!response.ok) return { credential, usage: null, usageError: "Usage is temporarily unavailable." };
      return { credential, usage: extractCodexUsage(await response.json(), now()), usageError: null };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { credential, usage: null, usageError: "Usage is temporarily unavailable." };
    }
  }

  async function refreshUsage(accountId, { signal } = {}) {
    const id = accountId === undefined || accountId === null ? null : validateAccountId(accountId);
    const snapshot = await loadVault();
    const targets = Object.values(snapshot.accounts).filter((account) => !id || account.id === id);
    if (id && targets.length === 0) throw accountError("Codex account was not found", "ACCOUNT_NOT_FOUND");
    for (const target of targets) {
      const refreshed = await refreshOne(target, signal);
      await mutate((vault, auth) => {
        const current = vault.accounts[target.id];
        if (!current || JSON.stringify(current.credential) !== JSON.stringify(target.credential)) return publicAccounts(vault);
        current.credential = refreshed.credential;
        current.usage = refreshed.usage;
        current.usageUpdatedAt = now();
        if (refreshed.usageError) current.usageError = refreshed.usageError;
        else delete current.usageError;
        if (vault.activeAccountId === current.id) auth[PROVIDER_ID] = structuredClone(current.credential);
        return publicAccounts(vault);
      });
    }
    return listAccounts();
  }

  return { listAccounts, addAccount, restoreAddedAccount, activateAccount, renameAccount, removeAccount, restoreRemovedAccount, refreshUsage };
}

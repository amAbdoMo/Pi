import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexAccountIdentity,
  createAccountManager,
  extractCodexUsage,
} from "../browser/account-settings.mjs";

function jwt({ name, email, accountId, userId = "user-1", plan = "plus" }) {
  const payload = {
    sub: userId,
    "https://api.openai.com/profile": { name, email },
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_user_id: userId,
      chatgpt_plan_type: plan,
    },
  };
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function credential(overrides = {}) {
  return {
    type: "oauth",
    access: jwt({ name: "Abdo Mohamed", email: "abdo@example.test", accountId: "workspace-a" }),
    refresh: "refresh-private-a",
    expires: Date.now() + 3_600_000,
    accountId: "workspace-a",
    ...overrides,
  };
}

async function fixture(t, auth = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-account-settings-"));
  const vaultPath = path.join(root, "agent", "codex-accounts.json");
  const authPath = path.join(root, "agent", "auth.json");
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }));
  return { root, vaultPath, authPath };
}

function manager(paths, overrides = {}) {
  return createAccountManager({
    ...paths,
    loadOAuth: async () => ({
      login: async () => credential(),
      refresh: async (current) => current,
      toAuth: async (current) => ({ apiKey: current.access }),
    }),
    fetch: async () => ({ ok: true, async json() { return {}; } }),
    ...overrides,
  });
}

test("imports the canonical Codex credential and exposes identity without secrets", async (t) => {
  const stored = credential();
  const paths = await fixture(t, { "openai-codex": stored });
  const accounts = await manager(paths).listAccounts();

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, "Abdo Mohamed");
  assert.equal(accounts[0].email, "abdo@example.test");
  assert.equal(accounts[0].plan, "plus");
  assert.equal(accounts[0].initials, "AM");
  assert.equal(accounts[0].active, true);
  const publicText = JSON.stringify(accounts);
  assert.doesNotMatch(publicText, /refresh-private|signature|Bearer/);
  const vault = JSON.parse(await readFile(paths.vaultPath, "utf8"));
  assert.equal(vault.version, 1);
  assert.equal(vault.activeAccountId, accounts[0].id);
  if (process.platform !== "win32") assert.equal((await stat(paths.vaultPath)).mode & 0o777, 0o600);
});

test("parses standard, additional, credit, and banked-reset usage", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const usage = extractCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_after_seconds: 600 },
      secondary_window: { used_percent: 70, limit_window_seconds: 604_800, reset_at: 1_800_000_000 },
    },
    additional_rate_limits: {
      deep_research: {
        limit_name: "Deep research",
        rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 86_400, reset_after_seconds: 60 } },
      },
    },
    credits: { has_credits: true, unlimited: false, balance: "12.50", approx_local_messages: [20, 30] },
    rate_limit_reset_credits: { available_count: 5, applicable_available_count: 3 },
  }, now);

  assert.equal(usage.windows.find((window) => window.label === "5h").resetsAtMs, now + 600_000);
  assert.equal(usage.windows.find((window) => window.label === "7d").resetsAtMs, 1_800_000_000_000);
  assert.equal(usage.windows.some((window) => /Deep Research/.test(window.label)), true);
  assert.deepEqual(usage.resetCredits, { availableCount: 5, applicableAvailableCount: 3 });
  assert.equal(usage.credits.balance, "12.50");
});

test("adds accounts without replacing the active account, deduplicates, renames, switches, and removes", async (t) => {
  const first = credential();
  const second = credential({
    access: jwt({ name: "Second Person", email: "second@example.test", accountId: "workspace-b", userId: "user-2", plan: "pro" }),
    refresh: "refresh-private-b",
    accountId: "workspace-b",
  });
  const paths = await fixture(t, { "openai-codex": first });
  let loginCredential = second;
  const accountManager = manager(paths, {
    loadOAuth: async () => ({
      async login(interaction) {
        interaction.notify({ type: "auth_url", url: "https://auth.openai.com/authorize" });
        assert.equal(await interaction.prompt({ type: "select", options: [{ id: "browser", label: "Browser" }] }), "browser");
        return loginCredential;
      },
      async refresh(current) { return current; },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
  });
  const events = [];
  let addition = await accountManager.addAccount({ onEvent: (event) => events.push(event) });
  let accounts = addition.accounts;
  assert.equal(addition.activeCredentialChanged, false);
  assert.equal(events[0].type, "auth_url");
  assert.equal(accounts.length, 2);
  assert.equal(accounts.find((account) => account.active).email, "abdo@example.test");

  loginCredential = second;
  addition = await accountManager.addAccount();
  accounts = addition.accounts;
  assert.equal(accounts.length, 2, "same Codex identity must update, not duplicate");
  const secondAccount = accounts.find((account) => account.email === "second@example.test");
  accounts = await accountManager.renameAccount(secondAccount.id, "Work Pro");
  assert.equal(accounts.find((account) => account.id === secondAccount.id).name, "Work Pro");
  await assert.rejects(() => accountManager.renameAccount(secondAccount.id, "x".repeat(81)), /label is invalid/);

  const activation = await accountManager.activateAccount(secondAccount.id);
  assert.equal(activation.accounts.find((account) => account.active).name, "Work Pro");
  const canonical = JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"];
  assert.equal(canonical.refresh, "refresh-private-b");

  const removed = await accountManager.removeAccount(secondAccount.id);
  assert.equal(removed.activeChanged, true);
  assert.equal(removed.accounts.length, 1);
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "refresh-private-a");
  const restored = await accountManager.restoreRemovedAccount(removed.rollback);
  assert.equal(restored.find((account) => account.active).name, "Work Pro");
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "refresh-private-b");
});

test("refreshes expired OAuth credentials, persists active auth, and captures usage", async (t) => {
  const expired = credential({ expires: 1 });
  const paths = await fixture(t, { "openai-codex": expired });
  const refreshed = credential({ access: jwt({ name: "Abdo Mohamed", email: "abdo@example.test", accountId: "workspace-a" }), refresh: "rotated-private", expires: 9_999_999_999_999 });
  let authorization;
  const accountManager = manager(paths, {
    now: () => 1_000_000,
    loadOAuth: async () => ({
      async login() { return refreshed; },
      async refresh(current) { assert.equal(current.refresh, "refresh-private-a"); return refreshed; },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
    fetch: async (_url, options) => {
      authorization = options.headers.Authorization;
      assert.equal(options.headers["chatgpt-account-id"], "workspace-a");
      return { ok: true, async json() { return { rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_after_seconds: 10 } } }; } };
    },
  });
  const accounts = await accountManager.refreshUsage();
  assert.equal(authorization, `Bearer ${refreshed.access}`);
  assert.equal(accounts[0].usage.windows[0].label, "5h");
  assert.equal(accounts[0].usage.windows[0].resetsAtMs, 1_010_000);
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "rotated-private");
});

test("caller cancellation interrupts an in-flight credential refresh", async (t) => {
  const expired = credential({ expires: 1 });
  const paths = await fixture(t, { "openai-codex": expired });
  const controller = new AbortController();
  const refreshStarted = deferred();
  const accountManager = manager(paths, {
    now: () => 1_000_000,
    loadOAuth: async () => ({
      async login() { return expired; },
      refresh(_current, signal) {
        refreshStarted.resolve();
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
  });

  const refresh = accountManager.refreshUsage(null, { signal: controller.signal });
  await refreshStarted.promise;
  controller.abort();
  await assert.rejects(refresh, (error) => error.name === "AbortError");
  const vault = JSON.parse(await readFile(paths.vaultPath, "utf8"));
  assert.equal(vault.accounts[codexAccountIdentity(expired).id].usageUpdatedAt, undefined);
});

test("outer cancellation interrupts the OAuth manual-code prompt", async (t) => {
  const first = credential();
  const paths = await fixture(t, { "openai-codex": first });
  const controller = new AbortController();
  const promptStarted = deferred();
  const accountManager = manager(paths, {
    loadOAuth: async () => ({
      async login({ prompt }) {
        const innerController = new AbortController();
        promptStarted.resolve();
        return prompt({ type: "manual_code", signal: innerController.signal });
      },
      async refresh(current) { return current; },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
  });
  const login = accountManager.addAccount({ signal: controller.signal });
  await promptStarted.promise;
  controller.abort();
  await assert.rejects(login, (error) => error.code === "ACCOUNT_LOGIN_CANCELLED");
  assert.equal((await accountManager.listAccounts()).length, 1);
  assert.equal(codexAccountIdentity(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"]).accountName, "Abdo Mohamed");
});

test("public account usage drops unknown persisted fields", async (t) => {
  const first = credential();
  const paths = await fixture(t, { "openai-codex": first });
  const accountManager = manager(paths);
  const [account] = await accountManager.listAccounts();
  const vault = JSON.parse(await readFile(paths.vaultPath, "utf8"));
  vault.accounts[account.id].usage = {
    windows: [{ id: "standard-primary", label: "5h", usedPercent: 20, limitWindowSeconds: 18_000, refreshToken: "window-secret" }],
    refreshToken: "usage-secret",
    credits: { balance: "10", accessToken: "credit-secret" },
  };
  await writeFile(paths.vaultPath, `${JSON.stringify(vault, null, 2)}\n`);

  const listed = await accountManager.listAccounts();
  assert.equal(listed[0].usage.windows[0].label, "5h");
  assert.doesNotMatch(JSON.stringify(listed), /usage-secret|window-secret|credit-secret|refreshToken|accessToken/);
});

test("canonical auth becomes authoritative after an external Codex login", async (t) => {
  const first = credential();
  const second = credential({
    access: jwt({ name: "Second Person", email: "second@example.test", accountId: "workspace-b", userId: "user-2", plan: "pro" }),
    refresh: "refresh-private-b",
    accountId: "workspace-b",
  });
  const paths = await fixture(t, { "openai-codex": first });
  const accountManager = manager(paths);
  await accountManager.listAccounts();
  await writeFile(paths.authPath, `${JSON.stringify({ "openai-codex": second }, null, 2)}\n`);

  const accounts = await accountManager.listAccounts();
  assert.equal(accounts.find((account) => account.active).email, "second@example.test");
  const vault = JSON.parse(await readFile(paths.vaultPath, "utf8"));
  assert.equal(vault.activeAccountId, codexAccountIdentity(second).id);
});

test("an active-account re-login can restore its previous credential", async (t) => {
  const first = credential();
  const relogged = credential({ refresh: "new-login-refresh", expires: Date.now() + 7_200_000 });
  const paths = await fixture(t, { "openai-codex": first });
  const accountManager = manager(paths, {
    loadOAuth: async () => ({
      async login() { return relogged; },
      async refresh(current) { return current; },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
  });

  const addition = await accountManager.addAccount();
  assert.equal(addition.activeCredentialChanged, true);
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "new-login-refresh");
  await accountManager.restoreAddedAccount(addition.rollback);
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "refresh-private-a");
});

test("a stale usage refresh cannot overwrite a newer OAuth login", async (t) => {
  const first = credential();
  const relogged = credential({ refresh: "new-login-refresh", expires: Date.now() + 7_200_000 });
  const paths = await fixture(t, { "openai-codex": first });
  const fetchStarted = deferred();
  const releaseFetch = deferred();
  const accountManager = manager(paths, {
    loadOAuth: async () => ({
      async login() { return relogged; },
      async refresh(current) { return current; },
      async toAuth(current) { return { apiKey: current.access }; },
    }),
    fetch: async () => {
      fetchStarted.resolve();
      await releaseFetch.promise;
      return { ok: true, async json() { return { rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18_000, reset_after_seconds: 10 } } }; } };
    },
  });

  const refresh = accountManager.refreshUsage();
  await fetchStarted.promise;
  await accountManager.addAccount();
  releaseFetch.resolve();
  await refresh;

  const vault = JSON.parse(await readFile(paths.vaultPath, "utf8"));
  assert.equal(vault.accounts[codexAccountIdentity(first).id].credential.refresh, "new-login-refresh");
  assert.equal(JSON.parse(await readFile(paths.authPath, "utf8"))["openai-codex"].refresh, "new-login-refresh");
});

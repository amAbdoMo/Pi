import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  loadSettings,
} from "../extensions/subagents/settings.ts";

function withProjectSettings(value, run) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-settings-"));
  try {
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(value));
    run(loadSettings(cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("token-safe subagent defaults bound fan-out, recursion, handoff, and parent context", () => {
  assert.equal(DEFAULT_SETTINGS.maxDepth, 1);
  assert.equal(DEFAULT_SETTINGS.maxConcurrent, 3);
  assert.equal(DEFAULT_SETTINGS.handoffTokenBudget, 4_000);
  assert.equal(DEFAULT_SETTINGS.handoffKeepRecentTokens, 2_000);
  assert.equal(DEFAULT_SETTINGS.returnMaxBytes, 24_000);
  assert.equal(DEFAULT_SETTINGS.summaryProfile, "fast");
});

test("project settings can override adaptive profiles and summary profile", () => {
  withProjectSettings(
    {
      subagents: {
        summaryProfile: "balanced",
        profiles: {
          fast: {
            model: "custom/cheap-summary",
            thinking: "minimal",
          },
        },
      },
    },
    (settings) => {
      assert.equal(settings.summaryProfile, "balanced");
      assert.deepEqual(settings.profiles.fast, {
        model: "custom/cheap-summary",
        thinking: "minimal",
      });
      assert.equal(settings.profiles.review.model, "openai-codex/gpt-5.6-terra");
    },
  );
});

test("invalid profile settings retain safe defaults", () => {
  withProjectSettings(
    {
      subagents: {
        summaryProfile: "unknown",
        profiles: { fast: { model: "", thinking: "impossible" } },
      },
    },
    (settings) => {
      assert.equal(settings.summaryProfile, "fast");
      assert.deepEqual(settings.profiles.fast, DEFAULT_SETTINGS.profiles.fast);
    },
  );
});

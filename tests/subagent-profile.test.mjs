import assert from "node:assert/strict";
import test from "node:test";
import {
  childProfileArgs,
  DEFAULT_CHILD_PROFILES,
  resolveAvailableChildProfile,
  resolveChildProfile,
} from "../extensions/subagents/child-profile.ts";

const inherited = {
  model: "openai-codex/gpt-5.6-sol",
  thinking: "max",
};

test("GPT-5.6 defaults route bounded work to Luna, normal work to Terra, and deep work to Sol", () => {
  assert.deepEqual(DEFAULT_CHILD_PROFILES.fast, {
    model: "openai-codex/gpt-5.6-luna",
    thinking: "low",
  });
  assert.deepEqual(DEFAULT_CHILD_PROFILES.balanced, {
    model: "openai-codex/gpt-5.6-terra",
    thinking: "medium",
  });
  assert.deepEqual(DEFAULT_CHILD_PROFILES.implementation, {
    model: "openai-codex/gpt-5.6-terra",
    thinking: "high",
  });
  assert.deepEqual(DEFAULT_CHILD_PROFILES.review, {
    model: "openai-codex/gpt-5.6-terra",
    thinking: "high",
  });
  assert.deepEqual(DEFAULT_CHILD_PROFILES.deep, {
    model: "openai-codex/gpt-5.6-sol",
    thinking: "high",
  });
  assert.deepEqual(DEFAULT_CHILD_PROFILES.critical, {
    model: "openai-codex/gpt-5.6-sol",
    thinking: "xhigh",
  });
});

test("adaptive profile resolves a task-sized model and thinking level", () => {
  const profile = resolveChildProfile({ profile: "implementation" }, inherited);

  assert.deepEqual(profile, {
    model: "openai-codex/gpt-5.6-terra",
    thinking: "high",
  });
  assert.deepEqual(childProfileArgs(profile), [
    "--model",
    "openai-codex/gpt-5.6-terra",
    "--thinking",
    "high",
  ]);
});

test("explicit child model and thinking override the selected profile", () => {
  const profile = resolveChildProfile(
    {
      profile: "fast",
      model: "openai-codex/gpt-5.6-terra",
      thinking: "xhigh",
    },
    inherited,
  );

  assert.deepEqual(profile, {
    model: "openai-codex/gpt-5.6-terra",
    thinking: "xhigh",
  });
});

test("omitted child profile inherits parent defaults", () => {
  const profile = resolveChildProfile({ model: "  " }, inherited);

  assert.deepEqual(profile, inherited);
});

test("an unavailable configured profile falls back to the inherited parent safely", () => {
  const profile = resolveAvailableChildProfile(
    { profile: "fast" },
    inherited,
    DEFAULT_CHILD_PROFILES,
    () => false,
  );

  assert.deepEqual(profile, inherited);
});

test("an explicit unavailable model remains explicit so configuration errors are visible", () => {
  const profile = resolveAvailableChildProfile(
    {
      profile: "fast",
      model: "custom/missing-model",
      thinking: "low",
    },
    inherited,
    DEFAULT_CHILD_PROFILES,
    () => false,
  );

  assert.deepEqual(profile, {
    model: "custom/missing-model",
    thinking: "low",
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  childProfileArgs,
  resolveChildProfile,
} from "../extensions/subagents/child-profile.ts";

test("requested child profile overrides inherited model and thinking", () => {
  const profile = resolveChildProfile(
    { model: "openai-codex/gpt-5.4-mini", thinking: "low" },
    { model: "openai-codex/gpt-5.6-sol", thinking: "high" },
  );

  assert.deepEqual(profile, {
    model: "openai-codex/gpt-5.4-mini",
    thinking: "low",
  });
  assert.deepEqual(childProfileArgs(profile), [
    "--model",
    "openai-codex/gpt-5.4-mini",
    "--thinking",
    "low",
  ]);
});

test("omitted child profile inherits parent defaults", () => {
  const profile = resolveChildProfile(
    { model: "  " },
    { model: "openai-codex/gpt-5.6-sol", thinking: "max" },
  );

  assert.deepEqual(profile, {
    model: "openai-codex/gpt-5.6-sol",
    thinking: "max",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { supportsFastMode } from "../extensions/fast-mode/state.ts";

function context(model) {
  return { model };
}

test("Fast mode supports GPT-5.4, GPT-5.5, and every GPT-5.6 tier", () => {
  for (const id of ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
    assert.equal(
      supportsFastMode(context({ id, provider: "openai-codex", api: "openai-codex-responses" })),
      true,
      id,
    );
  }
});

test("Fast mode still rejects unsupported providers, APIs, and models", () => {
  assert.equal(supportsFastMode(context({ id: "gpt-5.6-sol", provider: "anthropic", api: "anthropic-messages" })), false);
  assert.equal(supportsFastMode(context({ id: "gpt-5.6-sol", provider: "openai-codex", api: "unsupported" })), false);
  assert.equal(supportsFastMode(context({ id: "gpt-5.7", provider: "openai-codex", api: "openai-codex-responses" })), false);
  assert.equal(supportsFastMode(context(undefined)), false);
});

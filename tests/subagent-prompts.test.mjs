import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInitialPrompt,
  buildSubagentSystemPrompt,
  DELEGATE_PROMPT_GUIDELINES,
} from "../extensions/subagents/prompts.ts";

test("parent delegation guidance requires proportional evidence review and parent-owned integration", () => {
  const guidance = DELEGATE_PROMPT_GUIDELINES.join("\n");

  assert.match(guidance, /evidence, not authority/i);
  assert.match(guidance, /spot-check bounded read-only findings/i);
  assert.match(guidance, /inspect all changed paths/i);
  assert.match(guidance, /independent review plus final gates/i);
  assert.match(guidance, /parent owns integration, commits, pushes, deployment, and final claims/i);
});

test("child prompt boundary normalizes invalid task and handoff strings", () => {
  const prompt = buildInitialPrompt(
    "task-\ud83d",
    "compact",
    "handoff-\ud83d",
    1,
    1,
  );

  for (const character of prompt) {
    const codePoint = character.codePointAt(0);
    assert.ok(codePoint < 0xd800 || codePoint > 0xdfff);
  }
  assert.match(prompt, /task-�/);
  assert.match(prompt, /handoff-�/);
});

test("child prompt requests a compact structured handoff without release authority", () => {
  const prompt = buildSubagentSystemPrompt(1, 2);

  assert.match(prompt, /Outcome, Evidence, Files, Validation, Risks \/ Open Questions/);
  assert.match(prompt, /Do not commit, push, deploy/);
  assert.match(prompt, /parent owns integration and release decisions/i);
});

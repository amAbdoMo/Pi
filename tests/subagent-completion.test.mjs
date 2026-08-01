import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParentDelegateResult,
  parentVisibleCompletionContent,
} from "../extensions/subagents/summaries/parent-content.ts";

function completion(overrides = {}) {
  return {
    id: "child-1",
    label: "review",
    status: "completed",
    contextMode: "compact",
    depth: 1,
    maxDepth: 2,
    task: "Review the change",
    output: "raw child output",
    payload: "bounded completion payload",
    wasSummarized: false,
    ...overrides,
  };
}

test("parent receives the complete bounded child payload instead of a one-line preview", () => {
  const decisiveEvidence = "DECISIVE_EVIDENCE_AFTER_PREVIEW";
  const payload = [
    "Sub-agent completed.",
    "x".repeat(300),
    decisiveEvidence,
    "## Validation",
    "- focused tests passed",
  ].join("\n");

  const visible = parentVisibleCompletionContent(completion({ payload }));

  assert.equal(visible, payload);
  assert.ok(visible.length > 220);
  assert.match(visible, new RegExp(decisiveEvidence));
  assert.match(visible, /\n## Validation\n/);
});

test("delegate tool result exposes the complete payload through model-visible content", () => {
  const payload = `${"e".repeat(300)}DECISIVE_EVIDENCE_AFTER_PREVIEW`;
  const details = {
    id: "child-1",
    label: "review",
    status: "completed",
    contextMode: "fresh",
    depth: 1,
    maxDepth: 1,
    task: "Review",
    events: [],
  };

  const result = buildParentDelegateResult(completion({ payload }), details);

  assert.equal(result.content[0].text, payload);
  assert.match(result.content[0].text, /DECISIVE_EVIDENCE_AFTER_PREVIEW/);
  assert.equal(result.details, details);
});

test("parent-visible completion never falls back to unbounded raw child output", () => {
  const unavailable =
    "(child completion payload unavailable; inspect the referenced child output file)";
  assert.equal(
    parentVisibleCompletionContent(
      completion({ payload: "  ", output: "x".repeat(100_000) }),
    ),
    unavailable,
  );
  assert.equal(
    parentVisibleCompletionContent(completion({ payload: "", output: "" })),
    unavailable,
  );
});

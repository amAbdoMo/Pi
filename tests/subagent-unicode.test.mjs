import assert from "node:assert/strict";
import test from "node:test";
import {
  codePointPrefix,
  codePointSuffix,
  generatedLabel,
  oneLine,
} from "../extensions/subagents/utils.ts";

function assertNoLoneSurrogates(text) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    assert.ok(codePoint < 0xd800 || codePoint > 0xdfff);
  }
}

test("labels and one-line summaries truncate emoji at code-point boundaries", () => {
  const input = "😀".repeat(5_000);
  const label = generatedLabel(input);
  const summary = oneLine(input, 160);

  assertNoLoneSurrogates(label);
  assertNoLoneSurrogates(summary);
  assert.ok(Array.from(label).length <= 48);
  assert.ok(Array.from(summary).length <= 160);
});

test("invalid lone-surrogate input is normalized before entering labels or snippets", () => {
  const invalid = "\ud83d".repeat(500);
  const values = [
    generatedLabel(invalid),
    oneLine(invalid, 160),
    codePointPrefix(invalid, 100),
    codePointSuffix(invalid, 100),
  ];

  for (const value of values) {
    assertNoLoneSurrogates(value);
    assert.match(value, /�/);
  }
});

test("streaming prefixes and suffixes preserve complete code points", () => {
  const input = `start-${"🙂".repeat(3_000)}-end`;
  const prefix = codePointPrefix(input, 2_000);
  const suffix = codePointSuffix(input, 2_000);

  assertNoLoneSurrogates(prefix);
  assertNoLoneSurrogates(suffix);
  assert.equal(codePointSuffix(input, 0), "");
});

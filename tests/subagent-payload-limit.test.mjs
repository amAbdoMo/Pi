import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedOptionalText,
  enforcePayloadByteLimit,
  serializedTextBytes,
} from "../extensions/subagents/summaries/payload-limit.ts";

test("completion payload remains within returnMaxBytes even when metadata is oversized", () => {
  const payload = `Task: ${"x".repeat(2_000)}\nError: ${"stderr ".repeat(2_000)}`;
  const limited = enforcePayloadByteLimit(payload, 1_000);

  assert.ok(Buffer.byteLength(limited, "utf8") <= 1_000);
  assert.match(limited, /\[Completion payload truncated;/);
});

test("payload byte limiting preserves complete Unicode code points", () => {
  const limited = enforcePayloadByteLimit("مرحبا🙂".repeat(1_000), 1_001);

  assert.ok(Buffer.byteLength(limited, "utf8") <= 1_001);
  assert.doesNotMatch(limited, /�/);
  assert.match(limited, /\[Completion payload truncated;/);
});

test("payload limiting normalizes invalid lone surrogates", () => {
  const limited = enforcePayloadByteLimit("\ud83d".repeat(10_000), 1_000);

  for (const character of limited) {
    const codePoint = character.codePointAt(0);
    assert.ok(codePoint < 0xd800 || codePoint > 0xdfff);
  }
  assert.ok(serializedTextBytes(limited) <= 1_000);
});

test("payload budget accounts for JSON escaping of control characters", () => {
  const limited = enforcePayloadByteLimit("\u0000".repeat(10_000), 1_000);

  assert.ok(serializedTextBytes(limited) <= 1_000);
  assert.match(limited, /\[Completion payload truncated;/);
});

test("tool-result details cannot retain an unbounded raw final output", () => {
  const limited = boundedOptionalText("raw-output ".repeat(10_000), 2_000);

  assert.ok(Buffer.byteLength(limited, "utf8") <= 2_000);
  assert.equal(boundedOptionalText(undefined, 2_000), undefined);
});

test("payloads already inside the budget remain unchanged", () => {
  assert.equal(enforcePayloadByteLimit("complete evidence", 1_000), "complete evidence");
});

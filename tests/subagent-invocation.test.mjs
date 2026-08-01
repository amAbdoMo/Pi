import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChildLaunchArgs,
  childExtensionArgs,
} from "../extensions/subagents/runtime/invocation.ts";

test("child preserves parent extension isolation for explicit development loads", () => {
  assert.deepEqual(
    childExtensionArgs(
      ["cli.js", "--no-extensions", "-e", "project/subagents/index.ts"],
      "project/subagents/index.ts",
    ),
    ["--no-extensions", "-e", "project/subagents/index.ts"],
  );
});

test("complete child launch forwards isolation, persistence, and selected profile", () => {
  assert.deepEqual(
    buildChildLaunchArgs({
      parentArgs: ["cli.js", "--no-extensions"],
      label: "Focused review",
      extensionPath: "project/subagents/index.ts",
      persistSessions: true,
      sessionDir: "sessions/child-1",
      profile: {
        model: "openai-codex/gpt-5.6-terra",
        thinking: "high",
      },
    }),
    [
      "--mode",
      "rpc",
      "--name",
      "Focused review",
      "--no-extensions",
      "-e",
      "project/subagents/index.ts",
      "--session-dir",
      "sessions/child-1",
      "--model",
      "openai-codex/gpt-5.6-terra",
      "--thinking",
      "high",
    ],
  );
});

test("normal installed children retain configured extensions", () => {
  assert.deepEqual(
    childExtensionArgs(["cli.js"], "managed/subagents/index.ts"),
    ["-e", "managed/subagents/index.ts"],
  );
});

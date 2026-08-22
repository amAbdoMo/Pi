import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

// header.ts only needs width helpers from pi-tui; stub them so the wiring
// test can import the real composer status renderer.
const tuiStub = `
export function visibleWidth(text) {
  return [...String(text).replace(/\\x1b\\[[0-9;]*m/g, "")].length;
}
export function truncateToWidth(text, width) {
  const plain = String(text).replace(/\\x1b\\[[0-9;]*m/g, "");
  return [...plain].slice(0, Math.max(0, width)).join("");
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") {
      return { url: "agent-time-stub:pi-tui", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "agent-time-stub:pi-tui") {
      return { format: "module", source: tuiStub, shortCircuit: true };
    }
    if (url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
          mode: "transform",
          sourceMap: false,
        }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { agentTimeStatus } = await import("../extensions/ui/agentTime.ts");
const { AGENT_TIME_ICON } = await import("../extensions/ui/agentTimeTracker.ts");
const { buildComposerHeader } = await import("../extensions/ui/header.ts");

test("composer status surfaces live and settled timer labels", () => {
  try {
    agentTimeStatus.label = `${AGENT_TIME_ICON} working 5s`;
    agentTimeStatus.working = true;
    const working = buildComposerHeader(120, "ltr").join("\n");
    assert.ok(working.includes(`${AGENT_TIME_ICON} working 5s`));

    agentTimeStatus.label = `${AGENT_TIME_ICON} worked 8s`;
    agentTimeStatus.working = false;
    const settled = buildComposerHeader(120, "ltr").join("\n");
    assert.ok(settled.includes(`${AGENT_TIME_ICON} worked 8s`));
  } finally {
    agentTimeStatus.label = "";
    agentTimeStatus.working = false;
  }

  const idle = buildComposerHeader(120, "ltr").join("\n");
  assert.ok(!idle.includes("working"));
  assert.ok(!idle.includes("worked"));
});

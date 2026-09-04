import assert from "node:assert/strict";
import test from "node:test";
import { commandIntegration, integrationForTool, toolActivityLabel } from "../browser/public/integration-view.js";

test("Workbench integration tools receive explicit running and failure states", () => {
  for (const [tool, category] of [
    ["mcp", "MCP"],
    ["workflow_run", "Workflows"],
    ["plan_progress", "Plans"],
    ["delegate", "Subagents"],
    ["memory", "Memory"],
  ]) assert.equal(integrationForTool(tool)?.category, category);
  assert.equal(toolActivityLabel("delegate", "start"), "Running subagent");
  assert.equal(toolActivityLabel("delegate", "end", true), "Subagent failed");
  assert.equal(toolActivityLabel("workflow_run", "end", false), "Workflow finished");
});

test("unknown tools remain generic and skills rely on Pi command discovery", () => {
  assert.equal(integrationForTool("read"), null);
  assert.equal(toolActivityLabel("read", "start"), "Running read");
  assert.equal(commandIntegration("skill", "skill:review"), "Skills");
  assert.equal(commandIntegration("extension", "workflow"), "Workflows");
  assert.equal(commandIntegration("extension", "other"), null);
});

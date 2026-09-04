const INTEGRATIONS = new Map([
  ["mcp", { noun: "MCP request", category: "MCP" }],
  ["workflow_run", { noun: "Workflow", category: "Workflows" }],
  ["plan_progress", { noun: "Plan update", category: "Plans" }],
  ["delegate", { noun: "Subagent", category: "Subagents" }],
  ["memory", { noun: "Memory update", category: "Memory" }],
  ["ui_learning", { noun: "UI lesson update", category: "Memory" }],
]);

export function integrationForTool(toolName) {
  return INTEGRATIONS.get(toolName) ?? null;
}

export function toolActivityLabel(toolName, phase, isError = false) {
  const integration = integrationForTool(toolName);
  const noun = integration?.noun ?? (toolName || "Tool");
  if (phase !== "end") return `Running ${noun.toLocaleLowerCase()}`;
  return `${noun} ${isError ? "failed" : "finished"}`;
}

export function commandIntegration(source, name) {
  if (source === "skill") return "Skills";
  if (/workflow/i.test(name ?? "")) return "Workflows";
  return null;
}

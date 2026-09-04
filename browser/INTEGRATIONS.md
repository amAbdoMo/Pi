# Workbench integration mappings

Pi Harness does not create a second integration protocol. Workbench integrations run through Pi's normal extension tools and RPC events.

| Surface | Invocation | Browser status mapping | Browser data policy |
| --- | --- | --- | --- |
| MCP | `mcp` tool | MCP request running/finished/failed | Only server-redacted tool arguments and bounded output details. |
| Workflows | `workflow_run` tool or discovered `/workflow` command | Workflow running/finished/failed | Orchestration tool result is bounded like every tool result. Tool failure cannot terminate the SSE connection. |
| Plans | `plan_progress` tool | Plan update running/finished/failed | Evidence is rendered as text only after server redaction. |
| Subagents | `delegate` tool | Subagent running/finished/failed | No child session path or process identifier crosses the browser boundary. |
| Memory | `memory` and `ui_learning` tools | Memory/UI-lesson update running/finished/failed | Destructive confirmation remains owned by the extension/tool; browser approval remains fail-closed. |
| Skills | Pi RPC `get_commands` entries with `source: "skill"` | Skill commands appear in command discovery | Absolute command source paths are removed by the server projection. Skill file contents are not copied into browser state. |

The browser correlates each integration through Pi's opaque `toolCallId`. Start, accumulated update, and final events share one activity row. Failures are surfaced immediately with an error state; unknown tools retain the same generic bounded rendering.

Pi RPC has no separate browser commands for listing MCP servers, plans, subagents, memory, or skills. Pi Harness therefore does not fabricate standalone dashboards or settings that could drift from the active extension runtime.

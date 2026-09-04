# Pi RPC browser event coverage

This inventory is based on the installed Pi RPC event surface. Pi Harness treats `message_end.message` as the authoritative transcript message and `agent_settled` as the authoritative idle boundary. Unknown extension/custom events cross the browser boundary only as `{ type: "pi_custom_event", eventType }`; their payload is discarded server-side.

| Event | Browser decision | Reason |
| --- | --- | --- |
| `browser_connected` | Safe ignore | EventSource open state owns the visible connection label; the payload is only a replay boundary. |
| `agent_start` | Activity + streaming state | Begins the active run. |
| `agent_end` | Safe ignore | `agent_settled` owns final idle cleanup and state refresh. |
| `agent_settled` | Set idle, clear settled queue/dialog state, refresh runtime | Prevents provisional state surviving settlement. |
| `turn_start` | Safe ignore | Message and tool events provide the visible lifecycle. |
| `turn_end` | Safe ignore | Authoritative `message_end` and `agent_settled` events own rendering and cleanup. |
| `message_start` | Safe ignore | Streaming rows initialize lazily from indexed deltas; `message_end` remains authoritative. |
| `message_update` | Assemble indexed text/thinking deltas; surface tool-call start activity | Provider usage is not treated as authoritative context state; session statistics refresh separately. |
| `message_end` | Reconcile optimistic user rows or replace the live assistant row exactly once | Final message content and role are authoritative. |
| `bash_execution_update` | Safe ignore | Pi Harness does not expose the direct RPC bash command; extension tools use tool execution events. |
| `tool_execution_start` | Create correlated activity row | Correlates by opaque tool-call ID. |
| `tool_execution_update` | Replace accumulated output | Pi sends accumulated partial results rather than output deltas. |
| `tool_execution_end` | Final success/error activity and details | Error state comes from `isError`; details are control-stripped and capped at 64 KiB before DOM rendering. |
| `queue_update` | Update bounded queue count | Queue contents are returned only by explicit `clear_queue`. |
| `compaction_start` | Busy context state + activity | Disables conflicting context actions. |
| `compaction_end` | Separate success, cancellation, and failure states; refresh statistics | A null result with an error is not presented as success. |
| `auto_retry_start` | Warning activity with attempt bounds | Reflects Pi's retry lifecycle. |
| `auto_retry_end` | Success/failure activity and bounded error toast | Does not fabricate a successful turn. |
| `summarization_retry_scheduled` | Warning activity | Reflects delayed summary retry. |
| `summarization_retry_attempt_start` | Live activity | Reflects the active summary request. |
| `summarization_retry_finished` | Settled activity | Final compaction/branch events still own their result. |
| `extension_error` | Error toast | Browser receives server-redacted fields only. |
| `extension_ui_request` | Dialog queue or fire-and-forget UI mapping | Dialog responses remain one-way and ID-correlated. |
| `browser_error` | Error toast | Represents invalid or oversized server-side event projection. |
| `pi_custom_event` | Safe ignore | Only a validated event type is exposed; arbitrary custom payloads never reach the browser. |

## Server boundary

Known Pi events are recursively redacted before SSE delivery. Credential fields, session files/IDs, working directories, extension/source/spill paths, process identifiers, and full-output paths are replaced with `[REDACTED]`. Events remain capped at 512 KiB. Unsupported event payloads are discarded rather than rendered.

## Rendering boundary

Conversation and detail content is assigned through DOM `textContent`; Markdown uses the dependency-free token renderer and never injects HTML. Tool detail text is stripped of terminal control sequences and truncated to 64 KiB before it reaches a `<pre>` element.

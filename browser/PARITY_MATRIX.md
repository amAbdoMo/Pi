# Pi Harness parity matrix

Target reference: DeepSeek Harness `@deepseek-ai/dsh@0.1.1-rc.2`, upstream tag `dsh-v0.1.1-rc.2`, commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

Status meanings: **verified** = exercised against real Pi RPC and compared with the live reference; **implemented** = present with focused automated checks but not yet fully compared; **in progress** = partial; **pending** = not yet implemented; **blocked** = prerequisite or safe mapping is unresolved.

## Source and security decision

| Area | Decision | Status |
| --- | --- | --- |
| Upstream provenance | Pin the exact full commit and preserve the DeepSeek MIT license. | verified |
| Frontend reuse | Use a source-derived Pi client rather than the compiled DSH frontend. The rc.2 shell requires Cordis boot globals, DSH RPC/WebSockets, dynamic `new Function`/`eval`, and dynamic styles that conflict with Pi's strict CSP. | verified |
| Runtime | Pi RPC remains canonical. No DeepSeek agent runtime is included. | verified |
| Browser security | Preserve loopback-only binding, fragment-to-namespaced-HttpOnly-cookie bootstrap, exact Origin checks, bounded payloads, static containment, opaque session IDs, redacted browser events, and fail-closed approvals. | verified |
| Session identity | Persist a private catalog ID secret; separate it from the per-launch browser token. | implemented |
| Reload and lock recovery | Return the active opaque browser session in `/api/state`, make same-workspace opens idempotent, restore the browser after reload, recover dead-process locks after a forced server stop, and release locks after fatal bridge errors even if disposal fails. | verified |
| Catalog privacy | Return bounded names, leaf workspace labels, and timestamps only; do not return first-message excerpts or transcript bodies. | implemented |

## Shell and navigation

| Reference behavior | Pi mapping | Status |
| --- | --- | --- |
| 280px source-derived sidebar, branded header, new-session bar, workspace tree, footer settings | Pi Harness shell with Pi identity and existing session catalog | in progress |
| Sidebar collapse/expand with reduced-motion support | Local shell state with automatic collapse when crossing the 600 px narrow breakpoint; no backend action | implemented |
| Search sessions | Filter bounded catalog metadata | implemented |
| View options: group by workspace/list and manual/recent order | Persistent WorkSpace/In one list and Manual/Last updated controls over opaque workspace groups; groups collapse to five sessions and flat catalogs reveal 50 at a time while search returns all matches | implemented |
| Add workspace/native directory picker | Current safe fallback asks for an existing path; native picker adapter pending | in progress |
| Session selection and new workspace | Server resolves opaque saved-session IDs or validates an existing directory | implemented |
| Three-column conversation/details layout | Source-derived center and details columns; live checks confirmed bounded transcript and 190 px tool-detail rendering without page overflow | verified |
| Settings dialog sections | Pi-only General, Models, and Extensions surfaces; the live narrow dialog stayed inside the 8 px boundary and restored focus on Escape | verified |
| Dark/light/system theme | Local browser appearance only | implemented |
| Wide 1440×900 reference layout | Live shell, composer, transcript, and expanded details-panel geometry remained horizontally contained | verified |
| Narrow 390×844 behavior | Pi intentionally improves on rc.2 clipping: the live page remained horizontally contained, the sidebar collapsed to 56 px, the composer remained 293 px wide, and model/settings surfaces stayed within the 8 px viewport boundary. | verified |

## Conversation and composer

| Reference behavior | Pi mapping | Status |
| --- | --- | --- |
| Empty hero, workspace/mode chips, floating composer | Pi Harness source-derived shell | in progress |
| Restored messages | Sanitized `get_messages` through Pi RPC, exercised on a real saved session and page reload | verified |
| User/assistant/thinking/tool/result/error/custom message families | Installed Pi event/message projection with an explicit mapping or safe-ignore decision for every documented RPC event; unknown custom payloads are discarded server-side | implemented |
| Streaming text/thinking without duplicates | Indexed Pi `message_update` assembly with authoritative, once-only `message_end` reconciliation | implemented |
| Markdown, code blocks, copy affordances | Dependency-free DOM renderer for headings, lists, links, tables, fenced/inline code, plus accessible message/code copy feedback; raw HTML and non-external link protocols remain inert text | implemented |
| Multiline composer and Enter/Shift+Enter | Pi prompt submission | implemented |
| Busy steer/follow-up behavior | Pi `steer` and `follow_up` | implemented |
| Abort and queue controls | Persistent Steer/Follow up selection, live queue counts, `clear_queue` before `abort`, queued-text/reference restoration, and shared Escape/stop-button handling; Escape abort was exercised during a real approved long-running tool call. | verified |
| Commands suggestions | Sanitized `get_commands` inventory with trigger and typed-slash filtering, keyboard selection, and insertion, exercised against the current real Pi command inventory | verified |
| Attachments/images/reference chips | Up to ten browser-provided attachments share a 3 MB decoded limit. Images retain exact Pi RPC blocks, three-image/1 MB limits, byte-signature and model gating, and path-free transport. UTF-8 text/source files use 512 KB per-file limits, validated MIME/extensions and base names, safe prompt framing, picker/paste/drop chips, and queue recovery; PDFs/binaries are explicitly rejected. Real image and text-reference prompts completed through Pi RPC. | implemented |
| Context/compaction/status surfaces | Bounded Pi session stats, context usage, authoritative auto-compaction state, and manual compaction with a five-minute bounded RPC response window; busy/activity/stat refresh and private-field omission were exercised live. | verified |
| Reconnect and page reload | Active runtime, queue count, and pending approval dialog restore after a live reload; pending dialogs remain bounded, redacted, deduplicated, and replayed after SSE reconnects. | verified |
| Server restart resume | Saved sessions can be reopened with stable IDs; unsaved workspace drafts cannot survive RPC process termination | in progress |

## Pi controls and extensions

| Reference behavior | Pi mapping | Status |
| --- | --- | --- |
| Model and reasoning selector | Sanitized `get_available_models`, `set_model`, and thinking-level RPC commands with searchable provider grouping, exercised against real Pi RPC | verified |
| Agent preset selector | No cosmetic mode is exposed: the control explicitly reports that Pi mode is fixed until a real RPC setting can be mapped; model, thinking, steering, follow-up, skills, and commands remain their separate truthful controls | implemented |
| Permission selector | Browser approval policy and fail-closed non-read-only tool approvals; one-way Pi RPC responses and approval replay were exercised with a real bash approval | implemented |
| Session rename/fork/clone/tree | Bounded rename, lock-safe Pi RPC clone, bridge/lock migration, and confirmed deletion were exercised live through opaque catalog IDs. Message-level fork/tree/export are omitted because no private-path-safe product mapping has been approved. | verified |
| Tools and details panel | Restored tool calls/results open redacted details; live start/update/end events maintained keyboard-accessible activity rows, and a long `ui_learning` result remained bounded in the 190 px details panel | verified |
| Extension notifications/status/widgets/title/editor text | Strict server projection and keyed browser updates for every installed fire-and-forget `extension_ui_request` method | implemented |
| Confirm/select/input/editor requests | Bounded queued native dialogs with required selection, keyboard movement, cancellation, duplicate-ID suppression, and one-way `extension_ui_response`; select completion was exercised live through the current repository extension | verified |
| `ask_user` and grilling | Browser-mode `ask_user` maps sequential questions to standard Pi RPC select/editor/input requests; a live current-source run selected recommended option `Alpha` and returned `ASK_USER_LIVE_OK Alpha`. TUI mode retains the native framed picker. | verified |
| MCP Hub and `/mcp` | Existing `mcp` tool and command flow with explicit running/completed/failed activity labels and the shared bounded/redacted detail contract | implemented |
| Plans and `/workflow` | Existing `plan_progress` and `workflow_run` tools with explicit lifecycle labels; live plan requests displayed running and failed states without disrupting the session | verified |
| Subagents/jobs/side chat | Existing `delegate` tool with immediate running/completed/failed activity; child paths and process IDs are redacted | implemented |
| Memory, skills, prompt templates | Existing `memory`/`ui_learning` tools use explicit lifecycle labels; a read-only live lesson-list request displayed running and completed states, while sanitized `get_commands` discovery exposes skills/templates without source paths or private file contents | verified |
| `/ui-lessons` | Existing approval-gated UI-learning extension; real WordPress validation required | pending |

## Interaction and release evidence

Local release evidence includes focused and full tests, public/package/CSP scans, `git diff --check`, real Pi RPC streaming/abort/model/UI approvals, session rename/clone/delete, current-source browser `ask_user`, integration success/failure activity, and managed-browser checks at 390×844, 768×1024, 1280×720, and 1440×900. Live checks confirmed zero application-console errors, no horizontal page overflow, 8 px popup/dialog containment, Escape/focus restoration, accurate sidebar `aria-expanded`, and bounded details content. Browser security software injected its own Kaspersky-origin requests, but the application loaded no foreign scripts and every Pi Harness API request remained loopback. Reduced motion and the broader control-state matrix remain automated regression checks. The Windows `ENOTEMPTY` UI-learning test-cleanup race was hardened with bounded native `fs.rm` retries. The final post-live run passed setup/public/CSP gates, 324/324 Node tests, and 67/67 workflow tests. Remote green CI and user-facing parity approval require a later push/release decision. No item in this matrix implies release readiness unless marked **verified** with reproducible evidence.

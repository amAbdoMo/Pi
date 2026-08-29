# UI Learning Loop

A global Pi extension that captures repeated WordPress/UI corrections into a private local lesson queue and supplies an approval-gated `skill-creator` review workflow before `wp-ui-quality` changes.

## Safety model

- Capture is automatic; promotion is not.
- The extension never edits a skill, project, or website.
- Raw assistant responses are not stored.
- Correction text is locally redacted and capped at 1,200 characters.
- Exact repeats and known equivalent issue categories are grouped and counted.
- A promoted or dismissed lesson reopens when the same issue recurs; project-only lessons reopen only for the same project and stay isolated from other project paths.
- Workflow instructions require agent approval and regression evaluation; the extension separately requires a final interactive confirmation before its tool records a final status.

The queue is stored with private file/directory modes where the platform supports them. Full paths remain local for project-scope matching; model-facing lesson details expose only final project/session labels.

`~/.pi/agent/ui-learning/lessons.json`

## Commands

- `/ui-learning` — show status and lesson counts.
- `/ui-learning on|off` — enable or disable automatic capture.
- `/ui-learn [correction]` — manually add a missed correction.
- `/ui-learning-history` — optionally import redacted candidates from past Pi sessions.
- `/ui-lessons` — review pending or already-reviewing lessons interactively.

`/ui-lessons` can route a candidate back to the agent with instructions to classify it, generalize it, propose exact skill/eval changes, and display a structured `ask_user` approval card with a title, evidence-rich context, and global/project/pending/dismiss choices before validation and promotion.

## Automatic capture

A candidate is captured when the user's input has UI context and a correction signal such as “still,” “again,” “wrong,” “I prefer,” “not centered,” or “instead of.” Mid-stream UI steering is captured only when it also contains a corrective action signal. Ordinary new UI requests are not automatically treated as lessons. Known equivalent phrases are grouped into categories such as control vertical alignment, dropdown clipping, spacing symmetry, focus treatment, custom-control consistency, and card layout.

The agent can also use the `ui_learning` tool to capture, inspect, or update queue status. Marking a lesson promoted, project-only, or dismissed requires both an explicit user-confirmation flag and a final interactive confirmation rendered by the extension.

## Activation

Run `/reload` after installing or changing the extension. The `wp-ui-quality` skill should also be reloaded in the same operation.

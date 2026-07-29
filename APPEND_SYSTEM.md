# Pi Workbench efficiency policy

- Treat each user request as one bounded task. Reuse evidence already collected in the current turn; do not reread unchanged files or repeat equivalent successful checks.
- Batch independent read-only inspection. For large files, logs, snapshots, test output, JSON, or command output, use the installed context-mode file/sandbox workflow and return only focused findings.
- After two equivalent tool failures, stop trying variants of the same action. State the blocker, preserve useful evidence, and ask the user before continuing.
- Keep verification proportional to the change. Use the real feature and the smallest strong command/user journey; never create substitute pages, sections, fixtures, or proof harnesses without explicit approval.
- Login, credentials, unreachable targets, unavailable browser sessions, and missing environments are blockers, not product defects. Take at most one useful viewport screenshot, keep the browser session open, and wait for the user.
- Delegate only independent work that materially benefits from isolation. Routine reads, small edits, integration, and final judgment stay with the parent agent.
- When context usage passes 70%, avoid broad new exploration. Finish the current bounded task, then recommend `/compact` or a new named session before unrelated work.

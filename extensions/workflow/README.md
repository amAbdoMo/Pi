# Workflow extension

Pi Workbench includes a built-in `pipeline` workflow and discovers additional lowercase `.yaml` or `.yml` files from:

1. `~/.pi/workflows`
2. `<trusted-project>/.pi/workflows`

Later scopes override earlier scopes by filename-derived workflow ID. Invalid overrides remain visible as diagnostics and do not silently run the overridden definition.

## Built-in pipeline

`pipeline.yaml` runs four phases:

1. `plan`
2. `execute`
3. `verify`
4. `review`

A failed verification routes back to `execute`. Actionable review findings also route back to `execute`; approval ends the workflow. `maxTransitions` bounds retries.

Run `/workflow` to list definitions. `/workflow pipeline` asks for a task and workspace: the current folder, another existing folder, or live/remote mode with no local project. Noninteractive forms are `/workflow pipeline --cwd "<folder>" <task>` and `/workflow pipeline --live <task>`.

Local workspaces may be Git or non-Git directories. Every phase receives an explicit workspace contract: Git commands are allowed only after confirming a `.git` entry. Live/remote phases run from an isolated empty directory and use web/MCP evidence instead. The workflow panel and status line update a running spinner and elapsed time every second while a phase is silent or active.

## Definition rules

- Filenames and phase IDs use lowercase letters, numbers, and hyphens.
- YAML is parsed in-process with strict duplicate-key, document-count, alias, and size limits.
- Project workflows load only for trusted projects.
- Each phase runs in an isolated Pi RPC child with configured tools and thinking level, using the selected working directory or an empty live-mode directory.
- Parent Workbench activity projection reports workflow delegates, phase-scoped MCP outcomes, and workflow-driven Codex usage refreshes without merging child and parent process state.
- `nonFatalTools` may name unique tools from an explicit phase `tools` list whose failure permits a documented fallback; every unlisted tool failure remains fatal.
- Structured phase output controls conditional routing.
- `workflow_run` failures are tool errors; callers must not treat them as successful orchestration.

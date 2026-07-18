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

Run `/workflow` to list definitions, `/workflow pipeline` to enter a task interactively, or `/workflow pipeline <task>` to start immediately.

## Definition rules

- Filenames and phase IDs use lowercase letters, numbers, and hyphens.
- YAML is parsed in-process with strict duplicate-key, document-count, alias, and size limits.
- Project workflows load only for trusted projects.
- Each phase runs in an isolated Pi RPC child with configured tools and thinking level.
- Structured phase output controls conditional routing.
- `workflow_run` failures are tool errors; callers must not treat them as successful orchestration.

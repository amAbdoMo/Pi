# Workflow extension

Pi Workbench discovers lowercase `.yaml` or `.yml` workflows from three scopes, with later scopes overriding the same filename-derived workflow ID:

1. Built-ins in this extension
2. `~/.pi/workflows`
3. `<trusted-project>/.pi/workflows`

Invalid overrides remain visible as diagnostics and do not silently run a different definition.

## Built-in workflows

### `pipeline` — focused default

`pipeline.yaml` runs four isolated phases:

1. `plan` gathers targeted evidence without edits.
2. `execute` implements directly for small work and is instructed to use no more than two useful independent delegates.
3. `verify` performs one proportional real-feature pass and returns `PASS`, `FAIL`, or `BLOCKED`.
4. `review` performs one direct correctness/security/contract review without a delegate panel.

The phases are tuned for the everyday mix of Pi Workbench, WordPress/WooCommerce, and live-site work:

- Phases have access to the context-mode sandbox tools (`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_fetch_and_index`, `ctx_index`) so large logs, test output, and docs are processed in-sandbox and only derived findings enter the conversation. Network-dependent tools are marked non-fatal.
- WordPress/WooCommerce work must target the real plugin, theme, or staging/local site. Standalone HTML review pages, mocked WordPress pages, and synthetic fixtures are forbidden unless the user explicitly approved one. Without a real WordPress environment, Verify runs source/lint/static checks and states `Not tested in a real WordPress environment.` instead of returning `BLOCKED`.
- Execute enforces repository discipline (canonical checkout at `C:\Users\COMPUMARTS\Projects\Pi`; managed clones stay read-only), WordPress code standards (core-API-first, HPOS-safe, escaping, nonces plus capabilities), UI conventions (fully styled controls, no outline focus rings, short microcopy), and depth-1 delegation with fast/deep/critical profiles.
- Review maps its scope to the installed guard skills: `clean-code-guard`, `wp-guard`, `woo-guard`, `test-guard`, and `docs-guard`.

One `FAIL` can route back to Execute. `BLOCKED` ends immediately for login, credentials, target access, browser availability, environment availability, or a failure that remains after the remediation pass. `maxTransitions: 7` allows one remediation to reach final review while preventing a second repair cycle.

The Verify phase must use the real feature. It does not create substitute pages, sections, fixtures, or proof harnesses. When access is blocked, it may take one viewport screenshot only if useful, then returns `BLOCKED` instead of trying browser variants.

### `deep-review` — explicit high-risk workflow

`deep-review.yaml` preserves the extended multi-agent workflow: four bug hunters, architecture and security review, consensus filtering, fact-checking, judging, and a larger transition budget. Use it for release-critical, security-sensitive, or unusually risky changes rather than routine work.

## Running a workflow

Interactive commands:

```text
/workflow pipeline
/workflow deep-review
```

Inline workspace forms:

```text
/workflow pipeline --cwd "C:\path\to\project" Implement and verify the requested change
/workflow pipeline --live Inspect the live target
/workflow deep-review --cwd "C:\path\to\project" Review a release-critical change
```

Local workspaces may be Git or non-Git directories. Every phase must confirm a `.git` entry before a Git command. Live mode runs from an isolated empty directory and uses web or MCP evidence without local-project assumptions.

Each phase runs in an isolated Pi RPC child with `PI_WORKFLOW_CHILD=1`, keeping phase tools, context, and failures separate from the parent session.

The workflow panel and status line show a running heartbeat and elapsed time. Child delegates and MCP outcomes are projected into the parent Workbench without merging process state, and Codex usage refreshes during and after the run.

## Definition rules

- Filenames and phase IDs use lowercase letters, numbers, and hyphens.
- YAML is parsed in-process with duplicate-key, document-count, alias, and size limits.
- Project workflows load only for trusted projects.
- `nonFatalTools` must be unique members of an explicit phase `tools` list. Every unlisted tool failure remains fatal.
- Structured phase output controls conditional routing.
- `workflow_run` failures are tool errors and must not be treated as successful orchestration.

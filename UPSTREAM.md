# h4ni0 upstream audit

This setup originated from [h4ni0/pi](https://github.com/h4ni0/pi). Upstream changes are reviewed and ported selectively; the repository is never merged or copied wholesale over Pi Workbench.

## Last verified upstream

- Branch: `master`
- Commit: `610ae5690ff7578f49f6d460a20287955d1beabb`
- Verified: 2026-07-18
- Previous baseline: `66477e49dcc8`

## Changes ported from the current upstream

### Workflow v2

Pi Workbench ports the workflow v2 schema, runner, RPC transport, render contracts, and regression suite introduced by upstream commit `610ae569`.

Intentional packaging and portability differences:

- Upstream tracks `pipeline.example.yaml` but keeps the runnable `~/.pi/workflows/pipeline.yaml` operator-owned. Pi Workbench ships `extensions/workflow/pipeline.yaml` as a built-in so `/workflow pipeline` works on every installation immediately.
- Built-ins load before global and trusted-project workflow directories; a same-ID user definition overrides the built-in without modifying package files.
- Runtime dependencies (`yaml` and `typebox`) are pinned in the root package instead of a nested machine-local workflow package.
- Tests run through the root npm validation gate with Vitest rather than upstream's Bun- and `/home/h4ni0`-specific scripts.
- Windows workflow shutdown uses bounded `taskkill /T /F` process-tree termination; POSIX retains process-group TERM→KILL cleanup.
- Pi Workbench adds parent-visible workflow delegate/MCP activity, workflow-aware Codex usage polling, and explicit per-phase `nonFatalTools` fallback policy; child execution remains process-isolated.
- Upstream's machine-specific audit/deployment files, external `workflow-ui`, operator `SPECS.md`, and copied `node_modules` are not packaged.

### GPT-5.6 Fast mode

Pi Workbench ports the GPT-5.6 model support from upstream commit `0517092`, covering `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra` while retaining GPT-5.4 and GPT-5.5.

## Recent upstream work not yet ported

Upstream Agent v2 (`d6f5eeb` and follow-up fixes through `730130b`) adds persistent root-tree collaboration, broker/mailbox routing, lifecycle recovery, non-delegated login-session support, wait fixes, and duplicate-completion suppression. It overlaps Pi Workbench's customized nested delegate runtime, optional child model/thinking profiles, overlays, and verification loop, so it requires a separate migration and must not be copied wholesale.

Upstream also changed the header to show weekly Codex usage instead of the five-hour window. Pi Workbench intentionally retains both five-hour and weekly indicators with subagent-aware refresh polling.

The expanded upstream `APPEND_SYSTEM.md` and MIT license remain separate review items.

## Intentional shared-file differences

- `.gitignore` — package/build/runtime exclusions for the portable repository.
- `APPEND_SYSTEM.md` — Pi Workbench relies on its packaged extension and agent-policy layers rather than copying upstream operator instructions blindly.
- `extensions/ui/header.ts`, `state.ts`, and `types.ts` — current workbench layout plus both Codex usage windows.
- `extensions/ui/index.ts` and `terminalEditor.ts` — workbench shell, clipboard behavior, context-aware `Tab`, RTL handling, and plan/build integration.
- `extensions/subagents/` — current customized delegate runtime pending a dedicated Agent v2 migration.
- `extensions/workflow/` — upstream v2 foundation with built-in pipeline and cross-platform packaging changes described above.
- `themes/hypr-waves.json` — Pi Workbench's black-background workbench variant.

## Upstream-only configuration files

- `settings.json` — replaced by `settings.example.json` plus `scripts/apply-config.mjs`, preventing runtime fields and credentials from entering Git.
- `npm/.gitignore` — unnecessary because dependencies are managed by the root package metadata.

## Header icons retained from upstream

- Folder: `󰉋`
- Git branch: ``
- Model: `󰧑`
- Context: `󰍛`
- Session: ``

These glyphs require a Nerd Font. The Windows installer provisions DejaVu Sans Mono Nerd Font 3.4.0 and configures detected Windows Terminal and Warp settings; other platforms must configure a compatible Nerd Font separately.

## Future audit procedure

Fetch h4ni0/pi into a separate temporary checkout, compare tracked files and commits, review each upstream change, and port useful behavior selectively with local regression tests. Never merge or copy the upstream repository wholesale over this package.

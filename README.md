# Pi Workbench

[![Validate Pi setup](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml/badge.svg)](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml)

My custom coding-agent harness built on [Pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent): a full-screen terminal workbench with structured agent workflows, subagents, an owned MCP hub, live Codex usage windows, Arabic/RTL support, and one-command setup.

Not a fork — Pi stays the runtime (models, sessions, tools, packages). Everything here ships as extensions, a theme, portable settings, and installers on top of it.

## What it adds

| Area | Highlights |
| --- | --- |
| **Workbench UI** | Fixed sidebar (session / context / usage resets / activity / MCP status), anchored composer showing model, thinking level, and live Codex `5h` / `7d` usage bars |
| **Agent workflows** | Task progress cards, nested subagents with tuned GPT-5.6 profiles (`fast` / `balanced` / `implementation` / `review` = Luna-max, `deep` / `critical` = Sol), side chat, and `pipeline` + opt-in `deep-review` four-phase workflows with blocker-aware routing |
| **Tools & integrations** | Owned MCP Hub (JSON/JSONC, discovery, calls, secret redaction), Windows shared-browser supervisor with persistent logins, Firecrawl web tools, image generation, persistent memory, approval-gated WordPress UI lesson queue, fast mode, code-state undo/redo |
| **Terminal & language** | Arabic shaping + bidirectional ordering (code/paths stay LTR), pinned Nerd Font, Windows Terminal & Warp provisioning, graphite `hypr-waves` theme |

## Install

Requires Git and Node.js 20+. The bootstrap installs the pinned Pi runtime, extensions, settings, fonts, FFmpeg integration, and browser supervisor; provider authentication remains a separate user action.

```bash
npx --yes github:amAbdoMo/Pi@v0.13.0 install
```

From an owned Windows clone:

```powershell
.\setup.ps1 diagnose
.\setup.ps1 install
.\setup.ps1 verify
.\setup.ps1 rollback                 # restores the latest checkpoint
```

Use `--skip-ffmpeg` or `--skip-terminal` with the `npx` command, or `-SkipFfmpeg` / `-SkipTerminal` with `setup.ps1`, when those optional integrations are not wanted. Install creates a non-secret checkpoint under `~/.pi/agent/bootstrap-checkpoints/` before changing managed configuration. It preserves model/thinking preferences and never checkpoints auth files, sessions, trust decisions, credentials, cookies, or browser profiles.

Package only (extensions + theme, no shared settings):

```bash
pi install git:github.com/amAbdoMo/Pi@v0.13.0
```

Upgrades are explicit: run the bootstrap for the next tagged release. Pinned Pi packages are intentionally skipped by `pi update --extensions`.

## Everyday controls

| Control | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Autocomplete / thinking level |
| Mouse wheel, `PgUp`/`PgDn` | Scroll chat during and after runs |
| Mouse drag + `Ctrl+C` | Select and copy exact text |
| `/sidebar` `/todos` `/agents` `/btw` | Sidebar · tasks · subagents · side question |
| `/workflow pipeline` | Run the focused four-phase workflow |
| `/mcp` `/skills` `/memory` `/fast` `/undo` | Hub · skills · memory · fast mode · checkpoints |
| `/ui-learning` `/ui-lessons` | WordPress UI lesson queue · review pending lessons |

Defaults for fresh installs: `hypr-waves` theme, `openai-codex` provider, `gpt-5.6-sol`, thinking `high`.

## Workflows & MCP in brief

```text
/workflow pipeline --cwd "C:\path\to\project" Implement and verify X   # noninteractive form
```

`pipeline` plans with evidence, caps delegates, verifies once, allows one repair cycle, and reports `BLOCKED` instead of looping when something external is missing. `deep-review` adds multi-agent consensus for release-critical work. Lowercase YAML in `~/.pi/workflows` overrides globally; project `.pi/workflows` wins.

MCP servers live in `~/.pi/agent/mcp.jsonc`. Configure, connect, and inspect via `/mcp` — statuses show in the sidebar.

## Development

```bash
git clone https://github.com/amAbdoMo/Pi.git && cd Pi && npm ci && npm test
```

The development test suite uses Node.js 22.15+ for synchronous TypeScript test hooks; installing and running the package remains supported on Node.js 20+. `npm test` includes the public-file secret/private-path scan; run `npm run scan:public` for that safety gate alone.

Develop in a normal clone — Pi owns its managed checkout under `~/.pi/agent/git/...` and may reset it.

## Privacy & credits

No auth files, sessions, trust decisions, or credentials are stored here; the checked-in audit contains only anonymous aggregates and fails closed on private data. Built on [Pi](https://github.com/earendil-works/pi-mono); retains selected foundations from [h4ni0](https://github.com/h4ni0) — see [`UPSTREAM.md`](UPSTREAM.md).

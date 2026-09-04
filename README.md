# Pi Workbench

[![Validate Pi setup](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml/badge.svg)](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml)

Pi Workbench turns [Pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent) into a complete coding workspace for the terminal and browser. Pi still owns the models, sessions, tools, and package system; this project adds the interface, workflows, integrations, and installer around it.

## Install

You need **Git** and **Node.js 20 or newer**.

1. Install the complete Workbench setup:

   ```bash
   npx --yes github:amAbdoMo/Pi install
   ```

2. Restart your terminal, then open Pi:

   ```bash
   pi
   ```

3. Sign in to your model provider when Pi asks. Accounts and API keys are not bundled.

To open the browser interface:

```bash
npx --yes github:amAbdoMo/Pi web
```

The command prints a private local URL. Pi Harness only listens on your computer at `127.0.0.1:3081`.

Useful setup commands:

```bash
npx --yes github:amAbdoMo/Pi diagnose   # check without changing anything
npx --yes github:amAbdoMo/Pi verify     # verify the installation
npx --yes github:amAbdoMo/Pi rollback   # restore the latest checkpoint
```

Add `--skip-ffmpeg` or `--skip-terminal` to `install` if you do not want those optional integrations. To install only the Pi extensions and theme—without shared settings, fonts, FFmpeg, or terminal setup—run:

```bash
pi install git:github.com/amAbdoMo/Pi@v0.13.0
```

## What is included

| Area | What you get |
| --- | --- |
| **Terminal Workbench** | Full-screen chat, session sidebar, tasks, subagents, MCP activity, context usage, Codex `5h`/`7d` limits, model/thinking controls, precise scrolling and copying, image display, and code undo/redo. |
| **Pi Harness for browsers** | Local authenticated UI with session search/grouping/pinning/archive, rename/clone/delete, streaming Markdown and code, working animations, tool details, themes, responsive layout, context/compaction controls, account switching, and model/provider/extension/MCP settings. |
| **Agent workflows** | Automatic task tracking, adaptive Luna/Sol subagents, side chat, a focused `pipeline` workflow, and an opt-in `deep-review` workflow for higher-risk work. |
| **Files and queues** | Image and UTF-8 text/source attachments, paste/drop support, Steer or Follow up queues, queue recovery, stop controls, and reconnect-safe approvals. |
| **Tools** | MCP Hub, shared Edge browser with persistent logins, Firecrawl web research, image generation, persistent memory, skills, fast mode, and an approval-gated WordPress UI learning queue. |
| **Terminal and language** | Arabic shaping and RTL support while code stays LTR, the `hypr-waves` theme, Nerd Font setup, Windows Terminal/Warp support, and optional FFmpeg provisioning. |
| **Safety** | Checkpoints before install, loopback-only browser access, tool approvals, secret redaction, bounded browser payloads, public-file scans, and CSP checks. |

## What is not included

- Model access, paid subscriptions, provider accounts, API keys, or automatic sign-in.
- A hosted cloud service or public browser endpoint; Pi Harness is local-only.
- Your sessions, credentials, browser profile, trust decisions, or private project files.
- DeepSeek Harness's agent runtime or JavaScript evaluator. Only selected MIT-licensed UI patterns are adapted to Pi RPC.
- PDF or arbitrary binary attachments in Pi Harness; it currently accepts supported images and UTF-8 text/source files.
- A byte-for-byte DeepSeek Harness clone. Remaining browser parity work is listed in [`browser/PARITY_MATRIX.md`](browser/PARITY_MATRIX.md).

## Everyday commands

| Command | Purpose |
| --- | --- |
| `/workflow pipeline` | Plan, implement, verify, and review one task. |
| `/workflow deep-review` | Add multi-agent consensus for release-critical work. |
| `/todos` · `/agents` · `/btw` | Tasks, subagents, and side chat. |
| `/mcp` · `/skills` · `/memory` | Integrations, skills, and persistent memory. |
| `/fast` · `/undo` | Faster model mode and code checkpoints. |
| `/ui-learning` | Review the WordPress UI lesson queue. |

Fresh installs use the `hypr-waves` theme, `openai-codex`, `gpt-5.6-sol`, and high thinking by default.

## Optional Windows startup

From an owned clone, Pi Harness can start quietly when you sign in:

```powershell
npm run browser:startup:install
npm run browser:startup:status
npm run browser:startup:uninstall
```

## Development

```bash
git clone https://github.com/amAbdoMo/Pi.git
cd Pi
npm ci
npm test
```

Running Pi requires Node.js 20+. The full development test suite requires Node.js 22.15 or newer. Develop in a normal clone, not Pi's managed checkout under `~/.pi/agent/git/`.

More detail: [`browser/INTEGRATIONS.md`](browser/INTEGRATIONS.md) · [`browser/EVENT_COVERAGE.md`](browser/EVENT_COVERAGE.md) · [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) · [`CHANGELOG.md`](CHANGELOG.md)

No credentials or private sessions are stored in this repository. Built on Pi, with credited foundations in [`UPSTREAM.md`](UPSTREAM.md).

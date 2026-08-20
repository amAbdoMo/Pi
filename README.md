# Pi Workbench

[![Validate Pi setup](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml/badge.svg)](https://github.com/amAbdoMo/Pi/actions/workflows/validate.yml)
[![Pi package](https://img.shields.io/badge/Pi-package-E8364F)](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent)

A polished, opinionated terminal workbench for [Pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), packaged as extensions, a theme, portable settings, and one-command setup.

Pi Workbench is **not a fork of Pi**. Pi remains the runtime and provides models, sessions, built-in tools, package loading, and extension APIs. This package keeps that foundation intact and adds a more structured interface, agent workflows, integrations, RTL support, and cross-device terminal setup.

## Why Pi Workbench?

Pi intentionally starts small and expects people to shape it with packages. Pi Workbench is for anyone who wants a ready-made, OpenCode-inspired environment instead of assembling each extension and terminal setting separately.

### What changes compared with default Pi?

| Default Pi | Pi Workbench adds |
| --- | --- |
| Header, message stream, editor, and footer | Full-screen graphite workbench with a fixed responsive sidebar and anchored composer |
| Minimal agent loop; subagents and plan mode are intentionally left to extensions | Plan/build modes, verified task progress, nested subagents, side chat, and reusable workflows |
| MCP integration is left to packages | An owned MCP Hub with JSON/JSONC configuration, discovery, calls, status, caching, cancellation, and secret redaction |
| Built-in file, search, edit, and shell tools | Firecrawl web tools, image generation, persistent memory, tool display, fast mode, and code-state undo/redo |
| Standard terminal text rendering | Arabic shaping, RTL visual ordering, right-aligned composition, and LTR code/path preservation |
| Themes and terminal fonts are configured separately | Hypr Waves theme plus verified Nerd Font, Windows Terminal, and Warp provisioning |
| Standard user/tool rendering | Content-fitted user cards, organized tool output, coordinated dialogs, and activity/status surfaces |

Pi can support all of this through its extension system; the difference is that Pi Workbench ships the pieces together and keeps them portable.

## Highlights

### Workbench interface

- Fixed sidebar sections for session, context, activity, and MCP server states
- Bottom-anchored composer showing mode, model, thinking level, and available Codex usage windows
- Content-fitted user message cards that grow only as wide as their rendered content
- Compact assistant, tool, workflow, side-chat, and subagent presentation
- Coordinated overlays for MCP, skills, agents, child consoles, side chat, workflows, and display settings
- Mouse-wheel and `PageUp`/`PageDown` chat navigation, precise drag selection/copy, and click-to-place composer cursor
- Graphite-black `hypr-waves` theme with orange structure, red accents, and green verified-success states

### Agent workflows

- **Plan/build mode** with context-aware `Tab` switching outside command autocomplete and read-only planning
- **Task progress** using explicit pending, running, completed-with-evidence, and failed states in a scrollable grey task card
- **Subagents** with adaptive GPT-5.6 task profiles, bounded context/fan-out, complete parent-visible results, and parent-owned proportional review
- **Side chat** for temporary questions that do not enter the main conversation context
- **Workflows** with focused `pipeline` and opt-in `deep-review` routes, strict YAML validation, blocker-aware routing, isolated phase sessions, and safe global/project overrides
- **Fast mode** for supported GPT-5.4, GPT-5.5, and GPT-5.6 tiers, plus code-state undo/redo and custom tool rendering

Subagent profile defaults are `fast`, `balanced`, `implementation`, and `review` (Luna/max), `deep` (Sol/medium), and `critical` (Sol/high). Explicit model/thinking values override a profile. Simultaneous fan-out is capped at three active children, recursive delegation is opt-in through `subagents.maxDepth`, compact handoffs are reused within a parent turn, and oversized child results are summarized through the configurable `subagents.summaryProfile` before returning to the parent.

### Tools and integrations

- Owned MCP Hub for local stdio and remote streamable-HTTP servers
- Firecrawl-backed search, scrape, map, and crawl tools
- OpenAI image generation and image editing
- Persistent user, global, and project memory
- Scrollable `/skills` browser without filling slash-command autocomplete with every skill
- Optional `npm:context-mode` companion installed by the setup script

### Terminal and language support

- Arabic presentation shaping and bidirectional visual ordering
- Mixed Arabic and English support with code, commands, URLs, and paths kept LTR
- DejaVu Sans Mono Nerd Font 3.4.0 on Windows
- Arabic cursive and required-ligature features enabled in Windows Terminal
- Windows Terminal and Warp configuration with one-time backups
- Compact text/image clipboard markers and Warp-compatible image paste handling

> Terminal applications still render on a fixed cell grid. Pi Workbench improves Arabic order and shaping, but final joining quality depends on the terminal and font renderer.

## Install

A working Pi installation, Git, and Node.js 20 or newer are required. Pi packages execute code with the same access as Pi, so review third-party packages before installing them.

### Full setup — one command

```bash
npx --yes github:amAbdoMo/Pi
```

This convenience command installs the current default branch directly from GitHub; npm publication is not required. Add `--skip-ffmpeg` to leave video tools unchanged.

<details>
<summary>Direct installer alternatives</summary>

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.ps1 | iex
```

macOS, Linux, or Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.sh | bash
```

</details>

The direct alternatives fetch helper files from the current `main` branch; use the npx command when revision-local installer assets are required.

The installer is designed to be run again. It:

1. Removes the retired Hypa package from shared settings and Pi-managed package storage without adding antivirus exclusions. Ambiguous user-level command shims are preserved.
2. Installs or updates the Pi Workbench git package and the optional context-mode companion.
3. Removes duplicate development checkouts and the retired external MCP adapter from shared settings.
4. Applies safe defaults without replacing existing model or thinking preferences.
5. Installs or refreshes the managed global agent policy in `~/.pi/agent/APPEND_SYSTEM.md` while preserving personal instructions outside its marked block.
6. Creates an empty personal `mcp.jsonc` only when one does not already exist.
7. Installs and verifies FFmpeg plus FFprobe through an already available trusted system package manager so screen recordings can be inspected. No media binaries are bundled; unsupported or non-privileged systems receive a warning with manual installation guidance instead.
8. On Windows, installs the pinned Nerd Font and updates detected Windows Terminal and Warp settings after creating backups.

> **Hypa security note:** `npm:@hypabolic/pi-hypa` is no longer installed by this setup after a native Windows executable under that package triggered an antivirus detection. The reviewed `@hypabolic/hypa-win32-x64@0.1.13` artifact is unsigned. Its available provenance does not prove that verdict is either malicious or a false positive, so the installer removes the package rather than weakening antivirus protection.

### Package only

To load the extensions and theme without applying the shared settings or terminal configuration:

```bash
pi install git:github.com/amAbdoMo/Pi
```

Select `hypr-waves` from Pi settings if it is not already active.

## Everyday controls

| Control | Action |
| --- | --- |
| `Tab` | Complete active or slash-command autocomplete; otherwise switch between plan and build modes |
| `Shift+Tab` | Change thinking level |
| Mouse wheel or `PageUp` / `PageDown` | Scroll the chat viewport during and after agent activity; scrolling up holds position while output continues |
| Mouse drag | Select the exact Workbench text range without copying; holding at the chat edge auto-scrolls into off-screen rows, and `Ctrl+C` copies and clears the selection |
| Mouse click in composer | Place the typing cursor at the clicked character, including wrapped and RTL text |
| `Shift+drag` | Use the terminal's native selection instead of Workbench selection |
| `/sidebar` | Toggle the workbench sidebar |
| `/plan`, `/build`, `/todos` | Control mode and inspect task progress |
| `Alt+S` or `/agents` | Open subagent management |
| `/btw` or `/side` | Ask a temporary side question |
| `/workflow` | List workflows or run focused `pipeline` or opt-in `deep-review` |
| `/mcp` | Configure, connect, disconnect, and inspect MCP servers |
| `/skills` | Browse loaded skills |
| `/memory` | Manage persistent memory |
| `/fast` | Toggle fast mode |
| `/undo`, `/redo` | Navigate code-state checkpoints |
| `/tool-display` | Configure custom tool rendering |
| `Ctrl+V` / `Alt+V` | Paste text or use the Windows image-paste path |

Tracked plan tasks remain in the live widget while work is running. When the final task completes, the widget is removed and a normal scrollable `Plan Complete` transcript entry is inserted before the assistant's final response.

## Workflows

Pi Workbench ships two portable four-phase workflows:

- `pipeline` is the focused default for everyday work. It plans with targeted evidence, instructs phases to use no more than two useful delegates, verifies the real feature once, permits one repair cycle, and performs one direct review. Verification can return `BLOCKED` for login, credentials, target, browser, or environment limitations; `BLOCKED` ends the workflow instead of routing back to Execute.
- `deep-review` preserves the previous extended pipeline with multi-agent bug-hunter consensus, architecture/security review, fact-checking, judging, and a larger transition budget. Use it explicitly for release-critical, security-sensitive, or unusually risky work.

Run either workflow interactively:

```text
/workflow pipeline
/workflow deep-review
```

Pi asks whether to use the current folder, another existing folder, or no local folder for a live/remote task. Noninteractive forms are:

```text
/workflow pipeline --cwd "C:\path\to\project" Implement and verify the requested change
/workflow pipeline --live Inspect the live-site behavior
/workflow deep-review --cwd "C:\path\to\project" Review a release-critical change
```

Local folders do not have to be Git repositories. Every phase confirms a `.git` entry before using Git; live/remote runs use an isolated empty working directory and web/MCP tools. Workflow phases remain isolated RPC children.

The panel and status line show phase activity and elapsed time. Delegates and MCP outcomes are projected into the parent Workbench without merging child process state, and Codex usage refreshes throughout the run and after settlement.

Built-ins are always available. Lowercase YAML files in `~/.pi/workflows` override or extend them globally; files in a trusted project's `.pi/workflows` directory take final precedence. Invalid overrides are reported instead of silently falling back.

## MCP configuration

Personal servers live in `~/.pi/agent/mcp.jsonc` (`$HOME\.pi\agent\mcp.jsonc` on Windows). JSON and JSONC are accepted, including comments and trailing commas.

```jsonc
{
  "mcp": {
    "local-tools": {
      "type": "local",
      "command": ["npx", "-y", "example-mcp"],
      "environment": {
        "EXAMPLE_TOKEN": "value"
      },
      "enabled": true
    },
    "remote-tools": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer value"
      }
    }
  }
}
```

Open `/mcp` and press `R` after changing configuration. Enabled servers remain idle until connected or called; the sidebar reports Connected, Connecting, Disconnected, Disabled, or Error for each server. Global discovery uses cached metadata and does not wake every idle server.

<details>
<summary>Configuration locations and compatibility</summary>

Later files override servers with the same name:

1. `~/.config/mcp/mcp.json`, then `mcp.jsonc`
2. `~/.pi/agent/mcp.json`, then `mcp.jsonc`
3. Trusted project `.mcp.json`, then `.mcp.jsonc`
4. Trusted project `.pi/mcp.json`, then `mcp.jsonc`

The OpenCode-style top-level `mcp` object is recommended. Existing `mcpServers` and `servers` containers are also supported, along with `command` plus `args`, `env`, `disabled`, and `stdio` or `streamable-http` transport names.

OAuth configuration is detected but not yet supported. Keep credentials out of this repository. Prefer inherited environment variables for local servers; remote header values are currently literal configuration values.

</details>

## Defaults

Fresh installations use these values only when an existing preference is absent:

| Setting | Default |
| --- | --- |
| Theme | `hypr-waves` |
| Provider | `openai-codex` |
| Model | `gpt-5.6-sol` |
| Thinking level | `high` |
| Startup | Quiet |
| Terminal progress | Enabled |
| Session tree filter | `no-tools` |

## Update

Update the package without changing terminal settings:

```bash
pi update --extensions
```

Rerun `npx --yes github:amAbdoMo/Pi` when shared settings, companion packages, video tools, fonts, or terminal integration should also be reconciled.

## Project structure

| Path | Purpose |
| --- | --- |
| `extensions/` | Workbench UI, workflows, agents, MCP, tools, memory, and integrations |
| `themes/hypr-waves.json` | Shared terminal theme |
| `settings.example.json` | Safe, portable Pi defaults |
| `keybindings.json` | Shared clipboard and interaction bindings |
| `scripts/` | One-line installation, secure package retirement, FFmpeg provisioning, configuration, terminal setup, validation, privacy-safe session analysis, and report generation |
| `reports/pi-workflow-audit.html` | Standalone public-safe 30-day session and workflow audit |
| `tests/` | Behavior and regression coverage |
| `install.ps1`, `install.sh` | One-command installers and updaters |
| `UPSTREAM.md` | Audited relationship with the original extension source |

## Development

Work in a normal clone, not Pi's managed package checkout:

```bash
git clone https://github.com/amAbdoMo/Pi.git
cd Pi
npm ci
npm test
```

Pi owns `~/.pi/agent/git/github.com/amAbdoMo/Pi` and may reset it during updates. Shared settings can be captured safely with `npm run capture`; authentication, sessions, trust decisions, generated images, and model credentials are intentionally excluded.

Generate the local 30-day audit from the canonical checkout:

```bash
node scripts/analyze-sessions.mjs --help
node scripts/generate-session-report.mjs --days 30
```

The analyzer streams JSONL records and emits aggregate facts plus explicitly labelled heuristics. The generated `reports/pi-workflow-audit.html` is standalone and rejects raw prompts, tool output, session IDs, source paths, UUIDs, credentials, embedded screenshots, and external resources before writing.

## Privacy and safety

- No authentication files, raw session history, trust decisions, or API credentials are stored in this repository.
- The checked-in workflow audit contains only anonymous aggregate metrics and report-local aliases; its generator fails closed on private paths, identifiers, credentials, raw content fields, and embedded images.
- MCP runtime errors and cached metadata are sanitized to reduce accidental secret exposure.
- Project-level MCP configuration is loaded only for trusted projects.
- Local MCP processes and Pi extensions run with the current user's permissions. Review configuration and third-party packages before enabling them.

## Credits

Pi Workbench is built on [Pi](https://github.com/earendil-works/pi-mono) and its extension/package APIs.

The project also retains ideas and selected extension foundations from [h4ni0](https://github.com/h4ni0). See [`UPSTREAM.md`](UPSTREAM.md) for the audited relationship and intentional differences.

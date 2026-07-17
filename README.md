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
- `PageUp`/`PageDown` chat navigation without an in-app scrollbar, with normal terminal-native drag selection and copy
- Graphite-black `hypr-waves` theme with orange structure, red accents, and green verified-success states

### Agent workflows

- **Plan/build mode** with direct `Tab` switching and read-only planning
- **Task progress** using explicit pending, running, completed-with-evidence, and failed states in a scrollable grey task card
- **Subagents** with optional task-specific model and thinking profiles
- **Side chat** for temporary questions that do not enter the main conversation context
- **Workflows** for reusable multi-step operations
- **Fast mode**, code-state undo/redo, and custom tool rendering

### Tools and integrations

- Owned MCP Hub for local stdio and remote streamable-HTTP servers
- Firecrawl-backed search, scrape, map, and crawl tools
- OpenAI image generation and image editing
- Persistent user, global, and project memory
- Scrollable `/skills` browser without filling slash-command autocomplete with every skill
- Optional companion packages installed by the setup script:
  - `npm:@hypabolic/pi-hypa`
  - `npm:context-mode`

### Terminal and language support

- Arabic presentation shaping and bidirectional visual ordering
- Mixed Arabic and English support with code, commands, URLs, and paths kept LTR
- DejaVu Sans Mono Nerd Font 3.4.0 on Windows
- Arabic cursive and required-ligature features enabled in Windows Terminal
- Windows Terminal and Warp configuration with one-time backups
- Compact text/image clipboard markers and Warp-compatible image paste handling

> Terminal applications still render on a fixed cell grid. Pi Workbench improves Arabic order and shaping, but final joining quality depends on the terminal and font renderer.

## Install

A working Pi installation is required. Pi packages execute code with the same access as Pi, so review third-party packages before installing them.

### Full setup — Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.ps1 | iex
```

### Full setup — macOS, Linux, or Git Bash

```bash
curl -fsSL https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.sh | bash
```

The installer is safe to run again. It:

1. Installs or updates the Pi Workbench git package.
2. Installs the optional Hypa and context-mode companions.
3. Removes duplicate development checkouts and the retired external MCP adapter from shared settings.
4. Applies safe defaults without replacing existing model or thinking preferences.
5. Creates an empty personal `mcp.jsonc` only when one does not already exist.
6. On Windows, installs the pinned Nerd Font and updates detected Windows Terminal and Warp settings after creating backups.

### Package only

To load the extensions and theme without applying the shared settings or terminal configuration:

```bash
pi install git:github.com/amAbdoMo/Pi
```

Select `hypr-waves` from Pi settings if it is not already active.

## Everyday controls

| Control | Action |
| --- | --- |
| `Tab` | Switch between plan and build modes |
| `Shift+Tab` | Change thinking level |
| `PageUp` / `PageDown` | Scroll the chat viewport |
| Drag | Select terminal text normally for copy |
| `/sidebar` | Toggle the workbench sidebar |
| `/plan`, `/build`, `/todos` | Control mode and inspect task progress |
| `/agents` | Open subagent management |
| `/btw` or `/side` | Ask a temporary side question |
| `/workflow` | Open reusable workflows |
| `/mcp` | Configure, connect, disconnect, and inspect MCP servers |
| `/skills` | Browse loaded skills |
| `/memory` | Manage persistent memory |
| `/fast` | Toggle fast mode |
| `/undo`, `/redo` | Navigate code-state checkpoints |
| `/tool-display` | Configure custom tool rendering |
| `Ctrl+V` / `Alt+V` | Paste text or use the Windows image-paste path |

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

Rerun the one-command installer when shared settings, companion packages, fonts, or terminal integration should also be reconciled.

## Project structure

| Path | Purpose |
| --- | --- |
| `extensions/` | Workbench UI, workflows, agents, MCP, tools, memory, and integrations |
| `themes/hypr-waves.json` | Shared terminal theme |
| `settings.example.json` | Safe, portable Pi defaults |
| `keybindings.json` | Shared clipboard and interaction bindings |
| `scripts/` | Idempotent configuration, font, Windows Terminal, Warp, capture, and validation helpers |
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

## Privacy and safety

- No authentication files, session history, trust decisions, or API credentials are stored in this repository.
- MCP runtime errors and cached metadata are sanitized to reduce accidental secret exposure.
- Project-level MCP configuration is loaded only for trusted projects.
- Local MCP processes and Pi extensions run with the current user's permissions. Review configuration and third-party packages before enabling them.

## Credits

Pi Workbench is built on [Pi](https://github.com/earendil-works/pi-mono) and its extension/package APIs.

The project also retains ideas and selected extension foundations from [h4ni0](https://github.com/h4ni0). See [`UPSTREAM.md`](UPSTREAM.md) for the audited relationship and intentional differences.

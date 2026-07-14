# amAbdoMo Pi setup

Portable Pi setup containing the custom extensions, theme, companion packages, settings defaults, and keybindings used in this environment.

## Install or update with one command

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.ps1 | iex
```

### macOS / Linux / Git Bash

```bash
curl -fsSL https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.sh | bash
```

The command is safe to run again when this repository changes. It installs the required packages, updates extension packages, removes duplicate local Pi checkout entries and the retired external MCP adapter, applies shared configuration, and creates an empty personal `mcp.jsonc` when needed. On Windows it also installs the pinned `DejaVuSansM Nerd Font Mono` for the current user and configures detected Windows Terminal and Warp settings after backing them up. Warp uses terminal-first classic input for a terminal-oriented PowerShell workflow. Existing model and thinking preferences are preserved; repository defaults are used when those values are missing.

## Included setup

- Full-screen terminal workbench with a fixed responsive sidebar, bottom-anchored composer, scrollable chat viewport, content-fitted user message cards, coordinated modal windows, and the `hypr-waves` graphite theme
- Native mouse text selection and copy, with `PageUp`/`PageDown` chat scrolling and alternate-screen wheel input kept out of composer history
- Automatic Arabic shaping, RTL visual ordering, right-aligned composition, and LTR preservation for code, paths, commands, and metadata
- Verified Windows Nerd Font setup using DejaVu Sans Mono Nerd Font 3.4.0, with Arabic cursive and required-ligature features enabled in Windows Terminal
- Windows Terminal and Warp font configuration, with terminal-first Warp input
- Codex five-hour and weekly usage indicators when OpenAI returns those windows
- Color-highlighted clipboard image markers on Windows, including Warp's image-only paste signal
- Color-highlighted compact multiline-text paste markers on Windows
- Plan/build workflow with the current mode shown in the terminal header:
  - `Tab`, `/plan`, or `Ctrl+Alt+P` switches between read-only planning and full-access building
  - `--plan` starts in planning mode
  - `/build` restores full tool access
  - `/todos` shows plan progress
- Web tools powered by Firecrawl
- Image generation
- Persistent memory
- `/skills` opens a scrollable skill picker while individual `/skill:*` entries stay out of `/` autocomplete
- Subagents support optional task-sized child model and thinking profiles while preserving parent inheritance by default
- Side chat, nested subagents, workflows, fast mode, code-state, and custom tool display
- Owned MCP Hub with local stdio and remote streamable-HTTP servers, lazy connections, cached global discovery that does not wake idle servers, server-scoped search/describe/call actions, bounded output, cancellation, metadata caching, config diagnostics, secret redaction, `/mcp` management, and a dedicated sidebar section showing every configured server state
- Explicit task progress states: pending, running, completed with evidence, and failed
- Companion packages:
  - `npm:@hypabolic/pi-hypa`
  - `npm:context-mode`
- Shared clipboard keybindings and recommended settings

## Current defaults for a fresh setup

- Theme: `hypr-waves`
- Provider: `openai-codex`
- Model: `gpt-5.6-sol`
- Thinking level: `high`
- Quiet startup enabled
- Terminal progress enabled
- Tree filter: `no-tools`

Change thinking level during a Pi session with `Shift+Tab`. `Ctrl+T` only expands or collapses thinking blocks.

## MCP configuration

Add personal MCP servers to `~/.pi/agent/mcp.jsonc` (`$HOME\.pi\agent\mcp.jsonc` on Windows). The installer creates this file with an empty `mcp` object when it does not exist and never overwrites an existing personal configuration. The MCP Hub accepts JSON or JSONC, including comments and trailing commas. Its recommended format is compatible with OpenCode:

```jsonc
{
  "mcp": {
    "local-tools": {
      "type": "local",
      "command": ["npx", "-y", "example-mcp"],
      "environment": {
        "EXAMPLE_TOKEN": "value"
      },
      "enabled": true,
    },
    "remote-tools": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer value"
      },
    },
  },
}
```

The existing `mcpServers` and `servers` containers remain supported, along with `command` plus `args`, `env`, `disabled`, and `stdio` or `streamable-http` transport names. Config files are loaded in this precedence order, with later entries overriding servers of the same name:

1. `~/.config/mcp/mcp.json`, then `mcp.jsonc`
2. `~/.pi/agent/mcp.json`, then `mcp.jsonc`
3. Trusted project `.mcp.json`, then `.mcp.jsonc`
4. Trusted project `.pi/mcp.json`, then `mcp.jsonc`

Open `/mcp` and press `R` after editing a config file, then select a server and press `Enter` to connect. OAuth configuration is detected but not yet supported.

Keep credentials out of this repository. Prefer environment variables inherited by local MCP processes; remote header values are currently literal config values.

## Repository contents

- `extensions/` — all custom Pi extensions, including the owned `extensions/mcp/` Hub and full-screen workbench UI
- `themes/hypr-waves.json` — shared theme
- `settings.example.json` — safe shared settings defaults
- `keybindings.json` — shared keybindings
- `scripts/apply-config.mjs` — idempotent configuration merger used by both installers
- `scripts/capture-config.mjs` — captures safe local settings/keybindings into the repository
- `scripts/setup-terminal-font.ps1` — installs and version-checks the pinned Windows Nerd Font
- `scripts/set-terminal-font.mjs` — safely applies the font to Windows Terminal JSON/JSONC settings
- `scripts/set-warp-settings.mjs` — updates Warp-generated TOML while applying the font and classic input
- `scripts/validate.mjs` — repository validation
- `UPSTREAM.md` — audited relationship with the original `h4ni0/pi` source
- `install.ps1` / `install.sh` — one-command installers/updaters

Private and machine-specific state is intentionally excluded: authentication, sessions, generated images, trust decisions, and custom model credentials.

## Source-of-truth workflow

Treat this GitHub repository as the only editable source of the shared setup.

1. Make custom extension/theme changes in a normal clone of this repository.
2. Do **not** edit `~/.pi/agent/git/github.com/amAbdoMo/Pi`; Pi owns and resets that installed clone during updates.
3. After changing Pi settings or keybindings, capture the safe shared values into the repository:

   ```bash
   npm run capture
   ```

   This intentionally excludes authentication, session history, trust data, and model credentials.
4. Validate changes:

   ```bash
   npm test
   ```

5. Commit and push the changes.
6. Update another device:

   ```bash
   pi update --extensions
   ```

   Or rerun the one-command installer to also reconcile settings and companion packages.

## Troubleshooting

### Duplicate tool conflicts

If paths from both a development checkout and `~/.pi/agent/git/github.com/amAbdoMo/Pi` appear in a conflict, the package is enabled twice. Rerun the installer; it removes local checkout package entries and keeps `git:github.com/amAbdoMo/Pi`.

### UI looks older after an update

Confirm the desired changes were committed and pushed before running `pi update --extensions`. Pi resets its installed clone to GitHub and intentionally removes uncommitted edits from that clone.

### Warp shortcuts or image paste do not reach Pi

Rerun the installer, then close every Warp window and reopen Warp. The installer selects the Nerd Font and terminal-first classic input. `Ctrl+V` handles normal text and image-only clipboard paste; `Alt+V` remains the direct image-paste fallback. Warp still owns global application shortcuts, so use Pi's slash-command equivalent when a custom Warp shortcut conflicts.

The Warp helper fails without changing the settings file when uncommon multiline, quoted-table, or conflicting dotted/inline TOML forms cannot be updated safely. In that case, select the font and classic input through Warp Settings.

## Shoutout

Shoutout to [h4ni0](https://github.com/h4ni0) for the original Pi setup and extensions this package was based on.

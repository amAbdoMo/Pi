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

The command is safe to run again when this repository changes. It installs the required packages, updates extension packages, removes duplicate local Pi checkout entries, and applies the shared configuration. On Windows it also installs the pinned `CaskaydiaMono NFM` Nerd Font for the current user and configures detected Windows Terminal and Warp settings after backing them up. Warp uses terminal-first classic input for a terminal-oriented PowerShell workflow. Existing model and thinking preferences are preserved; repository defaults are used when those values are missing.

## Included setup

- Custom terminal UI with Nerd Font status icons and the `hypr-waves` theme
- Verified Windows Nerd Font setup using CaskaydiaMono Nerd Font Mono 3.4.0
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
- Companion packages:
  - `npm:@hypabolic/pi-hypa`
  - `npm:context-mode`
  - `npm:pi-mcp-adapter`
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

## Repository contents

- `extensions/` — all custom Pi extensions
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

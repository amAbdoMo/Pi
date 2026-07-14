# Changelog

## 0.10.0

- Rebranded the package as Pi Workbench with global, community-facing package metadata and a humanized README that clearly separates stock Pi capabilities from the bundled workbench additions.
- Documented the complete custom interface, workflow, MCP, tool, RTL, terminal, installation, update, privacy, and development experience.
- Renamed new temporary files, backups, and installed font artifacts to the `pi-workbench` namespace while preserving recognition of legacy package and backup names during upgrades.

## 0.9.4

- Changed verified success indicators, including connected MCP server dots, from cyan to green.

## 0.9.3

- Made user message cards fit their rendered content width for short messages while retaining full-width wrapping for long or multiline content.

## 0.9.2

- Restored native mouse text selection and copy by removing application mouse-capture mode; `PageUp` and `PageDown` continue to scroll chat while alternate-screen wheel input no longer cycles composer history.
- Prevented global MCP tool searches from connecting every enabled server; global discovery now uses cached metadata, while server-scoped operations connect only the requested server.

## 0.9.1

- Moved configured MCP servers into a dedicated sidebar section with per-server Connected, Connecting, Disconnected, Disabled, or Error states.
- Removed five-hour and weekly account-usage rows from the sidebar while keeping them in the message composer.
- Fixed clean-runner validation by installing locked dependencies before tests and updated GitHub Actions to Node.js 24-based releases.

## 0.9.0

- Added a full-screen graphite workbench with a fixed responsive sidebar, anchored composer, scrollable chat viewport, coordinated modal layers, and compact OpenCode-inspired message, workflow, side-chat, subagent, and tool surfaces.
- Added mouse-wheel and page-key chat scrolling, responsive sidebar sizing, context token totals, activity summaries, and explicit pending, running, completed-with-evidence, and failed task states.
- Added Arabic shaping and bidirectional terminal rendering while preserving logical submitted text and LTR code, path, command, and metadata runs.
- Replaced the external MCP adapter with the owned MCP Hub: JSON/JSONC and OpenCode-style configuration, local and remote transports, lazy connections, discovery/search/describe/call actions, cancellation, bounded output, metadata caching, diagnostics, secret redaction, and `/mcp` management.
- Retired `npm:pi-mcp-adapter` from shared settings and both installers; repeated setup now removes legacy adapter entries and safely creates an empty personal `mcp.jsonc` only when absent.
- Switched the pinned Windows terminal font to DejaVu Sans Mono Nerd Font 3.4.0 and enabled Arabic cursive and required-ligature features while preserving Windows Terminal and Warp backups.
- Expanded regression coverage for MCP configuration and security, modal coordination, plan progress, sidebar/workbench layout, RTL behavior, mouse input, and terminal configuration.

## 0.8.1

- Removed the bundled `adaptive-delegation` skill from this Pi package so custom skills can live in their own repository.
- Kept the reusable `delegate` model/thinking profile support in the Pi extension.

## 0.8.0

- Added the `adaptive-delegation` skill for automatic task decomposition, task-sized child model/thinking selection, safe concurrency, and parent-owned review.
- Extended `delegate` with optional `model` and `thinking` parameters; omitted values continue to inherit the parent profile.
- Added default routing for small (`gpt-5.4-mini`/low), medium (`gpt-5.5`/medium), and large or high-risk (`gpt-5.6-sol`/high) child tasks.
- Added delegation briefing, routing, review references, initial skill evaluations, and child-profile regression tests.
- Added packaged skill discovery through the Pi package manifest.

## 0.7.0

- Added `/skills`, a scrollable window listing every loaded skill with its description.
- Selecting a skill prefills its `/skill:name` command so optional instructions can be added before submission.
- Removed individual `/skill:*` entries from `/` autocomplete while preserving all other commands and path completion.
- Added regression tests for skill discovery, ordering, and autocomplete filtering.

## 0.6.0

- Added Codex weekly usage beside the five-hour indicator, matching rate-limit windows by duration instead of response position.
- Hid usage windows that OpenAI does not return instead of rendering an unknown percentage.
- Configured detected Warp installations to use `CaskaydiaMono NFM` and terminal-first classic input, with fail-closed TOML updates and a one-time backup.
- Handled Warp's empty bracketed-paste signal for image-only clipboard content on Windows; `Alt+V` remains a fallback.
- Added behavioral coverage for usage-window parsing, Warp settings preservation, ambiguous TOML failure, and Warp image-paste detection.

## 0.5.2

- Replaced the literal `mode` header label with a Nerd Font cog icon (`󰒓`) while retaining the colored `PLAN` or `BUILD` text.
- Added validation to prevent the mode icon from disappearing in future UI changes.

## 0.5.1

- Fixed `Tab` opening path autocomplete instead of switching modes by routing toggle requests through Pi's shared extension event bus.
- Added a regression test covering the full UI-to-plan-mode toggle event flow.

## 0.5.0

- Highlighted compact text-paste, image-paste, and native paste placeholders with the theme's code color.
- Made `Tab` switch directly between plan and build modes while preserving `Shift+Tab` for thinking-level changes.
- Added an always-visible `mode PLAN` or `mode BUILD` indicator to the custom terminal header.
- Added regression tests for paste-placeholder styling and plan/build mode state changes.

## 0.4.2

- Added verified per-user installation of CaskaydiaMono Nerd Font Mono 3.4.0 on Windows.
- Configured Windows Terminal, Windows Terminal Preview, and unpackaged Windows Terminal JSON/JSONC settings to use `CaskaydiaMono NFM`, with one-time settings backups.
- Added version-marker and four-style registry validation so older or incomplete font installations are repaired.
- Extended both one-command installers to configure the Nerd Font on Windows and explain the requirement on other platforms.

## 0.4.1

- Restored the h4ni0 Nerd Font icons for folder, Git branch, model, context usage, and session name in the custom header.
- Added validation that prevents these status icons from disappearing again.

## 0.4.0

- Restored the custom terminal header and brighter `hypr-waves` theme from the original working copy.
- Restored compact Windows clipboard image and multiline-text paste markers.
- Preserved the newer plan/build extension and companion package setup.
- Added idempotent shared configuration application with support for `PI_CODING_AGENT_DIR`.
- Added safe settings/keybinding capture through `npm run capture`.
- Added repository validation and GitHub Actions checks.
- Made the installer reconcile duplicate local checkout entries before updating packages.

## 0.3.1

- Removed duplicate local Pi package entries during installation.

## 0.3.0

- Added plan/build mode.

## 0.2.0

- Added companion packages and synchronized shared settings/keybindings.

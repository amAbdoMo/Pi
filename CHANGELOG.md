# Changelog

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

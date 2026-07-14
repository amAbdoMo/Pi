#!/usr/bin/env bash
set -euo pipefail

PI_PACKAGES=(
  "git:github.com/amAbdoMo/Pi"
  "npm:@hypabolic/pi-hypa"
  "npm:context-mode"
)
CONFIG_SCRIPT_URL="https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/apply-config.mjs"
FONT_SETUP_SCRIPT_URL="https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/setup-terminal-font.ps1"
TERMINAL_SETTINGS_SCRIPT_URL="https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/set-terminal-font.mjs"
WARP_SETTINGS_SCRIPT_URL="https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/set-warp-settings.mjs"
CONFIG_SCRIPT_FILE="$(mktemp "${TMPDIR:-/tmp}/pi-workbench-config.XXXXXX")"
FONT_SETUP_SCRIPT_FILE=""
TERMINAL_SETTINGS_SCRIPT_FILE=""
WARP_SETTINGS_SCRIPT_FILE=""

cleanup() {
  rm -f "$CONFIG_SCRIPT_FILE"
  if [[ -n "$FONT_SETUP_SCRIPT_FILE" ]]; then rm -f "$FONT_SETUP_SCRIPT_FILE"; fi
  if [[ -n "$TERMINAL_SETTINGS_SCRIPT_FILE" ]]; then rm -f "$TERMINAL_SETTINGS_SCRIPT_FILE"; fi
  if [[ -n "$WARP_SETTINGS_SCRIPT_FILE" ]]; then rm -f "$WARP_SETTINGS_SCRIPT_FILE"; fi
}
trap cleanup EXIT

curl -fsSL "$CONFIG_SCRIPT_URL" -o "$CONFIG_SCRIPT_FILE"
node --input-type=module < "$CONFIG_SCRIPT_FILE"

for package in "${PI_PACKAGES[@]}"; do
  pi install "$package"
done
pi update --extensions
node --input-type=module < "$CONFIG_SCRIPT_FILE"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    FONT_SETUP_SCRIPT_BASE="$(mktemp "${TMPDIR:-/tmp}/pi-workbench-font.XXXXXX")"
    FONT_SETUP_SCRIPT_FILE="$FONT_SETUP_SCRIPT_BASE.ps1"
    mv "$FONT_SETUP_SCRIPT_BASE" "$FONT_SETUP_SCRIPT_FILE"
    TERMINAL_SETTINGS_SCRIPT_BASE="$(mktemp "${TMPDIR:-/tmp}/pi-workbench-terminal.XXXXXX")"
    TERMINAL_SETTINGS_SCRIPT_FILE="$TERMINAL_SETTINGS_SCRIPT_BASE.mjs"
    mv "$TERMINAL_SETTINGS_SCRIPT_BASE" "$TERMINAL_SETTINGS_SCRIPT_FILE"
    WARP_SETTINGS_SCRIPT_BASE="$(mktemp "${TMPDIR:-/tmp}/pi-workbench-warp.XXXXXX")"
    WARP_SETTINGS_SCRIPT_FILE="$WARP_SETTINGS_SCRIPT_BASE.mjs"
    mv "$WARP_SETTINGS_SCRIPT_BASE" "$WARP_SETTINGS_SCRIPT_FILE"
    curl -fsSL "$FONT_SETUP_SCRIPT_URL" -o "$FONT_SETUP_SCRIPT_FILE"
    curl -fsSL "$TERMINAL_SETTINGS_SCRIPT_URL" -o "$TERMINAL_SETTINGS_SCRIPT_FILE"
    curl -fsSL "$WARP_SETTINGS_SCRIPT_URL" -o "$WARP_SETTINGS_SCRIPT_FILE"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$FONT_SETUP_SCRIPT_FILE")" -TerminalSettingsScript "$(cygpath -w "$TERMINAL_SETTINGS_SCRIPT_FILE")" -WarpSettingsScript "$(cygpath -w "$WARP_SETTINGS_SCRIPT_FILE")"
    ;;
  *)
    echo "Nerd Font note: configure DejaVuSansM Nerd Font Mono to render Pi icons and joined Arabic text."
    ;;
esac

echo "Done. Restart Pi with: pi"

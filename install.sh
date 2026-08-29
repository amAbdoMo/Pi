#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT=""
SKIP_FFMPEG=0
SKIP_TERMINAL=0
WORKBENCH_PACKAGE="git:github.com/amAbdoMo/Pi@v0.13.0"
CONTEXT_MODE_PACKAGE="npm:context-mode@1.0.169"
REPOSITORY_RAW_BASE="https://raw.githubusercontent.com/amAbdoMo/Pi/v0.13.0"
TEMPORARY_FILES=()
PLATFORM="$(uname -s)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      [[ $# -ge 2 ]] || { echo "--source-root requires a path" >&2; exit 2; }
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --workbench-package)
      [[ $# -ge 2 ]] || { echo "--workbench-package requires a package source" >&2; exit 2; }
      WORKBENCH_PACKAGE="$2"
      shift 2
      ;;
    --context-mode-package)
      [[ $# -ge 2 ]] || { echo "--context-mode-package requires a package source" >&2; exit 2; }
      CONTEXT_MODE_PACKAGE="$2"
      shift 2
      ;;
    --skip-ffmpeg)
      SKIP_FFMPEG=1
      shift
      ;;
    --skip-terminal)
      SKIP_TERMINAL=1
      shift
      ;;
    -h|--help)
      echo "Usage: install.sh [--source-root PATH] [--workbench-package SPEC] [--context-mode-package SPEC] [--skip-ffmpeg] [--skip-terminal]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$SOURCE_ROOT" ]]; then
  SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd)"
fi

cleanup() {
  if [[ ${#TEMPORARY_FILES[@]} -gt 0 ]]; then
    rm -f "${TEMPORARY_FILES[@]}"
  fi
}
trap cleanup EXIT

resolve_asset() {
  local variable_name="$1"
  local relative_path="$2"
  local resolved
  if [[ -n "$SOURCE_ROOT" ]]; then
    resolved="$SOURCE_ROOT/$relative_path"
    [[ -f "$resolved" ]] || { echo "Missing setup asset: $resolved" >&2; exit 1; }
  else
    local extension="${relative_path##*.}"
    local temporary_base
    temporary_base="$(mktemp "${TMPDIR:-/tmp}/pi-workbench-asset.XXXXXX")"
    resolved="$temporary_base.$extension"
    mv "$temporary_base" "$resolved"
    TEMPORARY_FILES+=("$resolved")
    curl -fsSL "$REPOSITORY_RAW_BASE/$relative_path" -o "$resolved"
  fi
  printf -v "$variable_name" '%s' "$resolved"
}

resolve_asset CONFIG_SCRIPT_FILE "scripts/apply-config.mjs"
resolve_asset RETIREMENT_SCRIPT_FILE "scripts/retire-packages.mjs"
resolve_asset DEPENDENCY_REFRESH_SCRIPT_FILE "scripts/refresh-managed-dependencies.mjs"
resolve_asset FFMPEG_SETUP_SCRIPT_FILE "scripts/setup-ffmpeg.mjs"
resolve_asset SYSTEM_POLICY_FILE "APPEND_SYSTEM.md"

FONT_SETUP_SCRIPT_FILE=""
TERMINAL_SETTINGS_SCRIPT_FILE=""
WARP_SETTINGS_SCRIPT_FILE=""
case "$PLATFORM" in
  MINGW*|MSYS*|CYGWIN*)
    resolve_asset FONT_SETUP_SCRIPT_FILE "scripts/setup-terminal-font.ps1"
    resolve_asset TERMINAL_SETTINGS_SCRIPT_FILE "scripts/set-terminal-font.mjs"
    resolve_asset WARP_SETTINGS_SCRIPT_FILE "scripts/set-warp-settings.mjs"
    ;;
esac

export PI_WORKBENCH_PACKAGE_SPEC="$WORKBENCH_PACKAGE"
node "$RETIREMENT_SCRIPT_FILE"
node "$CONFIG_SCRIPT_FILE" --system-policy "$SYSTEM_POLICY_FILE"
for package in "$WORKBENCH_PACKAGE" "$CONTEXT_MODE_PACKAGE"; do
  pi install "$package"
done
node "$CONFIG_SCRIPT_FILE" --system-policy "$SYSTEM_POLICY_FILE"
node "$DEPENDENCY_REFRESH_SCRIPT_FILE"

if [[ $SKIP_FFMPEG -eq 0 ]]; then
  if ! node "$FFMPEG_SETUP_SCRIPT_FILE"; then
    echo "Warning: FFmpeg setup was not completed; video inspection remains unavailable until FFmpeg is installed." >&2
  fi
fi

case "$PLATFORM" in
  MINGW*|MSYS*|CYGWIN*)
    if [[ $SKIP_TERMINAL -eq 0 ]]; then
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$FONT_SETUP_SCRIPT_FILE")" -TerminalSettingsScript "$(cygpath -w "$TERMINAL_SETTINGS_SCRIPT_FILE")" -WarpSettingsScript "$(cygpath -w "$WARP_SETTINGS_SCRIPT_FILE")"
    fi
    ;;
  *)
    if [[ $SKIP_TERMINAL -eq 0 ]]; then
      echo "Nerd Font note: configure DejaVuSansM Nerd Font Mono to render Pi icons and joined Arabic text."
    fi
    ;;
esac

echo "Done. Restart Pi with: pi"

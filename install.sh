#!/usr/bin/env bash
set -euo pipefail

PI_PACKAGES=(
  "git:github.com/amAbdoMo/Pi"
  "npm:@hypabolic/pi-hypa"
  "npm:context-mode"
  "npm:pi-mcp-adapter"
)
CONFIG_SCRIPT_URL="https://raw.githubusercontent.com/amAbdoMo/Pi/main/scripts/apply-config.mjs"
CONFIG_SCRIPT_FILE="$(mktemp "${TMPDIR:-/tmp}/amabdomo-pi-config.XXXXXX")"
trap 'rm -f "$CONFIG_SCRIPT_FILE"' EXIT

curl -fsSL "$CONFIG_SCRIPT_URL" -o "$CONFIG_SCRIPT_FILE"
node --input-type=module < "$CONFIG_SCRIPT_FILE"

for package in "${PI_PACKAGES[@]}"; do
  pi install "$package"
done
pi update --extensions

node --input-type=module < "$CONFIG_SCRIPT_FILE"
echo "Done. Restart Pi with: pi"

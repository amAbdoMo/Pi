# amAbdoMo Pi setup

Personal Pi coding-agent package containing the current custom extensions, companion tools, keybindings, and the `hypr-waves` theme.

## One-line install

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.ps1 | iex
```

### macOS / Linux / Git Bash

```bash
curl -fsSL https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.sh | bash
```

The installer adds this package plus the companion packages currently used in this setup:

- `npm:@hypabolic/pi-hypa`
- `npm:context-mode`
- `npm:pi-mcp-adapter`

## Manual install

```bash
pi install git:github.com/amAbdoMo/Pi
pi install npm:@hypabolic/pi-hypa
pi install npm:context-mode
pi install npm:pi-mcp-adapter
```

Then select `hypr-waves` in `/settings`, or copy values from `settings.example.json` into `~/.pi/agent/settings.json`.

## Contents

- `extensions/` — custom Pi extensions
- `themes/hypr-waves.json` — active theme
- `package.json` — Pi package manifest
- `settings.example.json` — current recommended settings, including companion packages
- `install.sh` / `install.ps1` — one-line setup scripts
- `keybindings.json` — clipboard/current TUI bindings: `Ctrl+C` copies selected text, `app.clear` is disabled, and the built-in image-paste binding is left empty so it does not steal normal paste behavior

After adding new custom features, commit and push them here, then run `pi update --extensions` on other devices.

## Shoutout

Shoutout to [h4ni0](https://github.com/h4ni0) for the original Pi custom setup and extensions this package was based on.

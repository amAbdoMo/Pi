# amAbdoMo Pi setup

Personal Pi coding-agent package containing the current custom extensions and the `hypr-waves` theme.

## One-line install

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.ps1 | iex
```

### macOS / Linux / Git Bash

```bash
curl -fsSL https://raw.githubusercontent.com/amAbdoMo/Pi/main/install.sh | bash
```

## Manual install

```bash
pi install git:github.com/amAbdoMo/Pi
```

Then select `hypr-waves` in `/settings`, or copy values from `settings.example.json` into `~/.pi/agent/settings.json`.

## Contents

- `extensions/` — custom Pi extensions
- `themes/hypr-waves.json` — active theme
- `package.json` — Pi package manifest
- `install.sh` / `install.ps1` — one-line setup scripts
- `keybindings.json` — clipboard shortcuts: `Ctrl+C` copies selected text; `Ctrl+V`/`Alt+V` paste clipboard images into the typing area

After adding new custom features, commit and push them here, then run `pi update --extensions` on other devices.

## Shoutout

Shoutout to [h4ni0](https://github.com/h4ni0) for the original Pi custom setup and extensions this package was based on.

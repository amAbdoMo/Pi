# h4ni0 upstream audit

This setup originated from [h4ni0/pi](https://github.com/h4ni0/pi).

## Last verified upstream

- Branch: `master`
- Commit: `66477e4`
- Verified: 2026-07-13

At that commit, h4ni0/pi has 88 tracked files. This repository contains every functional upstream extension and the upstream theme resource:

- 86 files are common to both repositories
- 81 common files are byte-identical
- 5 common files intentionally differ
- 2 upstream-only files are replaced by this repository's packaging approach

## Intentional common-file differences

- `.gitignore` — adds package/build/runtime exclusions used by this portable repository.
- `extensions/ui/header.ts` — retains the upstream Nerd Font status icons while using the current header spacing, labels, and colors.
- `extensions/ui/index.ts` — integrates compact image and multiline-text paste transformation.
- `extensions/ui/terminalEditor.ts` — integrates the custom Windows clipboard behavior and current terminal editor layout.
- `themes/hypr-waves.json` — uses the current black-background variant instead of the upstream blue surfaces.

## Upstream-only files

- `settings.json` — replaced by `settings.example.json` plus `scripts/apply-config.mjs`, preventing runtime-only fields such as `lastChangelogVersion` from being committed.
- `npm/.gitignore` — not needed because this repository does not keep an upstream runtime `npm/` directory; package dependencies are handled through `package.json`, `package-lock.json`, and Pi's managed package directory.

## Current additions beyond upstream

This repository also includes plan/build mode, compact clipboard handling, an expanded `pi-tool-display`, portable installers, configuration capture/merge scripts, tests, CI validation, changelog, and maintenance documentation.

## Header icons retained from upstream

- Folder: `󰉋`
- Git branch: ``
- Model: `󰧑`
- Context: `󰍛`
- Session: ``

These glyphs require a Nerd Font in the terminal.

## Future audit procedure

Fetch h4ni0/pi into a separate checkout; never merge or copy the repository wholesale over this setup. Compare tracked files, review each upstream change, and port useful changes selectively so current additions are not reverted.

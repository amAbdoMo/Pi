# Plan / Build Mode Extension

Read-only planning mode plus an explicit return-to-build command for safe code analysis before changes.

## Features

- `/plan` or `Ctrl+Alt+P` toggles plan mode
- `--plan` starts Pi in plan mode
- `/build` exits plan mode and restores full tool access
- Built-in write tools are disabled while planning
- Bash is restricted to allowlisted read-only commands while planning
- Numbered `Plan:` sections are extracted into tracked steps
- `plan_progress` records running, completed-with-evidence, and failed states
- Switching from plan to build mode starts tracking an unfinished plan
- Progress widget shows completion status during execution
- Session state persists across resume

## Commands

- `/plan` — toggle plan mode
- `/build` — switch back to build mode / full tool access
- `/todos` — show current plan progress
- `Ctrl+Alt+P` — toggle plan mode

## Usage

1. Enable plan mode with `/plan`, `Ctrl+Alt+P`, or the `--plan` flag.
2. Ask Pi to inspect the repo and create a plan.
3. Pi should output a numbered plan under a `Plan:` header:

```md
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose **Execute the plan** when prompted, or switch to build mode with `Tab` or `/build`.
5. During execution, Pi uses `plan_progress` to mark work running, completed with evidence, or failed.
6. If an unfinished list was paused in build mode, the next valid `plan_progress` update resumes tracking automatically.

## How it works

### Plan mode

- `edit` and `write` are removed from the active built-in tools.
- Read/search tools remain available.
- Bash commands are blocked unless they match the read-only allowlist.
- Pi receives a hidden reminder to plan only and not change files.

### Build / execution mode

- Previous active tools are restored.
- An unfinished plan enters tracked execution when plan mode switches to build mode.
- Pi receives the remaining plan steps.
- `plan_progress` updates refresh the task card, footer status, and Workbench sidebar immediately.

## Bash allowlist

Examples of allowed read-only commands:

- File inspection: `cat`, `head`, `tail`, `less`, `more`, `sed -n`, `awk`
- Search: `grep`, `rg`, `find`, `fd`
- Directory/system inspection: `ls`, `pwd`, `tree`, `du`, `df`, `whoami`, `date`, `uptime`
- Git reads: `git status`, `git log`, `git diff`, `git show`, `git branch`, `git remote`
- Package info: `npm list`, `npm outdated`, `npm view`, `yarn info`

Examples of blocked commands:

- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`, redirects, `tee`
- Git writes: `git add`, `git commit`, `git push`, `git pull`, `git merge`, `git rebase`
- Package installs/updates: `npm install`, `npm update`, `yarn add`, `pip install`
- System/process changes: `sudo`, `kill`, `reboot`, `systemctl restart`
- Editors: `vim`, `nano`, `code`

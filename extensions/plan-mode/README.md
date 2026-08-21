# Plan Progress Extension

Tracks numbered plan steps extracted from `Plan:` sections, with explicit progress updates during execution.

## Features

- Numbered `Plan:` sections are extracted into tracked steps
- `plan_progress` records running, completed-with-evidence, and failed states
- Progress widget and sidebar Tasks section show completion status during execution
- `/todos` shows the current tracked steps at any time
- Session state persists across resume

## Commands

- `/todos` — show current plan progress

## Usage

1. Ask Pi to create a detailed numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
...
```

2. Choose "Execute the plan (track progress)" when prompted.
3. Pi uses `plan_progress` to mark each step running before work starts, completed with concise evidence after verification, or failed if the attempt cannot be completed.

# Writing delegation briefs

A child receives one task plus either a compact parent handoff or fresh context. Write the brief as if it were the only reliable task specification.

## Brief template

```text
Goal:
<one observable outcome>

Scope and ownership:
- May read: <paths or systems>
- May edit: <exclusive paths, or "none; read-only">
- Must not change: <boundaries>

Context:
<facts from the user and repository that affect correctness>

Requirements:
- <behavior or deliverable>
- <edge cases and compatibility constraints>

Validation:
- Run: <commands>
- Return: <files, diff summary, file:line evidence, test output, or recommendation>

Escalate when:
<decisions the parent or user must make>
```

## Brief quality checks

Before dispatch, confirm that the brief:

- Names one outcome rather than a vague role such as “help with the backend.”
- Includes constraints from the user that are not discoverable in the repository.
- States whether edits are allowed and gives exclusive ownership for concurrent writers.
- Requests evidence appropriate to the task.
- Lists the validation the child can perform without inventing credentials or destructive actions.
- Tells the child to use `ask_parent` for material ambiguity, risk, or scope changes.

## Context mode

Use `compact` when the child needs current goals, decisions, or repository history. The compact handoff is not the full transcript, so repeat critical constraints in the brief.

Use `fresh` for unrelated research or isolated work where parent context could bias the answer. A fresh child still reads the working tree and project instructions.

## Avoid weak briefs

Do not send:

- “Investigate this” without a question or expected evidence.
- “Fix everything” without scope.
- A broad task shared by several write-capable children.
- Hidden success criteria that the parent plans to apply only after completion.
- Instructions to commit, push, deploy, or make user-level decisions unless the user explicitly delegated that authority and the environment is isolated.

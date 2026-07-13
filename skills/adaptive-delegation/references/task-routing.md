# Task routing

Choose a child profile from the work assigned to that child, not from the size of the parent project.

## Routing matrix

| Tier | Typical work | Model | Thinking |
|---|---|---|---|
| Direct | One command, one obvious edit, short answer, tightly coupled micro-fix | No child | Parent handles it |
| Small | File discovery, focused source lookup, bounded test run, simple documentation edit, mechanical one-file change | `openai-codex/gpt-5.4-mini` | `low` |
| Medium | Multi-file implementation with established patterns, bug diagnosis, focused refactor, test design, comparative research | `openai-codex/gpt-5.5` | `medium` |
| Large | Architecture, ambiguous cross-system behavior, security/privacy review, migration planning, integration of several workstreams | `openai-codex/gpt-5.6-sol` | `high` |
| Exceptional | Novel reasoning where failed judgment is expensive and evidence cannot cheaply resolve uncertainty | Best available capable model | `xhigh` or `max` |

## Signals that increase the tier

- Ambiguous requirements or several plausible designs.
- Security, privacy, data loss, money, authentication, or deployment risk.
- Cross-cutting changes with hidden contracts.
- Weak tests or unfamiliar technology.
- A need to reconcile conflicting evidence rather than collect facts.

## Signals that reduce the tier

- A deterministic procedure with exact commands.
- A narrow read-only lookup.
- Strong local examples and regression tests.
- Mechanical edits with no design judgment.
- Easy parent verification.

## Concurrency rules

Parallelize by default only when tasks are read-only or have disjoint outputs.

Safe examples:

- One child maps the API while another maps tests.
- Separate children research unrelated libraries.
- File ownership is explicitly split between independent packages.

Serialize when:

- Children would edit the same file or generated artifact.
- One result changes the assumptions of another task.
- Database schemas, lockfiles, package manifests, migrations, or shared config are involved.
- Review needs a clean diff per task.

If uncertain, run sequentially. Coordination failures cost more than the saved latency.

## Availability fallback

If a selected model is unavailable, choose the nearest available model with comparable capability or omit `model` to inherit the parent. Do not silently raise thinking to compensate for a clearly underpowered model; choose a capable model first, then the lowest sufficient thinking level.

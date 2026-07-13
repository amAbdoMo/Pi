---
name: adaptive-delegation
description: Automatically orchestrate Codex sub-agents with task-sized models and thinking levels, then review and integrate their results. Use proactively whenever a request is large, multi-step, multi-file, project-scale, research-heavy, naturally separable into independent workstreams, or would materially benefit from specialist review—even when the user does not explicitly ask for delegation. Also use when the user asks for sub-agents, parallel work, delegation, or faster execution. Do not delegate a single tiny or tightly coupled step that the parent can complete more efficiently itself.
---

# Adaptive Delegation

Act as the orchestrator. Keep user intent, decomposition, risky decisions, integration, and final verification with the parent; give bounded execution or investigation to focused sub-agents.

## Decide before delegating

Delegate only when the coordination cost buys meaningful speed, focus, independent verification, or context isolation.

Do the work directly when it is one obvious command, one small edit, a short factual answer, or a tightly coupled change that would take longer to explain than execute.

Use delegation when at least one applies:

- The task contains two or more independent workstreams.
- A broad codebase inspection can run separately from implementation.
- A bounded migration, refactor, test addition, or documentation update has clear ownership.
- An independent review would reduce correctness, security, or regression risk.
- A long project can be split into milestones with separately verifiable outputs.

Read [references/task-routing.md](references/task-routing.md) when selecting child profiles or deciding whether workstreams are safe to run concurrently.

## Orchestration workflow

1. Understand the request and ask the user about unresolved product, safety, destructive, or architectural choices before spawning work.
2. Split the task by deliverable, subsystem, or question—not by arbitrary file counts. Give each child one outcome and explicit ownership.
3. Choose the smallest capable model and lowest sufficient thinking level for each child using the routing reference.
4. Write a self-contained brief. Include scope, relevant context, constraints, expected evidence, validation, and what must remain untouched. Read [references/writing-briefs.md](references/writing-briefs.md) for the template.
5. Use `context: "compact"` for work related to the current conversation. Use `context: "fresh"` only when the task is genuinely independent and the parent summary would add noise.
6. Run read-only or file-disjoint tasks concurrently. Run overlapping write tasks sequentially unless separate worktrees or strict ownership make clobbering impossible.
7. Review every child result against the repository and user request. Never accept a self-reported success without checking evidence. Read [references/review-results.md](references/review-results.md).
8. Resolve conflicts, make integration edits, run the final gates, and present one coherent result. The parent owns commits and final claims.

## Default model routing

Use these profiles unless the environment lacks a model, the task has unusual risk, or the user specifies another preference:

- Small bounded work: `openai-codex/gpt-5.4-mini` with `low` thinking.
- Medium implementation or analysis: `openai-codex/gpt-5.5` with `medium` thinking.
- Large, ambiguous, architectural, security-sensitive, or integration-heavy work: `openai-codex/gpt-5.6-sol` with `high` thinking.
- Use `xhigh` or `max` only when deep reasoning is the actual bottleneck; task length alone does not justify it.

Omit `model` or `thinking` to inherit the parent when the requested profile is unavailable or when maintaining identical reasoning behavior matters more than cost.

## Dispatch pattern

Call `delegate` with a short title, one bounded task, the chosen profile, and the appropriate context mode:

```text
delegate({
  title: "Audit auth boundaries",
  task: "Read-only audit of ... Return findings with file:line evidence. Do not edit files.",
  context: "compact",
  model: "openai-codex/gpt-5.4-mini",
  thinking: "low"
})
```

For concurrent work, issue multiple delegate calls only when their writes cannot overlap. Tell every child whether it may edit, which paths it owns, and which commands it may run.

## Review discipline

The child output is evidence, not authority. The parent should:

- Inspect changed files or cited source lines.
- Compare the result with the brief and original user request.
- Re-run relevant tests, type checks, linters, or syntax checks.
- Check for scope creep, missed edge cases, unsafe assumptions, and conflicting sibling changes.
- Apply the appropriate production-code, test, documentation, WordPress, or WooCommerce review skill when available.
- Reject, repair, or re-delegate incomplete work rather than summarizing it as successful.

## Recursive delegation

A child may delegate only when its own task still contains a materially independent subproblem and depth permits it. It should otherwise finish its bounded assignment directly. Never build delegation chains merely to route to another model.

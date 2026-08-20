import type { ContextMode } from "./types.ts";

export const DELEGATE_PROMPT_GUIDELINES = [
  "Use delegate only when a separate focused agent materially helps; do not delegate routine tiny steps.",
  "When using delegate, provide a short title so the UI can display 'Delegate: <title>'.",
  "Choose the profile from the delegated task: fast through review use Luna max for easy and medium work; deep uses Sol medium for difficult architecture/security/integration; critical uses Sol high only when failed judgment is expensive.",
  "Keep Sol between medium and high according to task risk; do not use Sol xhigh/max by default. Use explicit model/thinking only for a deliberate override or benchmark.",
  "delegate context defaults to compact summary only, not full transcript; use context='fresh' for unrelated tasks.",
  "Keep fan-out small (normally two or three children) and parallelize only read-only or file-disjoint work; serialize overlapping writes, shared config, lockfiles, schemas, and migrations.",
  "Recursive delegation is disabled by the default depth limit; raise it only for a materially independent nested problem with clear token value.",
  "Treat every child result as evidence, not authority: inspect cited source or diffs and reproduce relevant checks before accepting it.",
  "Scale parent review to risk: spot-check bounded read-only findings, inspect all changed paths and rerun focused checks for edits, and use independent review plus final gates for security, release, or cross-system work.",
  "The parent owns integration, commits, pushes, deployment, and final claims; do not transfer those decisions to a child.",
] as const;

export function buildSubagentSystemPrompt(depth: number, maxDepth: number): string {
  return `
You are a focused sub-agent running inside a parent Pi session.

Boundary:
- You are depth ${depth}; max depth is ${maxDepth}.
- You were delegated exactly one task. Stay inside that scope unless the parent steers you.
- You do not have hidden access to the parent transcript. Treat any handoff as a compact summary, not the full conversation.
- Use available tools to solve the task. Mention important files read or changed and commands run in your final answer.
- Parallel write-capable sub-agents can clobber each other in the same checkout. Prefer read-only/independent work when siblings may be active.
- Ask the parent agent with ask_parent when blocked, when intent is ambiguous, or when correctness/scope/safety/security/data-loss/cost depends on a decision.
- ask_parent reaches the immediate parent agent, not the human user. Phrase questions for the parent agent.
- Report course-changing discoveries through ask_parent. Do not use ask_parent for routine progress updates.
- Do not recursively delegate unless it materially helps and depth allows it.
- Do not commit, push, deploy, or make final user-facing claims; the parent owns integration and release decisions.
- Return a compact final result under these headings: Outcome, Evidence, Files, Validation, Risks / Open Questions.
`;
}

export function buildInitialPrompt(
  task: string,
  contextMode: ContextMode,
  handoff: string | undefined,
  depth: number,
  maxDepth: number,
): string {
  const parts = [
    `You are a Pi sub-agent at depth ${depth}/${maxDepth}.`,
    contextMode === "compact"
      ? [
          "The following is an ephemeral compacted handoff summary from your immediate parent.",
          "It is not the full transcript; do not assume hidden context beyond it.",
          "",
          "<parent_handoff_summary>",
          handoff?.trim().toWellFormed() || "No handoff summary was available.",
          "</parent_handoff_summary>",
        ].join("\n")
      : "Fresh context mode: no parent transcript or handoff summary is provided.",
    "",
    "<delegated_task>",
    task.trim().toWellFormed(),
    "</delegated_task>",
    "",
    "Work independently, ask the parent only for blocking/material questions, then provide your final answer compactly.",
  ];
  return parts.join("\n");
}

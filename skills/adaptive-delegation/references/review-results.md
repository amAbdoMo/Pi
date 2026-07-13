# Reviewing delegated results

The parent owns the judgment. Review the repository and evidence, not the child's confidence or final summary.

## Result checklist

1. Restate the promised outcome from the brief.
2. Inspect every changed path or cited source location.
3. Confirm the child stayed inside its ownership boundary.
4. Check the original user constraints, including details omitted by the child summary.
5. Run the narrow gates first, then the repository's required final gates.
6. Review generated production code, tests, and documentation with the appropriate guard skill.
7. Look for interactions with sibling results before integrating them.
8. Report only verified outcomes; identify remaining uncertainty explicitly.

## Common rejection reasons

- The child changed unrelated files or “cleaned up” beyond scope.
- The response claims tests passed but provides no command or the parent cannot reproduce it.
- The implementation follows a plausible pattern that does not match the installed dependency version.
- Tests assert implementation details, duplicate coverage, or miss the production regression.
- Documentation describes intended behavior rather than the code that shipped.
- A child made an architectural, destructive, security, cost, or product decision without escalation.
- Two children edited shared files and the combined result was never revalidated.

## Integration choices

Accept directly only when the evidence, diff, and gates agree.

Repair locally when the issue is narrow and the parent can correct it faster than another delegation cycle.

Re-delegate when the task remains bounded but requires substantial missing work. Give the next child the failed evidence and a tighter brief rather than repeating the original request.

Ask the user when the result exposes a product decision, risk tolerance, destructive action, credential requirement, or scope change.

## Final synthesis

Combine child results into one answer organized around the user's goal. Do not dump separate agent reports. Mention delegation only when it helps explain evidence, tradeoffs, cost, or unresolved disagreement.

export type DelegateLimitIssue =
  | { kind: "disabled"; message: string }
  | { kind: "depth"; message: string }
  | { kind: "concurrency"; message: string };

export function delegateLimitIssue(options: {
  allowChildSubagents: boolean;
  currentDepth: number;
  maxDepth: number;
  activeCount: number;
  maxConcurrent: number;
}): DelegateLimitIssue | undefined {
  if (!options.allowChildSubagents) {
    return {
      kind: "disabled",
      message: "sub-agent delegation is disabled by settings",
    };
  }
  if (options.currentDepth >= options.maxDepth) {
    return {
      kind: "depth",
      message: `maxDepth ${options.maxDepth} reached at depth ${options.currentDepth}`,
    };
  }
  if (options.activeCount >= options.maxConcurrent) {
    return {
      kind: "concurrency",
      message: `maxConcurrent ${options.maxConcurrent} reached with ${options.activeCount} active children`,
    };
  }
  return undefined;
}

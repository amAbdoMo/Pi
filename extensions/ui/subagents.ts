import {
  getWorkflowActivitySnapshot,
  subscribeWorkflowActivity,
} from "../workflow/activity.ts";
import { color } from "./formatting.ts";

const SUBAGENTS_GLOBAL_STATUS_KEY = "__pi_subagents_status_v1";

type SubagentsStatus = {
  running: number;
  total: number;
  waiting: number;
  nested: number;
  inside?: string;
  updatedAt: number;
  listeners: Set<() => void>;
};

export type SubagentsSnapshot = Pick<
  SubagentsStatus,
  "running" | "total" | "waiting" | "nested" | "inside"
> & {
  workflow?: {
    workflowId: string;
    phaseId?: string;
    running: number;
    total: number;
    waiting: number;
    nested: number;
  };
};

function subagentsStatus(): SubagentsStatus {
  const root = globalThis as any;
  root[SUBAGENTS_GLOBAL_STATUS_KEY] ??= {
    running: 0,
    total: 0,
    waiting: 0,
    nested: 0,
    updatedAt: 0,
    listeners: new Set<() => void>(),
  };
  root[SUBAGENTS_GLOBAL_STATUS_KEY].listeners ??= new Set<() => void>();
  return root[SUBAGENTS_GLOBAL_STATUS_KEY] as SubagentsStatus;
}

export function subagentsLabel(): string | undefined {
  const status = getSubagentsSnapshot();
  if (!status.total && !status.inside) return undefined;
  const bits = [`${status.running}/${status.total}`];
  if (status.waiting) bits.push(color("warning", `${status.waiting} waiting`));
  if (status.nested) bits.push(`${status.nested} nested`);
  if (status.inside) bits.push(`inside ${status.inside}`);
  return [
    color("customMessageLabel", "agents"),
    color("muted", bits.join(" · ")),
  ].join(" ");
}

export function getSubagentsSnapshot(): SubagentsSnapshot {
  const { running, total, waiting, nested, inside } = subagentsStatus();
  const workflow = getWorkflowActivitySnapshot();
  const workflowDelegates = workflow?.delegates;
  const workflowSnapshot = workflowDelegates
    ? {
      workflowId: workflow.workflowId,
      phaseId: workflow.phaseId,
      running: workflowDelegates.running,
      total: workflowDelegates.total,
      waiting: workflowDelegates.waiting,
      nested: workflowDelegates.nested,
    }
    : undefined;
  return {
    running: running + (workflowDelegates?.running ?? 0),
    total: total + (workflowDelegates?.total ?? 0),
    waiting: waiting + (workflowDelegates?.waiting ?? 0),
    nested: nested + (workflowDelegates?.nested ?? 0),
    inside,
    workflow: workflowSnapshot,
  };
}

export function hasActiveSubagents(): boolean {
  const status = getSubagentsSnapshot();
  return status.total > 0 || status.nested > 0;
}

export function subscribeSubagents(listener: () => void): () => void {
  const status = subagentsStatus();
  status.listeners.add(listener);
  const unsubscribeWorkflow = subscribeWorkflowActivity(listener);
  return () => {
    status.listeners.delete(listener);
    unsubscribeWorkflow();
  };
}

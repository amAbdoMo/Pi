import type { DelegateDetails, RpcEventSummary } from "../types.ts";
import {
  boundedOptionalText,
  truncateUtf8Prefix,
} from "../summaries/payload-limit.ts";
import { oneLine } from "../utils.ts";

function boundedEvent(event: RpcEventSummary): RpcEventSummary {
  return {
    type: oneLine(event.type, 80),
    timestamp: event.timestamp,
    text: event.text ? oneLine(event.text, 320) : undefined,
    toolName: event.toolName ? oneLine(event.toolName, 100) : undefined,
    toolCallId: event.toolCallId ? oneLine(event.toolCallId, 160) : undefined,
    isError: event.isError,
  };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function fitMinimalDetails(
  details: DelegateDetails,
  maxBytes: number,
): DelegateDetails {
  const fields = ["id", "label", "task", "error"] as const;
  while (serializedBytes(details) > maxBytes) {
    const field = fields
      .filter((name) => details[name])
      .sort(
        (left, right) =>
          Buffer.byteLength(details[right] ?? "", "utf8") -
          Buffer.byteLength(details[left] ?? "", "utf8"),
      )[0];
    if (!field) break;
    const characters = Array.from(details[field] ?? "");
    details[field] = characters.slice(0, Math.floor(characters.length / 2)).join("");
  }
  return details;
}

export function boundDelegateDetails(
  details: DelegateDetails,
  maxBytes: number,
): DelegateDetails {
  const safeLimit = Math.max(1_000, Math.floor(maxBytes));
  const bounded: DelegateDetails = {
    ...details,
    id: oneLine(details.id, 160),
    label: oneLine(details.label, 160),
    task: oneLine(details.task, 1_200),
    model: details.model ? oneLine(details.model, 200) : undefined,
    sessionFile: details.sessionFile
      ? oneLine(details.sessionFile, 1_000)
      : undefined,
    sessionDir: details.sessionDir ? oneLine(details.sessionDir, 1_000) : undefined,
    lastMessageSnippet: details.lastMessageSnippet
      ? oneLine(details.lastMessageSnippet, 320)
      : undefined,
    error: details.error ? oneLine(details.error, 1_000) : undefined,
    finalOutput: boundedOptionalText(
      details.finalOutput,
      Math.max(500, Math.floor(safeLimit / 2)),
    ),
    events: details.events.slice(-40).map(boundedEvent),
  };

  while (bounded.events.length > 0 && serializedBytes(bounded) > safeLimit)
    bounded.events.shift();
  if (serializedBytes(bounded) > safeLimit) bounded.finalOutput = undefined;
  if (serializedBytes(bounded) > safeLimit) bounded.task = oneLine(bounded.task, 200);
  if (serializedBytes(bounded) > safeLimit) {
    bounded.sessionFile = undefined;
    bounded.sessionDir = undefined;
    bounded.lastMessageSnippet = undefined;
  }
  if (serializedBytes(bounded) > safeLimit)
    bounded.error = bounded.error ? oneLine(bounded.error, 120) : undefined;
  if (serializedBytes(bounded) <= safeLimit) return bounded;
  return fitMinimalDetails(
    {
      id: truncateUtf8Prefix(oneLine(bounded.id, 80), 80),
      label: truncateUtf8Prefix(oneLine(bounded.label, 80), 80),
      status: bounded.status,
      contextMode: bounded.contextMode,
      depth: bounded.depth,
      maxDepth: bounded.maxDepth,
      task: truncateUtf8Prefix(oneLine(bounded.task, 80), 80),
      error: bounded.error
        ? truncateUtf8Prefix(oneLine(bounded.error, 80), 80)
        : undefined,
      events: [],
    },
    safeLimit,
  );
}

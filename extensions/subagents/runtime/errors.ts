import { oneLine } from "../utils.ts";

export function boundedChildError(error: unknown): string {
  return oneLine(error instanceof Error ? error.message : String(error), 1_000);
}

import type {
  CompletionPayload,
  DelegateDetails,
} from "../types.ts";

export function parentVisibleCompletionContent(
  completion: CompletionPayload,
): string {
  return (
    completion.payload.trim() ||
    "(child completion payload unavailable; inspect the referenced child output file)"
  );
}

export function buildParentDelegateResult(
  completion: CompletionPayload,
  details: DelegateDetails,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: parentVisibleCompletionContent(completion),
      },
    ],
    details,
  };
}

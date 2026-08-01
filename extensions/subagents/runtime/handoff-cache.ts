export interface HandoffCacheEntry {
  key: string;
  summary: Promise<string>;
}

export function getOrCreateHandoffPromise(
  entry: HandoffCacheEntry | undefined,
  key: string,
  create: () => Promise<string>,
): { entry: HandoffCacheEntry; summary: Promise<string> } {
  if (entry?.key === key) return { entry, summary: entry.summary };
  const summary = create();
  return { entry: { key, summary }, summary };
}

export function waitForHandoffSummary(
  summary: Promise<string>,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!signal) return summary;
  if (signal.aborted) return Promise.reject(new Error("Sub-agent aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Sub-agent aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    summary.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export const SUBAGENT_USAGE_REFRESH_INTERVAL_MS = 30_000;

type IntervalScheduler = {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const systemScheduler: IntervalScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

export type UsageRefreshPoller = {
  setActive(active: boolean): void;
  dispose(): void;
};

export function createUsageRefreshPoller(
  refresh: () => Promise<void>,
  scheduler: IntervalScheduler = systemScheduler,
): UsageRefreshPoller {
  let active = false;
  let interval: unknown;

  const requestRefresh = () => {
    void refresh();
  };

  const stopInterval = () => {
    if (interval === undefined) return;
    scheduler.clearInterval(interval);
    interval = undefined;
  };

  return {
    setActive(nextActive) {
      if (nextActive === active) return;
      active = nextActive;

      if (active) {
        requestRefresh();
        interval = scheduler.setInterval(
          requestRefresh,
          SUBAGENT_USAGE_REFRESH_INTERVAL_MS,
        );
        return;
      }

      stopInterval();
      requestRefresh();
    },
    dispose() {
      active = false;
      stopInterval();
    },
  };
}

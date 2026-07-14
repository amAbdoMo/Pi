const WORKBENCH_MODAL_STATE_KEY = "__amabdomo_pi_modal_state_v1";

type ModalState = {
  activeCount: number;
  listeners: Set<() => void>;
};

function sharedState(): ModalState {
  const root = globalThis as typeof globalThis & {
    [WORKBENCH_MODAL_STATE_KEY]?: ModalState;
  };
  root[WORKBENCH_MODAL_STATE_KEY] ??= {
    activeCount: 0,
    listeners: new Set(),
  };
  return root[WORKBENCH_MODAL_STATE_KEY];
}

function notifyListeners(state: ModalState): void {
  for (const listener of state.listeners) listener();
}

export function isWorkbenchModalActive(): boolean {
  return sharedState().activeCount > 0;
}

export function beginWorkbenchModal(): () => void {
  const state = sharedState();
  state.activeCount++;
  notifyListeners(state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.activeCount = Math.max(0, state.activeCount - 1);
    notifyListeners(state);
  };
}

export async function withWorkbenchModal<T>(operation: () => Promise<T>): Promise<T> {
  const release = beginWorkbenchModal();
  try {
    return await operation();
  } finally {
    release();
  }
}

export function subscribeWorkbenchModals(listener: () => void): () => void {
  const state = sharedState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

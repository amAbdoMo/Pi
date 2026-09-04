export const APPROVAL_MODES = Object.freeze(["read-only", "workspace-write", "full-access"]);
export const DEFAULT_APPROVAL_MODE = "workspace-write";
const STORAGE_KEY = "pi-harness-approval-mode";

export function readApprovalMode(storage) {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return APPROVAL_MODES.includes(stored) ? stored : DEFAULT_APPROVAL_MODE;
  } catch {
    return DEFAULT_APPROVAL_MODE;
  }
}

export function writeApprovalMode(storage, mode) {
  if (!APPROVAL_MODES.includes(mode)) throw new TypeError("Invalid approval mode");
  storage.setItem(STORAGE_KEY, mode);
}

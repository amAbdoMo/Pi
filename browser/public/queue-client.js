export const QUEUE_MODE_STORAGE_KEY = "pi-harness.queue-mode.v1";
export const DEFAULT_QUEUE_MODE = "steer";

const QUEUE_MODES = new Set(["steer", "followUp"]);

export function readQueueMode(storage) {
  try {
    const mode = storage.getItem(QUEUE_MODE_STORAGE_KEY);
    return QUEUE_MODES.has(mode) ? mode : DEFAULT_QUEUE_MODE;
  } catch {
    return DEFAULT_QUEUE_MODE;
  }
}

export function writeQueueMode(storage, mode) {
  if (!QUEUE_MODES.has(mode)) throw new TypeError("Invalid queue mode");
  storage.setItem(QUEUE_MODE_STORAGE_KEY, mode);
}

function stringQueue(value) {
  return Array.isArray(value) ? value.filter((message) => typeof message === "string") : [];
}

export function normalizedQueue(value) {
  return {
    steering: stringQueue(value?.steering),
    followUp: stringQueue(value?.followUp),
  };
}

export function queueMessageCount(value) {
  const queue = normalizedQueue(value);
  return queue.steering.length + queue.followUp.length;
}

export function restoredQueueText(value, currentInput = "") {
  const queue = normalizedQueue(value);
  const restored = [...queue.steering, ...queue.followUp].join("\n\n");
  if (!restored) return currentInput;
  return currentInput ? `${restored}\n\n${currentInput}` : restored;
}

export function takeClearedQueueRecords(records, value) {
  const queue = normalizedQueue(value);
  const remaining = [...records];
  const removed = [];
  for (const kind of ["steering", "followUp"]) {
    for (const message of queue[kind]) {
      let index = remaining.length - 1;
      while (index >= 0 && (remaining[index].kind !== kind || remaining[index].message !== message)) index -= 1;
      if (index >= 0) removed.push(...remaining.splice(index, 1));
    }
  }
  return { remaining, removed };
}

export async function clearQueueBeforeAbort(sendCommand, onCleared) {
  const response = await sendCommand({ type: "clear_queue" });
  const queue = normalizedQueue(response?.data);
  onCleared(queue);
  await sendCommand({ type: "abort" });
  return queue;
}

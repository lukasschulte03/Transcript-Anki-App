/**
 * One Whisper process already uses substantial CPU/GPU memory. Keep work
 * sequential so a second lecture never slows down or destabilises the first.
 * The work itself stays in the feature layer, while this small coordinator is
 * intentionally independent of React so navigation does not interrupt it.
 */
type QueuedTask = { id: string; run: () => Promise<void> };

const pending: QueuedTask[] = [];
let running = false;
let activeId: string | undefined;
const cancelledActive = new Set<string>();

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const task = pending.shift();
      if (task) {
        activeId = task.id;
        try {
          await task.run();
        } finally {
          cancelledActive.delete(task.id);
          activeId = undefined;
        }
      }
    }
  } finally {
    running = false;
  }
}

export function enqueueTranscription(task: QueuedTask) {
  pending.push(task);
  void drain();
  return pending.length;
}

/**
 * Lets every transcription entry point share the same single-worker queue.
 * Super Actions must use this too: a separate sequential queue can still run
 * alongside a foreground transcription and exhaust Whisper's GPU/RAM budget.
 */
export function runExclusiveTranscription<T>(
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({
      id,
      run: async () => {
        try {
          resolve(await run());
        } catch (error) {
          reject(error);
        }
      },
    });
    void drain();
  });
}

export function cancelQueuedTranscription(id: string) {
  const index = pending.findIndex((task) => task.id === id);
  if (index < 0) return false;
  pending.splice(index, 1);
  return true;
}

/** Signals feature-level work to stop before its next API upload/chunk. */
export function cancelActiveTranscription(id: string) {
  if (activeId !== id) return false;
  cancelledActive.add(id);
  return true;
}

export function isActiveTranscriptionCancelled(id: string) {
  return cancelledActive.has(id);
}

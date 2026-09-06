/**
 * One Whisper process already uses substantial CPU/GPU memory. Keep work
 * sequential so a second lecture never slows down or destabilises the first.
 * The work itself stays in the feature layer, while this small coordinator is
 * intentionally independent of React so navigation does not interrupt it.
 */
type QueuedTask = { id: string; run: () => Promise<void> };

const pending: QueuedTask[] = [];
let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const task = pending.shift();
      if (task) await task.run();
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

export function cancelQueuedTranscription(id: string) {
  const index = pending.findIndex((task) => task.id === id);
  if (index < 0) return false;
  pending.splice(index, 1);
  return true;
}

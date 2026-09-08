type QueuedTask = { id: string; run: (signal: AbortSignal) => Promise<void> };

const pending: QueuedTask[] = [];
let active: { id: string; controller: AbortController } | undefined;
let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const task = pending.shift();
      if (!task) continue;
      const controller = new AbortController();
      active = { id: task.id, controller };
      try {
        await task.run(controller.signal);
      } finally {
        active = undefined;
      }
    }
  } finally {
    running = false;
  }
}

/** Vision is deliberately single-worker so it never competes with Whisper for RAM/GPU. */
export function runExclusiveVision(
  id: string,
  run: (signal: AbortSignal) => Promise<void>,
) {
  pending.push({ id, run });
  void drain();
  return pending.length;
}

export function cancelQueuedVision(id: string) {
  const index = pending.findIndex((task) => task.id === id);
  if (index < 0) return false;
  pending.splice(index, 1);
  return true;
}

export function cancelActiveVision(id: string) {
  if (active?.id !== id) return false;
  active.controller.abort();
  return true;
}

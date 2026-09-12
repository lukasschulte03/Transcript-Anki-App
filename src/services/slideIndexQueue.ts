type QueuedSlideIndex = {
  id: string;
  run: () => Promise<void>;
};

const pending: QueuedSlideIndex[] = [];
let active: string | undefined;
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (pending.length) {
      const task = pending.shift();
      if (!task) continue;
      active = task.id;
      try {
        await task.run();
      } catch {
        // Callers normally turn a failure into an error job themselves. Never
        // let an unexpected rejection strand everything waiting behind it.
      } finally {
        active = undefined;
      }
    }
  } finally {
    draining = false;
  }
}

/** PDF rendering and layout analysis share a single worker to protect WebView2 RAM. */
export function queueSlideIndex(id: string, run: () => Promise<void>) {
  // Avoid duplicate scheduling when React replays an effect in development or
  // a user opens the same module twice while its old slides are being repaired.
  if (active === id || pending.some((task) => task.id === id)) {
    return pending.findIndex((task) => task.id === id) + 1;
  }
  pending.push({ id, run });
  const position = pending.length + (active ? 1 : 0);
  void drain();
  return position;
}

export const isSlideIndexActive = (id: string) => active === id;

/** Only work which has not started can be safely cancelled. */
export function cancelQueuedSlideIndex(id: string) {
  const index = pending.findIndex((task) => task.id === id);
  if (index < 0) return false;
  pending.splice(index, 1);
  return true;
}

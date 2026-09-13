import type { DataProfile } from "../runtimeProfile";

export type ProfileLock = { release(): void };

/**
 * Prevents two WebView/browser processes from mutating one data profile at
 * the same time. Next and legacy use different profiles by default, while an
 * explicit shared-profile comparison is still protected by this lock.
 */
export async function acquireDataProfileLock(
  profile: DataProfile,
): Promise<ProfileLock> {
  if (!("locks" in navigator)) return { release: () => undefined };

  let releaseHold: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let reportAcquired: (acquired: boolean) => void = () => undefined;
  const acquired = new Promise<boolean>((resolve) => {
    reportAcquired = resolve;
  });

  void navigator.locks.request(
    `lectio:data-profile:${profile}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      reportAcquired(Boolean(lock));
      if (lock) await hold;
    },
  );

  if (!(await acquired))
    throw new Error(
      "Den här Lectio-profilen är redan öppen. Stäng det andra fönstret och försök igen.",
    );
  return { release: releaseHold };
}

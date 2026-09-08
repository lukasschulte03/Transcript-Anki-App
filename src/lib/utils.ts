import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Kept compatible with shadcn's component API while retaining Lectio helpers.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const uid = () => crypto.randomUUID();
export const formatTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};
export const downloadText = (
  name: string,
  text: string,
  type = "application/json",
) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
export const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export async function confirmStorageForImport(file: Blob, label: string) {
  if (await hasStorageCapacity(file.size)) return true;
  return confirm(
    `Det verkar finnas mindre ledigt utrymme än ${label} behöver. Importen kan misslyckas. Vill du fortsätta?`,
  );
}

/** A conservative IndexedDB quota check for imports and sync downloads. */
export async function hasStorageCapacity(bytes: number, reserve = 1.2) {
  const estimate = await navigator.storage?.estimate?.();
  const available = (estimate?.quota ?? 0) - (estimate?.usage ?? 0);
  return !estimate?.quota || available >= Math.max(0, bytes) * reserve;
}

import { Bug, Minus, Square, X } from "lucide-react";
import type { Window } from "@tauri-apps/api/window";
import { isTauri } from "../services/platform";
import { toast } from "../services/feedbackToast";

async function withCurrentWindow(
  action: (window: Window) => Promise<void>,
  actionName: string,
) {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await action(getCurrentWindow());
  } catch (error) {
    // Never fail silently: this is the only route to close a frameless window.
    toast.error(`${actionName} kunde inte genomföras: ${String(error)}`);
  }
}

export function WindowTitleBar({ onReportProblem }: { onReportProblem: () => void }) {
  return (
    <header
      className="flex h-9 shrink-0 items-center border-b border-[var(--palette-border)] bg-[var(--palette-surface)] select-none"
    >
      <div
        className="flex min-w-0 flex-1 items-center px-3"
        data-tauri-drag-region
      >
        <span className="truncate text-[13px] font-bold tracking-tight text-[var(--palette-text)]">
          Lectio
        </span>
      </div>
      <div className="flex h-full shrink-0">
        <button
          type="button"
          className="grid h-full w-11 place-items-center text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:bg-[var(--palette-surface-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--palette-focus-ring)]"
          onClick={onReportProblem}
          aria-label="Rapportera problem"
          title="Rapportera problem"
        >
          <Bug className="size-3.5 stroke-[2.25]" />
        </button>
        <button
          type="button"
          className="grid h-full w-11 place-items-center text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:bg-[var(--palette-surface-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--palette-focus-ring)]"
          onClick={() =>
            void withCurrentWindow((window) => window.minimize(), "Minimering")
          }
          aria-label="Minimera"
          title="Minimera"
        >
          <Minus className="size-3.5 stroke-[2.25]" />
        </button>
        <button
          type="button"
          className="grid h-full w-11 place-items-center text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:bg-[var(--palette-surface-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--palette-focus-ring)]"
          onClick={() =>
            void withCurrentWindow(async (window) => {
              if (await window.isMaximized()) await window.unmaximize();
              else await window.maximize();
            }, "Ändring av fönsterstorlek")
          }
          aria-label="Maximera eller återställ"
          title="Maximera eller återställ"
        >
          <Square className="size-3.5 stroke-[2.25]" />
        </button>
        <button
          type="button"
          className="grid h-full w-11 place-items-center text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-danger)] hover:text-[var(--palette-danger-foreground)] focus-visible:bg-[var(--palette-danger)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--palette-focus-ring)]"
          onClick={() =>
            void withCurrentWindow((window) => window.close(), "Stängning")
          }
          aria-label="Stäng"
          title="Stäng"
        >
          <X className="size-3.5 stroke-[2.25]" />
        </button>
      </div>
    </header>
  );
}

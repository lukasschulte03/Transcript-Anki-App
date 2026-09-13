import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { lazy, Suspense } from "react";

const CardStudio = lazy(() =>
  import("./CardStudio").then((module) => ({ default: module.CardStudio })),
);

export function AnkiWorkspaceOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--palette-hero-background)_35%,transparent)] backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-3 z-50 flex min-h-0 min-w-0 overflow-hidden rounded-xl border border-[var(--palette-border)] bg-[var(--palette-background)] shadow-2xl outline-none sm:inset-5 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Anki-arbetsyta
          </DialogPrimitive.Title>
          <Suspense
            fallback={
              <div className="grid flex-1 place-items-center text-sm text-[var(--palette-text-muted)]">
                Öppnar Anki-arbetsytan…
              </div>
            }
          >
            <CardStudio overlay />
          </Suspense>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-md text-[var(--palette-text-muted)] transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]"
            aria-label="Stäng Anki-arbetsytan"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

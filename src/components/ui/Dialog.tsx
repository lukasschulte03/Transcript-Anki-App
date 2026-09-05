import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--palette-hero-background)_42%,transparent)] backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[min(540px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] p-6 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-[var(--palette-text)]">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-sm text-[var(--palette-text-muted)]">
              {description}
            </DialogPrimitive.Description>
          )}
          <DialogPrimitive.Close className="absolute right-4 top-4 grid size-8 place-items-center rounded-md text-[var(--palette-text-subtle)] transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]">
            <X className="size-4" />
          </DialogPrimitive.Close>
          <div className="mt-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

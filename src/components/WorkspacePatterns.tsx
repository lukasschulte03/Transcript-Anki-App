import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check, Circle, X } from "lucide-react";
import { cn } from "../lib/utils";

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: "ready" | "pending" | "error" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const Icon = status === "ready" ? Check : status === "error" ? X : Circle;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
        status === "ready" &&
          "bg-[var(--palette-success-muted)] text-[var(--palette-success)]",
        status === "error" &&
          "bg-[var(--palette-danger-muted)] text-[var(--palette-danger)]",
        status === "pending" &&
          "bg-[var(--palette-warning-muted)] text-[var(--palette-warning)]",
        status === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}

export function SourceSummary({
  items,
  compact = false,
  className,
}: {
  items: Array<{
    label: string;
    available: boolean;
    detail?: string;
    icon?: LucideIcon;
  }>;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label="Tillgängligt material"
    >
      {items.map(({ label, available, detail, icon: Icon }) => (
        <span
          key={label}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
            available
              ? "border-border bg-card text-foreground"
              : "border-transparent bg-muted/60 text-muted-foreground",
          )}
          title={detail}
        >
          {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
          {label}
          {!compact && detail ? (
            <span className="text-muted-foreground">{detail}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function ActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DetailPanel({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 z-20 w-full max-w-md border-l border-border bg-card shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onOpenChange(false)}
        >
          Stäng
        </button>
      </div>
      <div className="h-[calc(100%-3.5rem)] overflow-y-auto p-4">{children}</div>
    </div>
  );
}

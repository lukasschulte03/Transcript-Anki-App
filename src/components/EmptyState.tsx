import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-48 place-items-center rounded-xl border border-dashed border-border px-6 py-8 text-center",
        className,
      )}
    >
      <div className="max-w-sm">
        <Icon className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

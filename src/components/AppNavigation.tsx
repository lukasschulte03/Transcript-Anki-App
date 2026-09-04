import { BookOpen, Home, Settings, Sparkles } from "lucide-react";
import { useAppStore } from "../core/store";
import { cn } from "../lib/utils";

const navigation = [
  { id: "dashboard", label: "Översikt", icon: Home },
  { id: "workspace", label: "Bibliotek", icon: BookOpen },
  { id: "cards", label: "Anki-kort", icon: Sparkles },
  { id: "settings", label: "Inställningar", icon: Settings },
] as const;

/** Primary navigation shaped after the shadcn dashboard sidebar. */
export function AppNavigation() {
  const { activeView, setActiveView } = useAppStore();
  return (
    <nav className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--palette-border)] bg-[var(--palette-surface)] p-3">
      <button
        onClick={() => setActiveView("dashboard")}
        className="mb-6 flex h-10 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--palette-surface-hover)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]"
        title="Översikt"
      >
        <span className="grid size-7 place-items-center rounded-md bg-[var(--palette-primary)] text-[var(--palette-primary-text)] shadow-sm">
          <BookOpen className="size-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-[var(--palette-text)]">
          Lectio
        </span>
      </button>

      <div className="space-y-1">
        <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--palette-text-subtle)]">
          Arbetsyta
        </p>
        {navigation.slice(0, 3).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
              activeView === id
                ? "bg-[var(--palette-primary-soft)] text-[var(--palette-accent-text)]"
                : "text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-auto border-t border-[var(--palette-border)] pt-3">
        <button
          onClick={() => setActiveView("settings")}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            activeView === "settings"
              ? "bg-[var(--palette-primary-soft)] text-[var(--palette-accent-text)]"
              : "text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]",
          )}
        >
          <Settings className="size-4" />
          Inställningar
        </button>
        <div className="mt-3 px-2 text-[10px] text-[var(--palette-text-subtle)]">
          Lectio · v0.4.0
        </div>
      </div>
    </nav>
  );
}

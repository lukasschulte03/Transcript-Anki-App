import {
  BookOpen,
  Home,
  Inbox,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useAppStore } from "../core/store";
import { cn } from "../lib/utils";
import { APP_VERSION } from "../lib/appVersion";

const navigation = [
  { id: "dashboard", label: "Översikt", icon: Home, shortcut: "Ctrl+1" },
  { id: "workspace", label: "Bibliotek", icon: BookOpen, shortcut: "Ctrl+2" },
  { id: "cards", label: "Anki-kort", icon: Sparkles, shortcut: "Ctrl+3" },
  { id: "inbox", label: "Inkorg", icon: Inbox, shortcut: "Ctrl+4" },
  { id: "super-actions", label: "Super Actions", icon: Wand2, shortcut: "Ctrl+5" },
] as const;

const shortcutHintClass =
  "ml-auto inline-flex shrink-0 whitespace-nowrap rounded border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] px-1.5 py-0.5 font-sans text-[11px] leading-none font-medium tabular-nums text-[var(--palette-text-subtle)]";

/** Primary navigation shaped after the shadcn dashboard sidebar. */
export function AppNavigation() {
  const { activeView, setActiveView, settings, updateSettings } = useAppStore();
  const collapsed = settings.librarySidebarCollapsed;
  const navClass = (isActive: boolean) =>
    cn(
      "relative flex h-9 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-sm font-medium outline-none transition-[background-color,color] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
      collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
      isActive
        ? "bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]"
        : "text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]",
    );
  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--palette-border)] bg-[var(--palette-surface)] transition-[width,padding] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-14 p-2" : "w-56 p-3",
      )}
    >
      <div className="space-y-1">
        {navigation.map(({ id, label, icon: Icon, shortcut }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={navClass(activeView === id)}
            title={collapsed ? label : undefined}
            aria-label={label}
          >
            <Icon className="size-4 shrink-0" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
                collapsed &&
                  "pointer-events-none absolute left-8 right-2 -translate-x-1 opacity-0",
              )}
            >
              {label}
            </span>
            <kbd
              className={cn(
                shortcutHintClass,
                "transition-opacity duration-150 ease-out motion-reduce:transition-none",
                collapsed && "pointer-events-none absolute right-2 opacity-0",
              )}
            >
              {shortcut}
            </kbd>
          </button>
        ))}
      </div>

      <div className="mt-auto border-t border-[var(--palette-border)] pt-3">
        <button
          onClick={() =>
            updateSettings({ librarySidebarCollapsed: !collapsed })
          }
          className={cn(
            "relative mb-1 flex h-8 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
          )}
          title={`${collapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
          aria-label={`${collapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
              collapsed &&
                "pointer-events-none absolute left-8 right-2 -translate-x-1 opacity-0",
            )}
          >
            Dölj sidofält
          </span>
          <kbd
            className={cn(
              shortcutHintClass,
              "transition-opacity duration-150 ease-out motion-reduce:transition-none",
              collapsed && "pointer-events-none absolute right-2 opacity-0",
            )}
          >
            Ctrl+B
          </kbd>
        </button>
        <button
          onClick={() =>
            window.dispatchEvent(new Event("lectio:show-shortcuts"))
          }
          className={cn(
            "relative mb-1 flex h-8 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
          )}
          title={collapsed ? "Kortkommandon" : undefined}
          aria-label={collapsed ? "Kortkommandon" : undefined}
        >
          <Keyboard className="size-3.5" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
              collapsed &&
                "pointer-events-none absolute left-8 right-2 -translate-x-1 opacity-0",
            )}
          >
            Kortkommandon
          </span>
          <kbd
            className={cn(
              shortcutHintClass,
              "transition-opacity duration-150 ease-out motion-reduce:transition-none",
              collapsed && "pointer-events-none absolute right-2 opacity-0",
            )}
          >
            ?
          </kbd>
        </button>
        <button
          onClick={() => setActiveView("settings")}
          className={navClass(activeView === "settings")}
          title={collapsed ? "Inställningar (Ctrl+,)" : undefined}
          aria-label={collapsed ? "Inställningar (Ctrl+,)" : undefined}
        >
          <Settings className="size-4 shrink-0" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
              collapsed &&
                "pointer-events-none absolute left-8 right-2 -translate-x-1 opacity-0",
            )}
          >
            Inställningar
          </span>
          <kbd
            className={cn(
              shortcutHintClass,
              "transition-opacity duration-150 ease-out motion-reduce:transition-none",
              collapsed && "pointer-events-none absolute right-2 opacity-0",
            )}
          >
            Ctrl+,
          </kbd>
        </button>
        <div
          className={cn(
            "mt-3 overflow-hidden whitespace-nowrap text-xs text-[var(--palette-text-subtle)]",
            collapsed ? "px-0 text-center text-[10px]" : "px-2",
          )}
        >
          {collapsed ? `v${APP_VERSION}` : `Lectio · v${APP_VERSION}`}
        </div>
      </div>
    </nav>
  );
}

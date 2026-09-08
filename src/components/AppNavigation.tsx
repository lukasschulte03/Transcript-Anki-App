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
  { id: "dashboard", label: "Översikt", icon: Home },
  { id: "workspace", label: "Bibliotek", icon: BookOpen },
  { id: "cards", label: "Anki-kort", icon: Sparkles },
  { id: "inbox", label: "Inkorg", icon: Inbox },
  { id: "super-actions", label: "Super Actions", icon: Wand2 },
] as const;

const shortcutHintClass =
  "ml-auto inline-flex min-w-5 items-center justify-center rounded border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] px-1.5 py-0.5 font-sans text-[11px] leading-none font-medium tabular-nums text-[var(--palette-text-subtle)]";

/** Primary navigation shaped after the shadcn dashboard sidebar. */
export function AppNavigation() {
  const { activeView, setActiveView, settings, updateSettings } = useAppStore();
  const collapsed = settings.librarySidebarCollapsed;
  const navClass = (isActive: boolean) =>
    cn(
      "flex h-9 w-full items-center rounded-md text-sm font-medium outline-none transition-[background-color,color,width,padding] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
      collapsed ? "justify-center px-0" : "gap-2 px-2",
      isActive
        ? "bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]"
        : "text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]",
    );
  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-[var(--palette-border)] bg-[var(--palette-surface)] transition-[width,padding] duration-200",
        collapsed ? "w-14 p-2" : "w-56 p-3",
      )}
    >
      <div className="space-y-1">
        {!collapsed && (
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-[var(--palette-text-subtle)]">
            Arbetsyta
          </p>
        )}
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={navClass(activeView === id)}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
          >
            <Icon className="size-4" />
            {collapsed ? <span className="sr-only">{label}</span> : label}
          </button>
        ))}
      </div>

      <div className="mt-auto border-t border-[var(--palette-border)] pt-3">
        <button
          onClick={() =>
            updateSettings({ librarySidebarCollapsed: !collapsed })
          }
          className={cn(
            "mb-1 flex h-8 w-full items-center rounded-md text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            collapsed ? "justify-center px-0" : "gap-2 px-2",
          )}
          title={`${collapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
          aria-label={`${collapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
          {collapsed ? null : (
            <>
              Dölj sidofält
              <kbd className={shortcutHintClass}>
                Ctrl+B
              </kbd>
            </>
          )}
        </button>
        <button
          onClick={() =>
            window.dispatchEvent(new Event("lectio:show-shortcuts"))
          }
          className={cn(
            "mb-1 flex h-8 w-full items-center rounded-md text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            collapsed ? "justify-center px-0" : "gap-2 px-2",
          )}
          title={collapsed ? "Kortkommandon" : undefined}
          aria-label={collapsed ? "Kortkommandon" : undefined}
        >
          <Keyboard className="size-3.5" />
          {collapsed ? (
            <span className="sr-only">Kortkommandon</span>
          ) : (
            <>
              Kortkommandon
              <kbd className={shortcutHintClass}>
                ?
              </kbd>
            </>
          )}
        </button>
        <button
          onClick={() => setActiveView("settings")}
          className={navClass(activeView === "settings")}
          title={collapsed ? "Inställningar (Ctrl+,)" : undefined}
          aria-label={collapsed ? "Inställningar (Ctrl+,)" : undefined}
        >
          <Settings className="size-4" />
          {collapsed ? (
            <span className="sr-only">Inställningar</span>
          ) : (
            <>
              Inställningar
              <kbd className={shortcutHintClass}>
                Ctrl+,
              </kbd>
            </>
          )}
        </button>
        {!collapsed && (
          <div className="mt-3 px-2 text-xs text-[var(--palette-text-subtle)]">
            Lectio · v{APP_VERSION}
          </div>
        )}
      </div>
    </nav>
  );
}

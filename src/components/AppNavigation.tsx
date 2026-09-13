import {
  BookOpen,
  Home,
  Inbox,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Wand2,
} from "lucide-react";
import { useAppStore } from "../core/store";
import { cn } from "../lib/utils";
import { APP_VERSION } from "../lib/appVersion";
import type { ReactNode } from "react";

const navigation = [
  { id: "dashboard", label: "Översikt", icon: Home, shortcut: "Ctrl+1" },
  { id: "inbox", label: "Inkorg", icon: Inbox, shortcut: "Ctrl+4" },
  {
    id: "super-actions",
    label: "Super Actions",
    icon: Wand2,
    shortcut: "Ctrl+5",
  },
] as const;

const shortcutHintClass =
  "ml-auto hidden shrink-0 whitespace-nowrap font-sans text-[11px] leading-none font-medium tabular-nums text-[var(--palette-text-subtle)] group-hover:inline-flex group-focus-visible:inline-flex";

/** Primary navigation shaped after the shadcn dashboard sidebar. */
export function AppNavigation({
  collapsed: collapsedOverride,
  onOpenLibrary,
  library,
  hideCollapseToggle = false,
}: {
  collapsed?: boolean;
  onOpenLibrary?: () => void;
  library?: ReactNode;
  hideCollapseToggle?: boolean;
} = {}) {
  const activeView = useAppStore((state) => state.activeView);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const sidebarCollapsed = useAppStore(
    (state) => state.settings.librarySidebarCollapsed,
  );
  const updateSettings = useAppStore((state) => state.updateSettings);
  const collapsed = collapsedOverride ?? sidebarCollapsed;
  const navClass = (isActive: boolean) =>
    cn(
      "group relative flex h-9 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-sm font-medium outline-none transition-[background-color,color] duration-150 focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
      collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
      isActive
        ? "bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]"
        : "text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)]",
    );
  return (
    <nav
      aria-label="Huvudnavigation"
      className={cn(
        "app-navigation flex h-full shrink-0 flex-col overflow-hidden bg-[var(--palette-surface)] transition-[padding] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-full p-2" : "w-full p-3 pb-2",
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
        {collapsed && onOpenLibrary && (
          <button
            onClick={onOpenLibrary}
            className={navClass(activeView === "workspace")}
            title="Öppna bibliotek"
            aria-label="Öppna bibliotek"
          >
            <BookOpen className="size-4 shrink-0" />
          </button>
        )}
      </div>

      {library && (
        <div className="mt-2 flex min-h-0 flex-1 border-t border-[var(--palette-border)]">
          {library}
        </div>
      )}

      <div className="mt-auto border-t border-[var(--palette-border)] pt-2">
        {!hideCollapseToggle && (
          <button
            onClick={() =>
              updateSettings({
                librarySidebarCollapsed: !sidebarCollapsed,
              })
            }
            className={cn(
              "group relative mb-1 flex h-8 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
              collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
            )}
            title={`${sidebarCollapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
            aria-label={`${sidebarCollapsed ? "Visa" : "Dölj"} sidofält (Ctrl+B)`}
          >
            {sidebarCollapsed ? (
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
        )}
        <button
          onClick={() =>
            window.dispatchEvent(new Event("lectio:show-shortcuts"))
          }
          className={cn(
            "group relative mb-1 flex h-8 w-full items-center overflow-hidden rounded-md whitespace-nowrap text-xs font-medium text-[var(--palette-text-muted)] outline-none transition-colors hover:bg-[var(--palette-surface-hover)] hover:text-[var(--palette-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]",
            collapsed ? "justify-center px-0" : "justify-start gap-2 px-2",
          )}
          title={collapsed ? "Kortkommandon" : undefined}
          aria-label="Kortkommandon"
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
          aria-label="Inställningar (Ctrl+,)"
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
      </div>
      <div
        data-version={APP_VERSION}
        className={cn(
          "mt-auto overflow-hidden whitespace-nowrap pt-3 text-xs text-[var(--palette-text-subtle)]",
          collapsed ? "px-0 text-center text-[10px]" : "px-2",
        )}
      >
        {collapsed ? `v${APP_VERSION}` : `Lectio · v${APP_VERSION}`}
      </div>
    </nav>
  );
}

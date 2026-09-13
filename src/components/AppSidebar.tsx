import { lazy, Suspense, useEffect, useState } from "react";
import { AppNavigation } from "./AppNavigation";
import { useAppStore } from "../core/store";
import { cn } from "../lib/utils";

const NARROW_QUERY = "(max-width: 900px)";
const LibrarySidebar = lazy(() =>
  import("../features/library/LibrarySidebar").then((module) => ({
    default: module.LibrarySidebar,
  })),
);

function useNarrowWindow() {
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** One permanent navigation surface: destinations above, library tree below. */
export function AppSidebar() {
  const userCollapsed = useAppStore(
    (state) => state.settings.librarySidebarCollapsed,
  );
  const narrow = useNarrowWindow();
  const collapsed = userCollapsed || narrow;
  const [treePanelOpen, setTreePanelOpen] = useState(false);

  return (
    <>
      <aside
        className={cn(
          "relative z-30 flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--palette-border)] bg-[var(--palette-surface)] transition-[width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-13" : "w-[300px]",
        )}
        aria-label="Sidofält"
      >
        <AppNavigation
          collapsed={collapsed}
          hideCollapseToggle={narrow}
          onOpenLibrary={() => setTreePanelOpen((open) => !open)}
          library={
            !collapsed ? (
              <Suspense fallback={null}>
                <LibrarySidebar embedded />
              </Suspense>
            ) : undefined
          }
        />
      </aside>

      {collapsed && treePanelOpen && (
        <>
          <button
            className="fixed inset-0 top-9 z-30 cursor-default bg-black/10"
            aria-label="Stäng bibliotek"
            onClick={() => setTreePanelOpen(false)}
          />
          <aside
            className="fixed bottom-0 left-13 top-9 z-40 flex w-[286px] overflow-hidden border-r border-[var(--palette-border)] bg-[var(--palette-surface)] shadow-xl"
            aria-label="Tillfälligt bibliotek"
          >
            <Suspense fallback={null}>
              <LibrarySidebar
                embedded
                forceVisible
                onNavigate={() => setTreePanelOpen(false)}
              />
            </Suspense>
          </aside>
        </>
      )}
    </>
  );
}

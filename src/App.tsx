import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { LibrarySidebar } from "./features/library/LibrarySidebar";
import {
  LectureWorkspace,
  ObjectOverview,
} from "./features/lecture/LectureWorkspace";
import { CardStudio } from "./features/cards/CardStudio";
import { SettingsView } from "./features/settings/SettingsView";
import { useAppStore } from "./core/store";
import { AppNavigation } from "./components/AppNavigation";
import { Dashboard } from "./features/dashboard/Dashboard";
import { ProgressCenter } from "./components/ProgressCenter";
import { applyPalette, resolvePalette } from "./core/theme";
import { TooltipProvider } from "./components/ui/tooltip";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { WindowTitleBar } from "./components/WindowTitleBar";

export default function App() {
  const { nodes, selectedId, activeView, settings, jobs } = useAppStore();
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0];
  const libraryOperation = jobs.find(
    (job) => job.kind === "library" && job.status === "active",
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    applyPalette(
      resolvePalette(settings.selectedPaletteId, settings.customPalettes),
    );
  }, [settings.selectedPaletteId, settings.customPalettes]);
  useEffect(() => {
    const isTextInput = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      );
    const openWorkspace = (eventName?: string, detail?: unknown) => {
      useAppStore.getState().setActiveView("workspace");
      if (eventName)
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent(eventName, { detail })),
          0,
        );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        useAppStore
          .getState()
          .jobs.some((job) => job.kind === "library" && job.status === "active")
      ) {
        event.preventDefault();
        return;
      }
      if (document.querySelector("[role='dialog']")) return;
      if (isTextInput(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier) {
        const key = event.key.toLowerCase();
        if (key === "1") {
          event.preventDefault();
          useAppStore.getState().setActiveView("dashboard");
        } else if (key === "2") {
          event.preventDefault();
          openWorkspace();
        } else if (key === "3") {
          event.preventDefault();
          useAppStore.getState().setActiveView("cards");
        } else if (key === ",") {
          event.preventDefault();
          useAppStore.getState().setActiveView("settings");
        } else if (key === "b") {
          event.preventDefault();
          const currentSettings = useAppStore.getState().settings;
          useAppStore.getState().updateSettings({
            librarySidebarCollapsed: !currentSettings.librarySidebarCollapsed,
          });
        } else if (key === "n") {
          event.preventDefault();
          openWorkspace("lectio:create-library-node", {
            type: event.shiftKey ? "lecture" : "next",
          });
        } else if (key === "f" && selected?.type === "lecture") {
          event.preventDefault();
          window.dispatchEvent(new Event("lectio:focus-transcript-search"));
        } else if (key === "enter" && selected?.type === "lecture") {
          event.preventDefault();
          useAppStore.getState().setActiveView("cards");
        }
        return;
      }
      if (!event.altKey && event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    const openHelp = () => setShortcutsOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("lectio:show-shortcuts", openHelp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("lectio:show-shortcuts", openHelp);
    };
  }, [selected?.type]);
  return (
    <TooltipProvider>
      <div className="ui-app-bg flex h-screen min-h-[640px] w-screen flex-col overflow-hidden text-slate-900">
        <WindowTitleBar />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppNavigation />
          {activeView !== "dashboard" && <LibrarySidebar />}
          {activeView === "dashboard" ? (
            <Dashboard />
          ) : activeView === "cards" ? (
            <CardStudio />
          ) : activeView === "settings" ? (
            <SettingsView />
          ) : selected?.type === "lecture" ? (
            <LectureWorkspace lectureId={selected.id} />
          ) : selected ? (
            <ObjectOverview nodeId={selected.id} />
          ) : null}
        </div>
        <Toaster position="bottom-right" richColors closeButton />
        {libraryOperation && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_srgb,var(--palette-background)_88%,transparent)] p-6 backdrop-blur-[1px]">
            <div className="max-w-sm rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] px-5 py-4 text-center shadow-lg">
              <p className="text-sm font-semibold text-[var(--palette-text)]">
                {libraryOperation.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                {libraryOperation.detail ?? "Biblioteket är tillfälligt låst för att skydda din data."}
              </p>
            </div>
          </div>
        )}
        <ProgressCenter />
        <KeyboardShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
      </div>
    </TooltipProvider>
  );
}

import { Toaster } from "sonner";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAppStore } from "./core/store";
import { AppNavigation } from "./components/AppNavigation";
import { ProgressCenter } from "./components/ProgressCenter";
import { applyPalette, resolvePalette } from "./core/theme";
import { TooltipProvider } from "./components/ui/tooltip";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { WindowTitleBar } from "./components/WindowTitleBar";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { syncGoogleDrive } from "./services/googleDriveSync";
import { syncErrorMessage } from "./services/sync";
import { isTauri } from "./services/platform";
import { toast } from "./services/feedbackToast";

const LibrarySidebar = lazy(() =>
  import("./features/library/LibrarySidebar").then((module) => ({
    default: module.LibrarySidebar,
  })),
);
const LectureWorkspace = lazy(() =>
  import("./features/lecture/LectureWorkspace").then((module) => ({
    default: module.LectureWorkspace,
  })),
);
const ObjectOverview = lazy(() =>
  import("./features/lecture/LectureWorkspace").then((module) => ({
    default: module.ObjectOverview,
  })),
);
const CardStudio = lazy(() =>
  import("./features/cards/CardStudio").then((module) => ({
    default: module.CardStudio,
  })),
);
const SettingsView = lazy(() =>
  import("./features/settings/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);
const Dashboard = lazy(() =>
  import("./features/dashboard/Dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);
const DriveInbox = lazy(() =>
  import("./features/inbox/DriveInbox").then((module) => ({
    default: module.DriveInbox,
  })),
);

function ViewLoader() {
  return (
    <main
      className="ui-app-bg grid min-w-0 flex-1 place-items-center"
      aria-busy="true"
    >
      <p className="text-sm text-[var(--palette-text-muted)]">Öppnar vy…</p>
    </main>
  );
}

export default function App() {
  const { nodes, selectedId, activeView, settings, jobs } = useAppStore();
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0];
  const libraryOperation = jobs.find(
    (job) => job.kind === "library" && job.status === "active",
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | undefined>();
  const [closeSyncState, setCloseSyncState] = useState<
    "syncing" | { error: string } | undefined
  >();
  const allowWindowClose = useRef(false);
  const closeSyncPromise = useRef<Promise<void> | undefined>(undefined);
  const startupSyncStarted = useRef(false);

  const closeWindow = useCallback(async () => {
    allowWindowClose.current = true;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  const syncBeforeClose = useCallback(() => {
    if (closeSyncPromise.current) return closeSyncPromise.current;
    setCloseSyncState("syncing");
    const task = syncGoogleDrive()
      .then(async () => {
        setCloseSyncState(undefined);
        await closeWindow();
      })
      .catch((error: unknown) => {
        setCloseSyncState({
          error: syncErrorMessage(
            error,
            "Google Drive-synken kunde inte slutföras.",
          ),
        });
      })
      .finally(() => {
        closeSyncPromise.current = undefined;
      });
    closeSyncPromise.current = task;
    return task;
  }, [closeWindow]);

  useEffect(() => {
    if (
      startupSyncStarted.current ||
      !isTauri() ||
      !settings.cloudSync.connectedAt ||
      !settings.cloudSync.autoSyncOnStartAndClose ||
      // Do not let an automatic retry block startup after this device has
      // already completed a cloud sync. Manual/close sync remains available.
      Boolean(settings.cloudSync.lastSyncedAt)
    ) {
      return;
    }
    startupSyncStarted.current = true;
    const timer = window.setTimeout(() => {
      void syncGoogleDrive().catch((error: unknown) => {
        toast.error(
          `Automatisk Google Drive-synk kunde inte starta: ${syncErrorMessage(error, "okänt fel")}`,
        );
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    settings.cloudSync.autoSyncOnStartAndClose,
    settings.cloudSync.connectedAt,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          if (allowWindowClose.current) return;
          const cloudSync = useAppStore.getState().settings.cloudSync;
          if (!cloudSync.connectedAt || !cloudSync.autoSyncOnStartAndClose)
            return;
          event.preventDefault();
          void syncBeforeClose();
        }),
      )
      .then((stopListening) => {
        unlisten = stopListening;
      })
      .catch((error: unknown) => {
        toast.error(
          `Kunde inte aktivera säker stängning: ${syncErrorMessage(error, "okänt fel")}`,
        );
      });
    return () => unlisten?.();
  }, [syncBeforeClose]);
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
    const openFeedback = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setFeedbackError(typeof detail === "string" ? detail : undefined);
      setFeedbackOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("lectio:show-shortcuts", openHelp);
    window.addEventListener("lectio:report-problem", openFeedback);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("lectio:show-shortcuts", openHelp);
      window.removeEventListener("lectio:report-problem", openFeedback);
    };
  }, [selected?.type]);
  return (
    <TooltipProvider>
      <div className="ui-app-bg flex h-full min-h-0 w-full flex-col overflow-hidden text-slate-900">
        <WindowTitleBar
          onReportProblem={() => {
            setFeedbackError(undefined);
            setFeedbackOpen(true);
          }}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppNavigation />
          <Suspense fallback={<ViewLoader />}>
            {activeView !== "dashboard" && <LibrarySidebar />}
            {activeView === "dashboard" ? (
              <Dashboard />
            ) : activeView === "cards" ? (
              <CardStudio />
            ) : activeView === "inbox" ? (
              <DriveInbox />
            ) : activeView === "settings" ? (
              <SettingsView />
            ) : selected?.type === "lecture" ? (
              <LectureWorkspace lectureId={selected.id} />
            ) : selected ? (
              <ObjectOverview nodeId={selected.id} />
            ) : null}
          </Suspense>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
        {libraryOperation && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_srgb,var(--palette-background)_88%,transparent)] p-6 backdrop-blur-[1px]">
            <div className="max-w-sm rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] px-5 py-4 text-center shadow-lg">
              <p className="text-sm font-semibold text-[var(--palette-text)]">
                {libraryOperation.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                {libraryOperation.detail ??
                  "Biblioteket är tillfälligt låst för att skydda din data."}
              </p>
            </div>
          </div>
        )}
        <ProgressCenter />
        <KeyboardShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
        <FeedbackDialog
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          initialError={feedbackError}
        />
        <Dialog
          open={Boolean(closeSyncState)}
          onOpenChange={(open) => {
            if (!open && closeSyncState !== "syncing")
              setCloseSyncState(undefined);
          }}
          title={
            closeSyncState === "syncing"
              ? "Synkar innan Lectio stängs"
              : "Synken kunde inte slutföras"
          }
          description={
            closeSyncState === "syncing"
              ? (libraryOperation?.detail ??
                "Väntar på att Google Drive-synken ska bli klar.")
              : "Dina lokala ändringar är kvar på datorn. Välj om du vill försöka igen eller stänga utan att synka."
          }
        >
          {closeSyncState === "syncing" ? (
            <div className="flex items-center gap-3 text-sm text-[var(--palette-text-muted)]">
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--palette-primary-muted)] border-t-[var(--palette-primary)]"
                aria-hidden="true"
              />
              Stäng inte appen förrän synken är klar.
            </div>
          ) : closeSyncState ? (
            <div className="space-y-4">
              <p className="rounded-md bg-[var(--palette-danger-muted)] p-3 text-sm leading-5 text-[var(--palette-danger)]">
                {closeSyncState.error}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setCloseSyncState(undefined)}
                >
                  Avbryt stängning
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void syncBeforeClose()}
                >
                  Försök igen
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void closeWindow()}
                >
                  Stäng ändå
                </Button>
              </div>
            </div>
          ) : null}
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

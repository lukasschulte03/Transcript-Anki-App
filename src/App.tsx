import { Toaster } from "sonner";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { hasStoreHydrated, onStoreHydrated, useAppStore } from "./core/store";
import { AppSidebar } from "./components/AppSidebar";
import { ProgressCenter } from "./components/ProgressCenter";
import { applyPalette, resolvePalette } from "./core/theme";
import { TooltipProvider } from "./components/ui/tooltip";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { WindowTitleBar } from "./components/WindowTitleBar";
import { toast } from "./services/feedbackToast";
import { markStartup, startupElapsedMs } from "./services/startupMetrics";
import { useJobStore } from "./infrastructure/jobStore";

const FeedbackDialog = lazy(() =>
  import("./components/FeedbackDialog").then((module) => ({
    default: module.FeedbackDialog,
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
const AnkiWorkspaceOverlay = lazy(() =>
  import("./features/cards/AnkiWorkspaceOverlay").then((module) => ({
    default: module.AnkiWorkspaceOverlay,
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
const SuperActions = lazy(() =>
  import("./features/superActions/SuperActions").then((module) => ({
    default: module.SuperActions,
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

function scheduleIdleWork(work: () => void, timeout = 1_500) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(work, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(work, timeout);
  return () => window.clearTimeout(id);
}

function StartupShell() {
  return (
    <main
      className="ui-app-bg flex h-full min-h-0 flex-col text-foreground"
      aria-label="Lectio startar"
      aria-live="polite"
    >
      <header className="flex h-9 shrink-0 items-center border-b border-[var(--palette-border)] bg-[var(--palette-surface)] px-3 text-[13px] font-bold">
        Lectio
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          className="w-[52px] shrink-0 border-r border-[var(--palette-border)] bg-[var(--palette-surface)]"
          aria-hidden="true"
        />
        <section className="grid flex-1 place-content-center justify-items-center gap-3">
          <span className="size-5 animate-spin rounded-full border-2 border-[var(--palette-border-strong)] border-t-[var(--palette-primary)] motion-reduce:animate-none" />
          <p className="text-sm text-[var(--palette-text-muted)]">
            Öppnar ditt bibliotek…
          </p>
        </section>
      </div>
    </main>
  );
}

function useStoreHydrated() {
  return useSyncExternalStore(
    onStoreHydrated,
    hasStoreHydrated,
    hasStoreHydrated,
  );
}

function LibraryOperationBlocker() {
  const operation = useJobStore((state) =>
    state.jobs.find(
      (job) =>
        job.kind === "library" &&
        job.status === "active" &&
        ["importing", "exporting", "packing"].includes(job.phase),
    ),
  );
  if (!operation) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_srgb,var(--palette-background)_88%,transparent)] p-6 backdrop-blur-[1px]">
      <div className="max-w-sm rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] px-5 py-4 text-center shadow-lg">
        <p className="text-sm font-semibold text-[var(--palette-text)]">
          {operation.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
          {operation.detail ??
            "Biblioteket är tillfälligt låst för att skydda din data."}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const hydrated = useStoreHydrated();
  useEffect(() => markStartup("react-mounted"), []);
  return hydrated ? <HydratedApp /> : <StartupShell />;
}

function HydratedApp() {
  const nodes = useAppStore((state) => state.nodes);
  const lectures = useAppStore((state) => state.lectures);
  const segments = useAppStore((state) => state.segments);
  const markers = useAppStore((state) => state.markers);
  const cards = useAppStore((state) => state.cards);
  const selectedId = useAppStore((state) => state.selectedId);
  const activeView = useAppStore((state) => state.activeView);
  const settings = useAppStore((state) => state.settings);
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0];
  const transcriptionActive = useJobStore((state) =>
    state.jobs.some(
      (job) => job.kind === "transcription" && job.status === "active",
    ),
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | undefined>();
  const [ankiOpen, setAnkiOpen] = useState(activeView === "cards");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  // Keep the tree mounted after its first use. Hidden views reclaim the full
  // workspace while the tree keeps its expanded state and returns instantly.
  useEffect(() => {
    if (activeView === "cards") {
      useAppStore.getState().setActiveView("workspace");
    }
  }, [activeView]);
  useEffect(() => {
    markStartup("app-mounted");
    markStartup("app-interactive");
    document.documentElement.dataset.lectioStartupReadyMs =
      String(startupElapsedMs());
    return scheduleIdleWork(() => {
      markStartup("batch-queue-resume");
      void import("./services/batchActions").then(({ resumeBatchQueue }) =>
        resumeBatchQueue(),
      );
    });
  }, []);
  useEffect(() => {
    let active = true;
    // First paint and normal navigation must never wait for a potentially
    // large IndexedDB recovery scan. The check still runs promptly when the
    // event loop is idle and remains unable to overwrite a non-empty library.
    const cancelIdleWork = scheduleIdleWork(() => {
      markStartup("library-safety-check");
      void import("./services/librarySafetyNet")
        .then(({ recoverEmptyLibrary }) =>
          recoverEmptyLibrary(
            useAppStore.getState(),
            useAppStore.getState().restoreLibraryBackup,
          ),
        )
        .then((backup) => {
          if (!active) return;
          if (backup)
            toast.success(
              `Lectio återställde automatiskt din senaste lokala säkerhetskopia från ${new Date(backup.createdAt).toLocaleString("sv-SE")}.`,
            );
          setRecoveryChecked(true);
        })
        .catch(() => {
          if (active) setRecoveryChecked(true);
        });
    }, 2_500);
    return () => {
      active = false;
      cancelIdleWork();
    };
  }, []);
  useEffect(() => {
    if (!recoveryChecked) return;
    const timer = window.setTimeout(() => {
      void import("./services/librarySafetyNet").then(
        ({ createAutomaticLibraryCheckpoint }) =>
          createAutomaticLibraryCheckpoint(useAppStore.getState()),
      );
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [recoveryChecked, nodes, lectures, segments, markers, cards]);
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
        useJobStore
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
          setAnkiOpen(true);
        } else if (key === "4") {
          event.preventDefault();
          useAppStore.getState().setActiveView("inbox");
        } else if (key === "5") {
          event.preventDefault();
          useAppStore.getState().setActiveView("super-actions");
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
          setAnkiOpen(true);
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
    const openAnki = () => setAnkiOpen(true);
    const closeAnki = () => setAnkiOpen(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("lectio:show-shortcuts", openHelp);
    window.addEventListener("lectio:report-problem", openFeedback);
    window.addEventListener("lectio:open-anki", openAnki);
    window.addEventListener("lectio:close-anki", closeAnki);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("lectio:show-shortcuts", openHelp);
      window.removeEventListener("lectio:report-problem", openFeedback);
      window.removeEventListener("lectio:open-anki", openAnki);
      window.removeEventListener("lectio:close-anki", closeAnki);
    };
  }, [selected?.type]);
  return (
    <TooltipProvider>
      <div className="ui-app-bg flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden text-foreground">
        <WindowTitleBar
          onReportProblem={() => {
            setFeedbackError(undefined);
            setFeedbackOpen(true);
          }}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar />
          <Suspense fallback={<ViewLoader />}>
            {activeView === "dashboard" ? (
              <Dashboard />
            ) : activeView === "inbox" ? (
              <DriveInbox />
            ) : activeView === "super-actions" ? (
              <SuperActions />
            ) : activeView === "settings" ? (
              <SettingsView />
            ) : selected?.type === "lecture" ? (
              // A lecture owns media elements, Blob URLs and the native PDF
              // viewer. A new key makes React fully dispose those resources
              // before another (possibly very large) lecture is mounted.
              <LectureWorkspace
                key={selected.id}
                lectureId={selected.id}
                mediaSuspended={transcriptionActive}
              />
            ) : selected ? (
              <ObjectOverview key={selected.id} nodeId={selected.id} />
            ) : null}
          </Suspense>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
        <LibraryOperationBlocker />
        <ProgressCenter />
        <KeyboardShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
        <Suspense fallback={null}>
          <AnkiWorkspaceOverlay open={ankiOpen} onOpenChange={setAnkiOpen} />
          <FeedbackDialog
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            initialError={feedbackError}
          />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}

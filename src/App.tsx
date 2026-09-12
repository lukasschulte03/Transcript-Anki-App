import { Toaster } from "sonner";
import {
  lazy,
  Suspense,
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
import { toast } from "./services/feedbackToast";
import {
  createAutomaticLibraryCheckpoint,
  recoverEmptyLibrary,
} from "./services/librarySafetyNet";
import { markStartup } from "./services/startupMetrics";

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
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const id = idleWindow.requestIdleCallback(work, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(work, timeout);
  return () => window.clearTimeout(id);
}

export default function App() {
  const {
    nodes,
    lectures,
    segments,
    markers,
    cards,
    selectedId,
    activeView,
    settings,
    jobs,
  } = useAppStore();
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0];
  // Only import/export locks the library. Background work such as slide-image
  // indexing must leave the workspace usable and report through ProgressCenter.
  const blockingLibraryOperation = jobs.find(
    (job) =>
      job.kind === "library" &&
      job.status === "active" &&
      ["importing", "exporting", "packing"].includes(job.phase),
  );
  const transcriptionActive = jobs.some(
    (job) => job.kind === "transcription" && job.status === "active",
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | undefined>();
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const showLibrarySidebar =
    activeView === "workspace" || activeView === "cards";
  // Keep the tree mounted after its first use. Hidden views reclaim the full
  // workspace while the tree keeps its expanded state and returns instantly.
  const librarySidebarWasMounted = useRef(showLibrarySidebar);
  if (showLibrarySidebar) librarySidebarWasMounted.current = true;
  useEffect(() => {
    markStartup("app-mounted");
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
      void recoverEmptyLibrary(
        useAppStore.getState(),
        useAppStore.getState().restoreLibraryBackup,
      ).then((backup) => {
        if (!active) return;
        if (backup)
          toast.success(
            `Lectio återställde automatiskt din senaste lokala säkerhetskopia från ${new Date(backup.createdAt).toLocaleString("sv-SE")}.`,
          );
        setRecoveryChecked(true);
      }).catch(() => {
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
      void createAutomaticLibraryCheckpoint(useAppStore.getState());
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
      <div className="ui-app-bg flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden text-slate-900">
        <WindowTitleBar
          onReportProblem={() => {
            setFeedbackError(undefined);
            setFeedbackOpen(true);
          }}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppNavigation />
          <Suspense fallback={<ViewLoader />}>
            {librarySidebarWasMounted.current && (
              <LibrarySidebar />
            )}
            {activeView === "dashboard" ? (
              <Dashboard />
            ) : activeView === "cards" ? (
              <CardStudio />
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
        {blockingLibraryOperation && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-[color-mix(in_srgb,var(--palette-background)_88%,transparent)] p-6 backdrop-blur-[1px]">
            <div className="max-w-sm rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] px-5 py-4 text-center shadow-lg">
              <p className="text-sm font-semibold text-[var(--palette-text)]">
                {blockingLibraryOperation.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                {blockingLibraryOperation.detail ??
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
      </div>
    </TooltipProvider>
  );
}

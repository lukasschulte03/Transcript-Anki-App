import { Toaster } from "sonner";
import { useEffect } from "react";
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

export default function App() {
  const { nodes, selectedId, activeView, settings } = useAppStore();
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0];
  useEffect(() => {
    applyPalette(
      resolvePalette(settings.selectedPaletteId, settings.customPalettes),
    );
  }, [settings.selectedPaletteId, settings.customPalettes]);
  return (
    <TooltipProvider>
      <div className="ui-app-bg flex h-screen min-h-[640px] w-screen overflow-hidden text-slate-900">
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
        <Toaster position="bottom-right" richColors closeButton />
        <ProgressCenter />
      </div>
    </TooltipProvider>
  );
}

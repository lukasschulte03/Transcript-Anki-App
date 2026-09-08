import { useEffect, useState } from "react";
import { DownloadCloud, Image, LoaderCircle, Sparkles } from "lucide-react";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import { toast } from "../../services/feedbackToast";
import { openExternal } from "../../services/platform";
import {
  getLocalVisionStatus,
  installLocalVisionModel,
  type LocalVisionStatus,
} from "../../services/localVision";

/** A deliberately small control surface: local is opt-in; cloud is only a roadmap cue. */
export function LocalVisionSettings() {
  const { settings, updateSettings } = useAppStore();
  const [status, setStatus] = useState<LocalVisionStatus>();
  const [working, setWorking] = useState(false);
  const refresh = () => void getLocalVisionStatus().then(setStatus).catch(() => setStatus(undefined));
  useEffect(refresh, []);

  const install = async () => {
    setWorking(true);
    try {
      const next = await installLocalVisionModel();
      setStatus(next);
      updateSettings({ localVisualDescriptions: "local" });
      toast.success("Lokal bildbeskrivning är redo");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mt-4 border-t border-[var(--palette-border)] pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]">
            <Image className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--palette-text)]">Lokal bildbeskrivning</p>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--palette-text-muted)]">
              Moondream beskriver relevanta slidebilder på din dator. Bildfiler och föreläsningsmaterial lämnar aldrig enheten.
            </p>
          </div>
        </div>
        {!status?.ollamaInstalled ? (
          <Button variant="outline" size="sm" onClick={() => void openExternal("https://ollama.com/download")}>
            <DownloadCloud className="size-3.5" /> Hämta Ollama
          </Button>
        ) : !status.modelInstalled ? (
          <Button size="sm" onClick={() => void install()} disabled={working}>
            {working ? <LoaderCircle className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
            {working ? "Hämtar modell…" : "Ladda ner Moondream"}
          </Button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={!status?.modelInstalled}
          onClick={() => updateSettings({ localVisualDescriptions: "local" })}
          className={`rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--palette-focus-ring)] ${settings.localVisualDescriptions === "local" ? "border-[var(--palette-primary)] bg-[var(--palette-primary-muted)]" : "border-[var(--palette-border)] bg-[var(--palette-surface)] hover:bg-[var(--palette-surface-hover)]"} disabled:cursor-not-allowed disabled:opacity-55`}
        >
          <span className="text-xs font-semibold text-[var(--palette-text)]">Lokalt</span>
          <span className="mt-1 block text-xs text-[var(--palette-text-muted)]">
            {status?.modelInstalled ? "Redo · körs i bakgrunden" : "Installera Moondream först"}
          </span>
        </button>
        <div className="rounded-lg border border-dashed border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--palette-text-muted)]"><Sparkles className="size-3.5" /> Cloud/API · kommer snart</span>
          <span className="mt-1 block text-xs text-[var(--palette-text-subtle)]">Ingen nyckel, betalning eller extern anslutning används i dag.</span>
        </div>
      </div>
      {!status?.ollamaInstalled && (
        <p className="mt-3 text-xs text-[var(--palette-text-subtle)]">Installera Ollama en gång, öppna det och återvänd sedan hit för att hämta modellen.</p>
      )}
      {status?.modelInstalled && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--palette-success)]">Moondream är installerad lokalt. Välj “Lokalt” för att aktivera bildbeskrivning.</p>
          {settings.localVisualDescriptions === "local" && <Button variant="ghost" size="sm" onClick={() => updateSettings({ localVisualDescriptions: "off" })}>Stäng av</Button>}
        </div>
      )}
    </div>
  );
}

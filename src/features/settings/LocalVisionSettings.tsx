import { useEffect, useState } from "react";
import { Check, DownloadCloud, Image, LoaderCircle } from "lucide-react";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import { toast } from "../../services/feedbackToast";
import {
  getLocalVisionStatus,
  installLocalVisionModel,
  type LocalVisionStatus,
} from "../../services/localVision";

/** A single opt-in flow: Lectio owns the local Nvidia vision package. */
export function LocalVisionSettings() {
  const { settings, updateSettings } = useAppStore();
  const [status, setStatus] = useState<LocalVisionStatus>();
  const [working, setWorking] = useState(false);
  const refresh = () =>
    void getLocalVisionStatus()
      .then(setStatus)
      .catch(() => setStatus(undefined));
  useEffect(refresh, []);

  const install = async () => {
    setWorking(true);
    try {
      const next = await installLocalVisionModel();
      setStatus(next);
      updateSettings({ localVisualDescriptions: "nvidia" });
      toast.success("Automatiska bilder är redo");
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
            <p className="text-sm font-medium text-[var(--palette-text)]">
              Automatiska bilder i Anki
            </p>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--palette-text-muted)]">
              PP-StructureV3 hittar först bild- och diagramutklipp i slides.
              Lectio använder sedan en fast lokal Nvidia-bildmotor för korta
              beskrivningar. Bildfiler och föreläsningsmaterial lämnar aldrig
              datorn.
            </p>
          </div>
        </div>
        {!status?.nvidiaDetected ? (
          <span className="rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] px-2.5 py-1.5 text-xs text-[var(--palette-text-muted)]">
            Nvidia-GPU krävs
          </span>
        ) : !status.ready ? (
          <Button size="sm" onClick={() => void install()} disabled={working}>
            {working ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="size-3.5" />
            )}
            {working ? "Förbereder bildmotorn…" : "Aktivera och ladda ner"}
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--palette-success)]">
            <Check className="size-4" /> Redo lokalt
          </span>
        )}
      </div>
      <div className="mt-3">
        <button
          type="button"
          disabled={!status?.ready}
          onClick={() => updateSettings({ localVisualDescriptions: "nvidia" })}
          className={`rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--palette-focus-ring)] ${settings.localVisualDescriptions === "nvidia" ? "border-[var(--palette-primary)] bg-[var(--palette-primary-muted)]" : "border-[var(--palette-border)] bg-[var(--palette-surface)] hover:bg-[var(--palette-surface-hover)]"} disabled:cursor-not-allowed disabled:opacity-55`}
        >
          <span className="text-xs font-semibold text-[var(--palette-text)]">
            Automatiskt
          </span>
          <span className="mt-1 block text-xs text-[var(--palette-text-muted)]">
            {status?.ready
              ? "Den lokala Nvidia-bildmotorn är redo"
              : "Aktivera bildmotorn först"}
          </span>
        </button>
      </div>
      {!status?.nvidiaDetected && (
        <p className="mt-3 text-xs text-[var(--palette-text-subtle)]">
          Funktionen är frivillig. Lectio fungerar som vanligt utan Nvidia-GPU.
        </p>
      )}
      {status?.nvidiaDetected && !status.ready && (
        <p className="mt-3 text-xs text-[var(--palette-text-subtle)]">
          {status.nvidiaName ?? "Nvidia-GPU"} används när den lokala
          bildanalysen körs. Nedladdningen visas i förloppspanelen och kan
          avbrytas.
        </p>
      )}
      {status?.ready && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--palette-success)]">
            Bildmotorn är redo lokalt och används bara när du väljer att
            beskriva bilder.
          </p>
          {settings.localVisualDescriptions === "nvidia" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateSettings({ localVisualDescriptions: "off" })}
            >
              Stäng av
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

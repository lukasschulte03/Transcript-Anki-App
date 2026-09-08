import { useEffect, useMemo, useState } from "react";
import { EyeOff, Image, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { useAppStore } from "../../core/store";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../components/ui/Button";
import {
  moduleVisualCandidates,
  resolveVisualDescriptionImage,
  resolveVisualThumbnail,
  visualCandidateDescription,
} from "../../services/visualIndex";
import { getLocalVisionStatus, localOllamaVisionProvider } from "../../services/localVision";
import { runExclusiveVision } from "../../services/visualDescriptionQueue";
import { uid } from "../../lib/utils";
import { toast } from "../../services/feedbackToast";

export function ModuleVisualLibrary({ moduleId }: { moduleId: string }) {
  const { nodes, lectures, cards, settings, updateLecture } = useAppStore(useShallow((state) => ({
    nodes: state.nodes,
    lectures: state.lectures,
    cards: state.cards,
    settings: state.settings,
    updateLecture: state.updateLecture,
  })));
  const [showHidden, setShowHidden] = useState(false);
  const candidates = useMemo(
    () => moduleVisualCandidates(nodes, lectures, moduleId, { includeHidden: showHidden }),
    [lectures, moduleId, nodes, showHidden],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const [preview, setPreview] = useState<string | undefined>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const hiddenIds = new Set(
    Object.values(lectures).flatMap((lecture) => lecture.hiddenVisualIds ?? []),
  );
  // PPTX media is always a real image. For PDFs, prefer pages with little or
  // no extractable text: those are the slides where vision adds information
  // rather than rephrasing a text-heavy page.
  const pendingDescriptions = candidates.filter((candidate) => {
    const alreadyDescribed = candidate.localVision?.sourceHash === (candidate.contentHash ?? candidate.sourceHash);
    const likelyVisual = Boolean(candidate.assetId) || candidate.description.includes("visuell slide utan läsbar text") || candidate.description.length < 230;
    return !alreadyDescribed && likelyVisual;
  });

  useEffect(() => {
    let active = true;
    let previewUrl: string | undefined;
    if (!selected) {
      setPreview(undefined);
      return;
    }
    setLoadingPreview(true);
    void resolveVisualThumbnail(
      selected,
      lectures[selected.lectureId],
    ).then((thumbnail) => {
      previewUrl = thumbnail ? URL.createObjectURL(thumbnail) : undefined;
      if (!active) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return;
      }
      setPreview(previewUrl);
      setLoadingPreview(false);
    });
    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [lectures, selected]);

  useEffect(() => {
    setDescriptionDraft(selected?.localVision?.description ?? "");
  }, [selected?.id, selected?.localVision?.description]);

  const toggleHidden = (id: string, lectureId: string) => {
    const lecture = lectures[lectureId];
    if (!lecture) return;
    const hidden = new Set(lecture.hiddenVisualIds ?? []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    updateLecture(lectureId, { hiddenVisualIds: [...hidden] });
  };

  const describeNewVisuals = async () => {
    if (settings.localVisualDescriptions !== "local") {
      toast.error("Aktivera Lokal bildbeskrivning under Inställningar först.");
      return;
    }
    const status = await getLocalVisionStatus();
    if (!status.modelInstalled) {
      toast.error("Moondream är inte installerad ännu. Hämta den under Inställningar.");
      return;
    }
    if (!pendingDescriptions.length) {
      toast.success("Alla synliga bilder har redan en lokal beskrivning.");
      return;
    }
    const jobId = `vision:${moduleId}:${uid()}`;
    const label = `Beskriver ${pendingDescriptions.length} slidebilder`;
    const store = useAppStore.getState();
    store.upsertJob({ id: jobId, kind: "vision", label, phase: "queued", status: "queued", current: 0, total: pendingDescriptions.length });
    runExclusiveVision(jobId, async (signal) => {
      const state = useAppStore.getState();
      state.upsertJob({ id: jobId, kind: "vision", label, phase: "preparing", status: "active", current: 0, total: pendingDescriptions.length, detail: "Förbereder lokala slidebilder…" });
      let completed = 0;
      try {
        for (const candidate of pendingDescriptions) {
          if (signal.aborted) throw new DOMException("Avbruten", "AbortError");
          const current = useAppStore.getState();
          const lecture = current.lectures[candidate.lectureId];
          const sourceCandidate = lecture?.visualIndex?.find((item) => item.id === candidate.id);
          const image = sourceCandidate && lecture
            ? await resolveVisualDescriptionImage(sourceCandidate, lecture)
            : undefined;
          if (image && sourceCandidate && lecture) {
            const result = await localOllamaVisionProvider.describe(image, signal);
            const latest = useAppStore.getState();
            const owner = latest.lectures[candidate.lectureId];
            if (owner?.visualIndex) {
              latest.updateLecture(candidate.lectureId, {
                visualIndex: owner.visualIndex.map((item) => item.id === candidate.id ? {
                  ...item,
                  localVision: {
                    ...result,
                    model: "moondream",
                    generatedAt: new Date().toISOString(),
                    sourceHash: item.contentHash ?? item.sourceHash,
                  },
                } : item),
              });
            }
          }
          completed += 1;
          useAppStore.getState().upsertJob({ id: jobId, kind: "vision", label, phase: "preparing", status: "active", current: completed, total: pendingDescriptions.length, detail: `Beskriver bild ${completed} av ${pendingDescriptions.length} lokalt…` });
        }
        useAppStore.getState().upsertJob({ id: jobId, kind: "vision", label, phase: "complete", status: "complete", current: completed, total: pendingDescriptions.length, detail: "Lokala bildbeskrivningar är klara." });
        toast.success("Bildbiblioteket har uppdaterats lokalt");
      } catch (error) {
        const cancelled = signal.aborted || (error instanceof DOMException && error.name === "AbortError");
        useAppStore.getState().upsertJob({ id: jobId, kind: "vision", label, phase: cancelled ? "cancelled" : "error", status: cancelled ? "cancelled" : "error", current: completed, total: pendingDescriptions.length, detail: cancelled ? "Bildbeskrivningen avbröts." : String(error) });
        if (!cancelled) toast.error("Kunde inte beskriva slidebilder lokalt");
      }
    });
  };

  const saveDescription = () => {
    if (!selected) return;
    const owner = lectures[selected.lectureId];
    const description = descriptionDraft.trim();
    if (!owner?.visualIndex) return;
    updateLecture(selected.lectureId, {
      visualIndex: owner.visualIndex.map((item) => item.id === selected.id ? {
        ...item,
        localVision: description ? {
          description,
          keywords: item.localVision?.keywords ?? [],
          model: "manuell",
          generatedAt: new Date().toISOString(),
          sourceHash: item.contentHash ?? item.sourceHash,
        } : undefined,
      } : item),
    });
    toast.success(description ? "Bildbeskrivningen sparades" : "Lokal bildbeskrivning rensades");
  };

  return (
    <section className="rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--palette-text)]">
            <Image className="size-4 text-[var(--palette-accent)]" /> Bildbibliotek
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--palette-text-muted)]">
            Lokala slides från hela modulen. AI:n får bara korta beskrivningar — aldrig själva bilderna.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHidden((value) => !value)}
        >
          {showHidden ? <RotateCcw className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {showHidden ? "Dölj rensade" : "Visa rensade"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void describeNewVisuals()}
          disabled={!pendingDescriptions.length}
          title={pendingDescriptions.length ? "Beskriv nya bildkandidater lokalt i bakgrunden" : "Alla bilder har redan en lokal beskrivning"}
        >
          <WandSparkles className="size-3.5" /> Beskriv {pendingDescriptions.length || ""} bilder
        </Button>
      </div>

      {!candidates.length ? (
        <div className="mt-5 rounded-lg border border-dashed border-[var(--palette-border)] px-4 py-7 text-center">
          <p className="text-sm font-medium text-[var(--palette-text)]">Inga slidebilder ännu</p>
          <p className="mt-1 text-xs text-[var(--palette-text-muted)]">
            Importera en PDF i en föreläsning i modulen så byggs biblioteket lokalt i bakgrunden.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--palette-border)]">
            {candidates.map((candidate) => {
              const hidden = hiddenIds.has(candidate.id);
              const used = cards.filter(
                (card) =>
                  card.visualId === candidate.id &&
                  (card.visualLectureId ?? card.lectureId) === candidate.lectureId,
              ).length;
              const selectedRow = selected?.id === candidate.id;
              return (
                <div
                  key={candidate.id}
                  className={`flex items-center gap-2 border-b border-[var(--palette-border)] px-3 py-2 last:border-b-0 ${selectedRow ? "bg-[var(--palette-primary-muted)]" : "hover:bg-[var(--palette-surface-hover)]"}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(candidate.id)}
                    className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--palette-focus-ring)]"
                  >
                    <p className="truncate text-xs font-medium text-[var(--palette-text)]">
                      {candidate.lectureTitle} · slide {candidate.slidePage}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-[var(--palette-text-muted)]">
                      {visualCandidateDescription(candidate).replace(/^Slide \d+:\s*/i, "")}
                    </p>
                  </button>
                  {used > 0 && (
                    <span className="shrink-0 text-[0.7rem] text-[var(--palette-text-subtle)]">
                      {used} kort
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => toggleHidden(candidate.id, candidate.lectureId)}
                    aria-label={hidden ? "Återställ bild" : "Rensa bort bild"}
                    title={hidden ? "Återställ till biblioteket" : "Rensa från biblioteket"}
                  >
                    {hidden ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5 text-destructive" />}
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)]">
            {preview ? (
              <img
                src={preview}
                alt={selected ? `${selected.lectureTitle}, slide ${selected.slidePage}` : "Vald slide"}
                className="aspect-[4/3] w-full object-contain"
              />
            ) : (
              <div className="grid aspect-[4/3] place-items-center px-3 text-center text-xs text-[var(--palette-text-muted)]">
                {loadingPreview ? "Laddar lokal förhandsvisning…" : "Förhandsvisning saknas för denna fil."}
              </div>
            )}
            {selected && (
              <div className="border-t border-[var(--palette-border)] p-3">
                <p className="text-xs text-[var(--palette-text-muted)]">{selected.lectureTitle} · slide {selected.slidePage}</p>
                <label className="mt-3 block text-[0.7rem] font-medium uppercase tracking-wide text-[var(--palette-text-subtle)]">Lokal bildbeskrivning</label>
                <textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder="Ingen lokal visionsbeskrivning ännu"
                  className="mt-1 min-h-20 w-full resize-y rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface)] px-2 py-1.5 text-xs leading-5 text-[var(--palette-text)] outline-none placeholder:text-[var(--palette-text-subtle)] focus:ring-2 focus:ring-[var(--palette-focus-ring)]"
                />
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={saveDescription}>Spara</Button>
                  {selected.localVision && <Button variant="ghost" size="sm" onClick={() => { setDescriptionDraft(""); const owner = lectures[selected.lectureId]; if (owner?.visualIndex) updateLecture(selected.lectureId, { visualIndex: owner.visualIndex.map((item) => item.id === selected.id ? { ...item, localVision: undefined } : item) }); }}>Rensa</Button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

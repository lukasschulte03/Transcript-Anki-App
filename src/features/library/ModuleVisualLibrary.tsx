/* oxlint-disable react/set-state-in-effect -- effects synchronize object URLs and the selected visual. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Trash2, WandSparkles } from "lucide-react";
import { db } from "../../core/database";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import {
  buildStoredSlideVisualIndex,
  moduleVisualCandidates,
  resolveVisualDescriptionImage,
  resolveVisualThumbnail,
  visualCandidateDescription,
} from "../../services/visualIndex";
import {
  getLocalVisionStatus,
  localNvidiaVisionProvider,
} from "../../services/localVision";
import { runExclusiveVision } from "../../services/visualDescriptionQueue";
import { queueSlideIndex } from "../../services/slideIndexQueue";
import { uid } from "../../lib/utils";
import { toast } from "../../services/feedbackToast";

export function ModuleVisualLibrary({ moduleId }: { moduleId: string }) {
  const { nodes, lectures, cards, settings, updateLecture, upsertJob } =
    useAppStore();
  const repairedLectureIds = useRef(new Set<string>());
  const candidates = useMemo(
    () => moduleVisualCandidates(nodes, lectures, moduleId),
    [lectures, moduleId, nodes],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected =
    candidates.find((candidate) => candidate.id === selectedId) ??
    candidates[0];
  const [preview, setPreview] = useState<string | undefined>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  // Keep all slide pages available. A text-heavy medical slide can still
  // contain a clinically useful diagram, and the student can remove unwanted
  // candidates afterwards from this module library.
  const pendingDescriptions = candidates.filter(
    (candidate) =>
      candidate.localVision?.sourceHash !==
      (candidate.contentHash ?? candidate.sourceHash),
  );

  const legacySlideLectures = useMemo(() => {
    const descendants = new Set<string>([moduleId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (
          node.parentId &&
          descendants.has(node.parentId) &&
          !descendants.has(node.id)
        ) {
          descendants.add(node.id);
          changed = true;
        }
      }
    }
    return nodes
      .filter((node) => node.type === "lecture" && descendants.has(node.id))
      .map((node) => lectures[node.id])
      .filter((lecture): lecture is NonNullable<typeof lecture> =>
        Boolean(
          lecture?.slideAssetId && (
          lecture.visualIndexVersion !== 2 ||
          !lecture.visualIndex?.length ||
            lecture.visualIndex.some(
              (candidate) =>
                (!candidate.crop && !candidate.assetId) ||
                (Boolean(candidate.crop) && candidate.cropText === undefined),
            )),
        ),
      );
  }, [lectures, moduleId, nodes]);

  // Old PDFs can be indexed on demand. Automatically starting every legacy
  // lecture when a module opens caused long background bursts and could starve
  // WebView2 on a large library.
  const queueExistingSlideIndexes = () => {
    const repairs = legacySlideLectures.filter((lecture) => {
      if (repairedLectureIds.current.has(lecture.lectureId)) return false;
      repairedLectureIds.current.add(lecture.lectureId);
      return true;
    });

    for (const lecture of repairs) {
      const jobId = `visual-index-repair:${lecture.lectureId}:${uid()}`;
      const total = lecture.slidePages?.length;
      upsertJob({
        id: jobId,
        kind: "library",
        label: "Indexerar befintliga slidebilder",
        phase: "queued",
        status: "queued",
        current: 0,
        total,
        detail: "Väntar på ledig bildanalys…",
      });
      queueSlideIndex(jobId, async () => {
        useAppStore.getState().upsertJob({
          id: jobId,
          kind: "library",
          label: "Indexerar befintliga slidebilder",
          phase: "indexing",
          status: "active",
          current: 0,
          total,
          detail: "Startar layoutanalys…",
        });
        try {
          const visual = await buildStoredSlideVisualIndex(
            lecture,
            (current, count, detail) => {
              useAppStore.getState().upsertJob({
                id: jobId,
                kind: "library",
                label: "Indexerar befintliga slidebilder",
                phase: "indexing",
                status: "active",
                current,
                total: count,
                detail,
              });
            },
          );
          if (!visual) {
            useAppStore.getState().upsertJob({
              id: jobId,
              kind: "library",
              label: "Indexerar befintliga slidebilder",
              phase: "complete",
              status: "complete",
              current: 0,
              total: 0,
              detail: "Inga användbara bildutklipp hittades.",
            });
            return;
          }
          // Layout detection can legitimately yield no new crop on a text-only
          // deck. Never let that empty result erase visuals the student had
          // already indexed (or manually described) earlier.
          if (!visual.candidates.length) {
            useAppStore.getState().upsertJob({
              id: jobId,
              kind: "library",
              label: "Indexerar befintliga slidebilder",
              phase: "complete",
              status: "complete",
              current: visual.pages.length,
              total: visual.pages.length,
              detail: lecture.visualIndex?.length
                ? `${visual.pages.length} slides analyserade · inga nya bildutklipp hittades. Befintligt bildbibliotek behölls.`
                : `${visual.pages.length} slides analyserade · inga användbara bildutklipp hittades.`,
            });
            return;
          }
          const existingById = new Map(
            (lecture.visualIndex ?? []).map((candidate) => [
              candidate.id,
              candidate,
            ]),
          );
          const deleted = new Set(lecture.deletedVisualIds ?? []);
          const candidates = visual.candidates
            .filter((candidate) => !deleted.has(candidate.id))
            .map((candidate) => ({
              ...candidate,
              // The crop has been refreshed, but keep a user-approved local
              // description for the same stable candidate rather than making
              // them run the local Nvidia engine again.
              localVision: existingById.get(candidate.id)?.localVision,
            }));
          useAppStore.getState().updateLecture(lecture.lectureId, {
            slidePages: visual.pages,
            slideText: visual.slideText,
            visualIndex: candidates,
            visualIndexHash: visual.sourceHash,
            visualIndexVersion: 2,
            visualIndexUpdatedAt: new Date().toISOString(),
          });
          useAppStore.getState().upsertJob({
            id: jobId,
            kind: "library",
            label: "Indexerar befintliga slidebilder",
            phase: "complete",
            status: "complete",
            current: visual.pages.length,
            total: visual.pages.length,
            detail: `${visual.pages.length} slides analyserade · ${candidates.length} bildutklipp är klara.`,
          });
        } catch (error) {
          useAppStore.getState().upsertJob({
            id: jobId,
            kind: "library",
            label: "Indexerar befintliga slidebilder",
            phase: "error",
            status: "error",
            current: 0,
            total,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }
  };

  useEffect(() => {
    let active = true;
    let previewUrl: string | undefined;
    if (!selected) {
      setPreview(undefined);
      return;
    }
    setLoadingPreview(true);
    void resolveVisualThumbnail(selected, lectures[selected.lectureId]).then(
      (thumbnail) => {
        previewUrl = thumbnail ? URL.createObjectURL(thumbnail) : undefined;
        if (!active) {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          return;
        }
        setPreview(previewUrl);
        setLoadingPreview(false);
      },
    );
    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [lectures, selected]);

  useEffect(() => {
    setDescriptionDraft(selected?.localVision?.description ?? "");
  }, [selected?.id, selected?.localVision?.description]);

  // Earlier versions only hid candidates. Migrate those old choices once so
  // re-indexing cannot unexpectedly bring discarded images back.
  useEffect(() => {
    for (const lecture of Object.values(lectures)) {
      if (!lecture.hiddenVisualIds?.length || !lecture.visualIndex) continue;
      const removed = new Set(lecture.hiddenVisualIds);
      updateLecture(lecture.lectureId, {
        visualIndex: lecture.visualIndex.filter((item) => !removed.has(item.id)),
        deletedVisualIds: [
          ...new Set([...(lecture.deletedVisualIds ?? []), ...removed]),
        ],
        hiddenVisualIds: undefined,
      });
    }
  }, [lectures, updateLecture]);

  const deleteVisual = async (candidate: (typeof candidates)[number]) => {
    const lecture = lectures[candidate.lectureId];
    if (!lecture?.visualIndex) return;
    if (candidate.assetId) await db.assets.delete(candidate.assetId);
    updateLecture(candidate.lectureId, {
      visualIndex: lecture.visualIndex.filter((item) => item.id !== candidate.id),
      deletedVisualIds: [
        ...new Set([...(lecture.deletedVisualIds ?? []), candidate.id]),
      ],
      hiddenVisualIds: (lecture.hiddenVisualIds ?? []).filter(
        (id) => id !== candidate.id,
      ),
    });
    if (selectedId === candidate.id) setSelectedId(undefined);
    toast.success("Bildutklippet och dess lokala data raderades");
  };

  const describeNewVisuals = async () => {
    if (settings.localVisualDescriptions !== "nvidia") {
      toast.error(
        "Aktivera Automatiska bilder i Anki under Inställningar först.",
      );
      return;
    }
    const status = await getLocalVisionStatus();
    if (!status.ready) {
      toast.error(
        status.nvidiaDetected
          ? "Bildmotorn är inte redo ännu. Aktivera den under Inställningar."
          : "Automatiska bilder kräver en Nvidia-GPU på den här datorn.",
      );
      return;
    }
    if (!pendingDescriptions.length) {
      toast.success("Alla synliga bilder har redan en lokal beskrivning.");
      return;
    }
    const jobId = `vision:${moduleId}:${uid()}`;
    const label = `Beskriver ${pendingDescriptions.length} slidebilder`;
    const store = useAppStore.getState();
    store.upsertJob({
      id: jobId,
      kind: "vision",
      label,
      phase: "queued",
      status: "queued",
      current: 0,
      total: pendingDescriptions.length,
    });
    runExclusiveVision(jobId, async (signal) => {
      const state = useAppStore.getState();
      state.upsertJob({
        id: jobId,
        kind: "vision",
        label,
        phase: "preparing",
        status: "active",
        current: 0,
        total: pendingDescriptions.length,
        detail: "Förbereder lokala slidebilder…",
      });
      let completed = 0;
      try {
        for (const candidate of pendingDescriptions) {
          if (signal.aborted) throw new DOMException("Avbruten", "AbortError");
          const current = useAppStore.getState();
          const lecture = current.lectures[candidate.lectureId];
          const sourceCandidate = lecture?.visualIndex?.find(
            (item) => item.id === candidate.id,
          );
          const image =
            sourceCandidate && lecture
              ? await resolveVisualDescriptionImage(sourceCandidate, lecture)
              : undefined;
          if (image && sourceCandidate && lecture) {
            const chain = [] as string[];
            let node = current.nodes.find(
              (item) => item.id === candidate.lectureId,
            );
            const visited = new Set<string>();
            while (node && !visited.has(node.id)) {
              visited.add(node.id);
              if (node.context?.trim()) chain.unshift(node.context.trim());
              node = node.parentId
                ? current.nodes.find((item) => item.id === node?.parentId)
                : undefined;
            }
            const slideText =
              lecture.slidePages?.[
                Math.max(0, sourceCandidate.slidePage - 1)
              ] ?? sourceCandidate.description;
            const context = [
              `Föreläsning: ${candidate.lectureTitle}`,
              `Slide ${sourceCandidate.slidePage}: ${slideText}`,
              chain.length ? `Studiecontext: ${chain.join(" ")}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            const result = await localNvidiaVisionProvider.describe(
              image,
              signal,
              context,
            );
            const latest = useAppStore.getState();
            const owner = latest.lectures[candidate.lectureId];
            if (owner?.visualIndex) {
              latest.updateLecture(candidate.lectureId, {
                visualIndex: owner.visualIndex.map((item) =>
                  item.id === candidate.id
                    ? {
                        ...item,
                        localVision: {
                          ...result,
                          model: "Lectio Nvidia Vision",
                          generatedAt: new Date().toISOString(),
                          sourceHash: item.contentHash ?? item.sourceHash,
                        },
                      }
                    : item,
                ),
              });
            }
          }
          completed += 1;
          useAppStore.getState().upsertJob({
            id: jobId,
            kind: "vision",
            label,
            phase: "preparing",
            status: "active",
            current: completed,
            total: pendingDescriptions.length,
            detail: `Beskriver bild ${completed} av ${pendingDescriptions.length} lokalt…`,
          });
        }
        useAppStore.getState().upsertJob({
          id: jobId,
          kind: "vision",
          label,
          phase: "complete",
          status: "complete",
          current: completed,
          total: pendingDescriptions.length,
          detail: "Lokala bildbeskrivningar är klara.",
        });
        toast.success("Bildbiblioteket har uppdaterats lokalt");
      } catch (error) {
        const cancelled =
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        useAppStore.getState().upsertJob({
          id: jobId,
          kind: "vision",
          label,
          phase: cancelled ? "cancelled" : "error",
          status: cancelled ? "cancelled" : "error",
          current: completed,
          total: pendingDescriptions.length,
          detail: cancelled ? "Bildbeskrivningen avbröts." : String(error),
        });
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
      visualIndex: owner.visualIndex.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              localVision: description
                ? {
                    description,
                    keywords: item.localVision?.keywords ?? [],
                    model: "manuell",
                    generatedAt: new Date().toISOString(),
                    sourceHash: item.contentHash ?? item.sourceHash,
                  }
                : undefined,
            }
          : item,
      ),
    });
    toast.success(
      description
        ? "Bildbeskrivningen sparades"
        : "Lokal bildbeskrivning rensades",
    );
  };

  return (
    <section className="rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--palette-text)]">
            <Image className="size-4 text-[var(--palette-accent)]" />{" "}
            Bildbibliotek
          </div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--palette-text-muted)]">
            Lokala bildutklipp från hela modulen. Hel slides används aldrig som
            Anki-bilder.
          </p>
        </div>
        {legacySlideLectures.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={queueExistingSlideIndexes}
          >
            Indexera {legacySlideLectures.length} äldre slide
            {legacySlideLectures.length === 1 ? "" : "s"}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void describeNewVisuals()}
          disabled={!pendingDescriptions.length}
          title={
            pendingDescriptions.length
              ? "Beskriv nya bildkandidater lokalt i bakgrunden"
              : "Alla bilder har redan en lokal beskrivning"
          }
        >
          <WandSparkles className="size-3.5" /> Beskriv{" "}
          {pendingDescriptions.length || ""} bildutklipp
        </Button>
      </div>

      {!candidates.length ? (
        <div className="mt-5 rounded-lg border border-dashed border-[var(--palette-border)] px-4 py-7 text-center">
          <p className="text-sm font-medium text-[var(--palette-text)]">
            Inga bildutklipp ännu
          </p>
          <p className="mt-1 text-xs text-[var(--palette-text-muted)]">
            Öppna modulen igen efter import så hittar PP-StructureV3 lokala
            bildutklipp i slidesen.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="max-h-80 overflow-y-auto rounded-lg border border-[var(--palette-border)]">
            {candidates.map((candidate) => {
              const used = cards.filter(
                (card) =>
                  card.visualId === candidate.id &&
                  (card.visualLectureId ?? card.lectureId) ===
                    candidate.lectureId,
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
                      {visualCandidateDescription(candidate).replace(
                        /^Slide \d+:\s*/i,
                        "",
                      )}
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
                    onClick={() => void deleteVisual(candidate)}
                    aria-label="Radera bildutklipp permanent"
                    title="Radera bildutklipp, OCR-text och beskrivning permanent"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)]">
            {preview ? (
              <img
                src={preview}
                alt={
                  selected
                    ? `${selected.lectureTitle}, slide ${selected.slidePage}`
                    : "Vald slide"
                }
                className="aspect-[4/3] min-h-52 w-full object-contain"
              />
            ) : (
              <div className="grid aspect-[4/3] place-items-center px-3 text-center text-xs text-[var(--palette-text-muted)]">
                {loadingPreview
                  ? "Laddar lokal förhandsvisning…"
                  : "Förhandsvisning saknas för denna fil."}
              </div>
            )}
            {selected && (
              <div className="border-t border-[var(--palette-border)] p-3">
                <p className="text-xs text-[var(--palette-text-muted)]">
                  {selected.lectureTitle} · slide {selected.slidePage}
                </p>
                {selected.cropText && (
                  <div className="mt-3 border-l border-[var(--palette-border-strong)] pl-2.5">
                    <p className="text-[0.7rem] font-medium uppercase tracking-wide text-[var(--palette-text-subtle)]">
                      Text i utklippet
                    </p>
                    <p className="mt-1 max-h-20 overflow-y-auto text-xs leading-5 text-[var(--palette-text-muted)]">
                      {selected.cropText}
                    </p>
                  </div>
                )}
                <label className="mt-3 block text-[0.7rem] font-medium uppercase tracking-wide text-[var(--palette-text-subtle)]">
                  Lokal bildbeskrivning
                </label>
                <textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder="Ingen lokal visionsbeskrivning ännu"
                  className="mt-1 min-h-20 w-full resize-y rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface)] px-2 py-1.5 text-xs leading-5 text-[var(--palette-text)] outline-none placeholder:text-[var(--palette-text-subtle)] focus:ring-2 focus:ring-[var(--palette-focus-ring)]"
                />
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={saveDescription}>
                    Spara
                  </Button>
                  {selected.localVision && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDescriptionDraft("");
                        const owner = lectures[selected.lectureId];
                        if (owner?.visualIndex)
                          updateLecture(selected.lectureId, {
                            visualIndex: owner.visualIndex.map((item) =>
                              item.id === selected.id
                                ? { ...item, localVision: undefined }
                                : item,
                            ),
                          });
                      }}
                    >
                      Rensa
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

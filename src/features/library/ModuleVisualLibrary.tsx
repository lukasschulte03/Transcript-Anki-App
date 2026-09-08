import { useEffect, useMemo, useState } from "react";
import { EyeOff, Image, RotateCcw, Trash2 } from "lucide-react";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import {
  moduleVisualCandidates,
  resolveVisualMedia,
} from "../../services/visualIndex";

export function ModuleVisualLibrary({ moduleId }: { moduleId: string }) {
  const { nodes, lectures, cards, updateLecture } = useAppStore();
  const [showHidden, setShowHidden] = useState(false);
  const candidates = useMemo(
    () => moduleVisualCandidates(nodes, lectures, moduleId, { includeHidden: showHidden }),
    [lectures, moduleId, nodes, showHidden],
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const [preview, setPreview] = useState<string | undefined>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const hiddenIds = new Set(
    Object.values(lectures).flatMap((lecture) => lecture.hiddenVisualIds ?? []),
  );

  useEffect(() => {
    let active = true;
    if (!selected) {
      setPreview(undefined);
      return;
    }
    setLoadingPreview(true);
    void resolveVisualMedia(
      { visualId: selected.id },
      lectures[selected.lectureId],
    ).then((media) => {
      if (!active) return;
      setPreview(media ? `data:image/png;base64,${media.data}` : undefined);
      setLoadingPreview(false);
    });
    return () => {
      active = false;
    };
  }, [lectures, selected]);

  const toggleHidden = (id: string, lectureId: string) => {
    const lecture = lectures[lectureId];
    if (!lecture) return;
    const hidden = new Set(lecture.hiddenVisualIds ?? []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    updateLecture(lectureId, { hiddenVisualIds: [...hidden] });
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
                      {candidate.description.replace(/^Slide \d+:\s*/i, "")}
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
              <p className="border-t border-[var(--palette-border)] px-3 py-2 text-xs text-[var(--palette-text-muted)]">
                {selected.lectureTitle} · slide {selected.slidePage}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

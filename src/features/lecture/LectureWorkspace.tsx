import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookText,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Presentation,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAppStore } from "../../core/store";
import { db } from "../../core/database";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select, Textarea } from "../../components/ui/Form";
import { confirmStorageForImport, formatTime, uid } from "../../lib/utils";
import { parseTimestampedText } from "../../services/transcription";
import { extractPdfPages, formatSlideText } from "../../services/pdf";
import { suggestSlideMappings } from "../../services/slideMatching";
import { AudioPanel } from "./AudioPanel";
import { PdfSlideViewer } from "./PdfSlideViewer";
import { toast } from "../../services/feedbackToast";

function qualityFlagLabel(flag: string) {
  return {
    empty: "tomt segment",
    "very-short": "extremt kort",
    duplicate: "upprepad rad",
    "repeated-phrase": "upprepad fras",
    "needs-review": "möjlig avkodningsartefakt",
  }[flag] ?? "att granska";
}

export function LectureWorkspace({ lectureId }: { lectureId: string }) {
  const {
    nodes,
    lectures,
    segments,
    markers,
    cards,
    updateNode,
    updateLecture,
    updateSegment,
    removeSegment,
    setSegmentQualityFlag,
    updateMarker,
    removeMarker,
    removeSuspiciousSegments,
    setSegments,
    setActiveView,
  } = useAppStore();
  const node = nodes.find((n) => n.id === lectureId)!;
  const lecture = lectures[lectureId] ?? { lectureId, notes: "" };
  const transcript = segments
    .filter((s) => s.lectureId === lectureId)
    .sort((a, b) => a.start - b.start);
  const marks = markers
    .filter((m) => m.lectureId === lectureId)
    .sort((a, b) => a.time - b.time);
  const lectureCards = cards.filter((card) => card.lectureId === lectureId);
  const statusItems = [
    { label: "Ljud", ready: Boolean(lecture.audioAssetId || lecture.audioParts?.length), action: "Importera eller spela in" },
    { label: "Slides", ready: Boolean(lecture.slideAssetId), action: "Lägg till slides" },
    { label: "Transkript", ready: transcript.length > 0, action: "Transkribera" },
    { label: "Anteckningar", ready: Boolean(lecture.notes?.trim()), action: "Skriv en kort anteckning" },
    { label: "Markeringar", ready: marks.length > 0, action: "Markera viktiga moment" },
    { label: "Kort", ready: lectureCards.length > 0, action: "Skapa kort" },
    { label: "Anki", ready: lectureCards.some((card) => card.status === "synced"), action: "Godkänn och synka kort" },
  ];
  const slideAsset = useLiveQuery(
    () =>
      lecture.slideAssetId ? db.assets.get(lecture.slideAssetId) : undefined,
    [lecture.slideAssetId],
  );
  const slideUrl = useMemo(
    () => (slideAsset ? URL.createObjectURL(slideAsset.blob) : ""),
    [slideAsset],
  );
  const [time, setTime] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [rawTranscript, setRawTranscript] = useState("");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const [transcriptReplacement, setTranscriptReplacement] = useState("");
  const [lectureSettingsOpen, setLectureSettingsOpen] = useState(false);
  const [qualityReviewOpen, setQualityReviewOpen] = useState(false);
  const transcriptPane = useRef<HTMLDivElement>(null);
  const slideImportInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (slideUrl) URL.revokeObjectURL(slideUrl);
    },
    [slideUrl],
  );
  const activeSegment = useMemo(
    () => transcript.find((s) => time >= s.start && time < s.end)?.id,
    [time, transcript],
  );
  const visibleTranscript = useMemo(() => {
    const query = transcriptQuery.trim().toLocaleLowerCase();
    if (!query) return transcript;
    return transcript.filter((segment) =>
      segment.text.toLocaleLowerCase().includes(query),
    );
  }, [transcript, transcriptQuery]);
  const suspiciousSegments = transcript.filter((segment) => segment.suspicious);
  const qualitySummary = suspiciousSegments.reduce<Record<string, number>>(
    (summary, segment) => {
      (segment.qualityFlags?.length
        ? segment.qualityFlags
        : ["needs-review"]
      ).forEach((flag) => {
        summary[flag] = (summary[flag] ?? 0) + 1;
      });
      return summary;
    },
    {},
  );
  const slideMappings = lecture.slideMappings ?? {};
  const suggestSlides = () => {
    if (!lecture.slidePages?.length || !transcript.length) return;
    const mappings = suggestSlideMappings(lecture.slidePages, transcript);
    updateLecture(lectureId, { slideMappings: mappings });
    toast.success(`${Object.keys(mappings).length} slidekopplingar föreslogs`);
  };
  useEffect(() => {
    if (activeSegment)
      transcriptPane.current
        ?.querySelector(`[data-segment="${activeSegment}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegment]);
  useEffect(() => {
    const focusTranscriptSearch = () => {
      document
        .querySelector<HTMLInputElement>("[data-lectio-transcript-search]")
        ?.focus();
    };
    window.addEventListener(
      "lectio:focus-transcript-search",
      focusTranscriptSearch,
    );
    return () =>
      window.removeEventListener(
        "lectio:focus-transcript-search",
        focusTranscriptSearch,
      );
  }, []);
  const importSlides = async (file?: File) => {
    if (!file) return;
    if (!(await confirmStorageForImport(file, "slidefilen"))) return;
    const id = uid();
    await db.assets.put({
      id,
      lectureId,
      kind: "slides",
      name: file.name,
      mimeType: file.type,
      blob: file,
      createdAt: new Date().toISOString(),
    });
    updateLecture(lectureId, {
      slideAssetId: id,
      slideName: file.name,
      slideText: undefined,
      slidePages: undefined,
    });
    if (
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf")
    ) {
      try {
        const pages = await extractPdfPages(file);
        updateLecture(lectureId, {
          slideText: formatSlideText(pages),
          slidePages: pages,
        });
        const foundText = pages.filter(Boolean).length;
        toast.success(
          foundText
            ? `Slides importerade · text hittades på ${foundText} sidor`
            : "Slides importerade · ingen valbar text hittades i PDF:en",
        );
      } catch {
        toast.success("Slides importerade · text kan läggas till manuellt");
      }
    } else {
      toast.success("Slides importerade");
    }
  };
  const path = (() => {
    const result = [];
    let n = node;
    while (n) {
      result.unshift(n);
      n = nodes.find((x) => x.id === n.parentId)!;
    }
    return result;
  })();
  const importTranscript = () => {
    const result = parseTimestampedText(rawTranscript);
    setSegments(lectureId, result.segments);
    setRawTranscript("");
    setImportOpen(false);
    toast.success(`${result.segments.length} segment importerade`);
  };
  const seek = (seconds: number) => {
    setTime(seconds);
    window.dispatchEvent(
      new CustomEvent("lectio:seek", { detail: { lectureId, time: seconds } }),
    );
  };
  const runStatusAction = (label: string) => {
    if (label === "Ljud") {
      window.dispatchEvent(new CustomEvent("lectio:import-audio", { detail: { lectureId } }));
    } else if (label === "Slides") {
      slideImportInput.current?.click();
    } else if (label === "Transkript") {
      window.dispatchEvent(new CustomEvent("lectio:open-transcription", { detail: { lectureId } }));
    } else if (label === "Anteckningar") {
      document
        .querySelector<HTMLTextAreaElement>("[data-lectio-notes]")
        ?.focus();
    } else if (label === "Markeringar") {
      window.dispatchEvent(new CustomEvent("lectio:mark-moment", { detail: { lectureId } }));
    } else {
      setActiveView("cards");
    }
  };
  const replaceTranscriptMatches = () => {
    const query = transcriptQuery.trim();
    if (!query) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(escaped, "gi");
    visibleTranscript.forEach((segment) => {
      updateSegment(
        segment.id,
        segment.text.replace(matcher, transcriptReplacement),
      );
    });
    toast.success(`${visibleTranscript.length} segment uppdaterades`);
  };
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            {path.slice(1, -1).map((p) => (
              <span className="flex items-center gap-1" key={p.id}>
                {p.title}
                <ChevronRight className="size-3" />
              </span>
            ))}
          </div>
          <input
            value={node.title}
            onChange={(e) => updateNode(node.id, { title: e.target.value })}
            className="w-full min-w-0 border-none bg-transparent text-lg font-semibold tracking-tight text-slate-900 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActiveView("cards")}
          >
            <BookText className="size-4" /> Skapa kort
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLectureSettingsOpen(true)}
            title="Föreläsningens kontext och inställningar"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </header>
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-6 py-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Nästa steg</span>
        {statusItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => !item.ready && runStatusAction(item.label)}
            className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--palette-focus-ring)] ${item.ready ? "cursor-default bg-[var(--palette-success-muted)] text-[var(--palette-success)]" : "bg-muted text-muted-foreground hover:bg-[var(--palette-primary-muted)] hover:text-[var(--palette-text)]"}`}
            title={item.ready ? `${item.label} är klar` : item.action}
          >
            {item.ready ? "✓" : "○"} {item.label}
          </button>
        ))}
        {!statusItems.every((item) => item.ready) && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{statusItems.find((item) => !item.ready)?.action}</span>}
      </div>
      <main className="ui-app-bg grid min-h-0 flex-1 grid-cols-[minmax(320px,1fr)_minmax(360px,0.9fr)] gap-3 overflow-hidden p-3">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface-muted)]">
          <div className="flex h-11 items-center justify-between border-b border-[var(--palette-border)] bg-[var(--palette-surface)] px-4">
            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--palette-text)]">
              <Presentation className="size-4 shrink-0 text-[var(--palette-text-subtle)]" />
              <span className="shrink-0">Slides</span>
              {slideAsset?.name && (
                <span
                  className="min-w-0 truncate border-l border-[var(--palette-border)] pl-2 font-normal text-[var(--palette-text-subtle)]"
                  title={slideAsset.name}
                >
                  {slideAsset.name}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" asChild>
              <label className="cursor-pointer">
                <FileUp className="size-3.5" /> Lägg till
                <input
                  ref={slideImportInput}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => importSlides(e.target.files?.[0])}
                />
              </label>
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-3">
            {slideUrl ? (
              slideAsset?.mimeType === "application/pdf" ||
              slideAsset?.name.toLowerCase().endsWith(".pdf") ? (
                <PdfSlideViewer blob={slideAsset.blob} name={slideAsset.name} />
              ) : (
                <img
                  src={slideUrl}
                  alt="Slides"
                  className="max-h-full max-w-full object-contain"
                />
              )
            ) : (
              <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white/60 px-12 py-12 text-center hover:border-violet-300 hover:bg-white">
                <div className="grid size-12 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <FileUp className="size-5" />
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-700">
                  Lägg till slides
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  PDF eller bild
                </div>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => importSlides(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
        </section>
        <section className="grid min-h-0 grid-rows-[minmax(240px,1.1fr)_minmax(180px,0.8fr)] gap-3 bg-transparent">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white">
            <div className="flex h-11 items-center justify-between border-b border-slate-100 px-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <MessageSquareText className="size-4 text-slate-400" />{" "}
                Transkript{" "}
                <span className="text-xs text-slate-500">
                  {transcript.length}
                </span>
                {suspiciousSegments.length > 0 && (
                  <span className="rounded-md bg-[var(--palette-warning-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--palette-warning)]">
                    {suspiciousSegments.length} att granska
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {lecture.slidePages?.length && transcript.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={suggestSlides}>
                    Koppla slides
                  </Button>
                )}
                {suspiciousSegments.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setQualityReviewOpen(true)}
                  >
                    Granska {suspiciousSegments.length}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                >
                  <Plus className="size-3.5" /> Importera text
                </Button>
              </div>
            </div>
            {transcript.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                <Input
                  data-lectio-transcript-search
                  value={transcriptQuery}
                  onChange={(event) => setTranscriptQuery(event.target.value)}
                  placeholder="Sök i transkript"
                  className="h-8 min-w-36 flex-1 text-xs"
                />
                <Input
                  value={transcriptReplacement}
                  onChange={(event) =>
                    setTranscriptReplacement(event.target.value)
                  }
                  placeholder="Ersätt med"
                  className="h-8 min-w-28 flex-1 text-xs"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={replaceTranscriptMatches}
                  disabled={
                    !transcriptQuery.trim() || !visibleTranscript.length
                  }
                >
                  Ersätt {visibleTranscript.length || ""}
                </Button>
              </div>
            )}
            <div
              ref={transcriptPane}
              className="min-h-0 flex-1 overflow-y-auto p-3"
            >
              {transcript.length ? (
                visibleTranscript.length ? (
                  visibleTranscript.map((s) => (
                    <div
                      key={s.id}
                      data-segment={s.id}
                      className={`group flex items-start gap-3 rounded-lg border px-2 py-2 transition-colors ${activeSegment === s.id ? "border-[var(--palette-border-strong)] bg-[var(--palette-primary-muted)]" : "border-transparent hover:bg-[var(--palette-surface-hover)]"}`}
                    >
                      <button
                        onClick={() => seek(s.start)}
                        className="mt-0.5 shrink-0 font-mono text-xs font-medium text-[var(--palette-accent)]"
                      >
                        {formatTime(s.start)}
                      </button>
                      <textarea
                        value={s.text}
                        onChange={(e) => updateSegment(s.id, e.target.value)}
                        rows={Math.min(
                          5,
                          Math.max(1, Math.ceil(s.text.length / 65)),
                        )}
                        className="max-h-28 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-5 text-[var(--palette-text)] outline-none"
                      />
                      {s.suspicious && (
                        <span className="mt-1 shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Kontrollera
                        </span>
                      )}
                      {lecture.slidePages?.length && (
                        <Select
                          value={slideMappings[s.id]?.page ?? 0}
                          onChange={(event) => {
                            const page = Number(event.target.value);
                            const next = { ...slideMappings };
                            if (page) next[s.id] = { page, confidence: 100 };
                            else delete next[s.id];
                            updateLecture(lectureId, { slideMappings: next });
                          }}
                          className="mt-0.5 h-7 w-24 shrink-0 py-1 text-xs"
                          title="Kopplad slide"
                        >
                          <option value={0}>Ingen slide</option>
                          {lecture.slidePages.map((_, index) => (
                            <option key={index} value={index + 1}>
                              Slide {index + 1}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="p-6 text-center text-xs text-slate-400">
                    Inga segment matchar sökningen.
                  </p>
                )
              ) : (
                <div className="grid h-full place-items-center px-8 text-center">
                  <div>
                    <MessageSquareText className="mx-auto size-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-600">
                      Inget transkript ännu
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Importera tidsstämplad text eller transkribera ljudet med
                      en valfri API-provider.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-3 bg-transparent">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white">
              <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-4 text-xs font-semibold text-slate-700">
                <BookText className="size-4 text-slate-400" /> Anteckningar
              </div>
              <Textarea
                data-lectio-notes
                value={lecture.notes}
                onChange={(e) =>
                  updateLecture(lectureId, { notes: e.target.value })
                }
                placeholder="Skriv korta anteckningar här…"
                className="min-h-0 flex-1 rounded-none border-0 p-4 shadow-none focus:ring-0"
              />
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white">
              <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-4 text-xs font-semibold text-slate-700">
                <Star className="size-4 text-amber-500" /> Markeringar{" "}
                <span className="text-slate-400">{marks.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {marks.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-start gap-2 rounded-lg p-2 hover:bg-slate-50"
                  >
                    <span className="mt-1 flex items-center gap-1 font-mono text-xs font-medium text-amber-600">
                      <Clock3 className="size-3" />
                      {formatTime(m.time)}
                    </span>
                    <input
                      value={m.note}
                      onChange={(e) => updateMarker(m.id, e.target.value)}
                      placeholder="Lägg till kommentar…"
                      className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none"
                    />
                    <button
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => removeMarker(m.id)}
                    >
                      <Trash2 className="size-3.5 text-slate-400" />
                    </button>
                  </div>
                ))}
                {!marks.length && (
                  <p className="p-4 text-center text-xs leading-5 text-slate-400">
                    Tryck “Markera viktigt” under föreläsningen.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
      <AudioPanel lectureId={lectureId} onTime={setTime} />
      <Dialog
        open={qualityReviewOpen}
        onOpenChange={setQualityReviewOpen}
        title="Granska transkriptkvalitet"
        description="Flaggorna beräknas lokalt. Ingen text tas bort förrän du väljer det själv."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-[var(--palette-text-muted)]">
            {Object.entries(qualitySummary).map(([flag, count]) => (
              <span key={flag} className="rounded-md bg-[var(--palette-warning-muted)] px-2 py-1 text-[var(--palette-warning)]">
                {count} {qualityFlagLabel(flag)}
              </span>
            ))}
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {suspiciousSegments.map((segment) => (
              <div key={segment.id} className="rounded-lg border border-[var(--palette-border)] p-3">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 text-xs font-medium text-[var(--palette-accent)]">{formatTime(segment.start)}</span>
                  <p className="min-w-0 flex-1 text-sm leading-5 text-[var(--palette-text)]">{segment.text || "(tomt segment)"}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(segment.qualityFlags?.length ? segment.qualityFlags : ["needs-review"]).map((flag) => (
                    <span key={flag} className="text-xs text-[var(--palette-text-subtle)]">{qualityFlagLabel(flag)}</span>
                  ))}
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={() => setSegmentQualityFlag(segment.id, false)}>Behåll</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeSegment(segment.id)}>Ta bort</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[var(--palette-border)] pt-3">
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => {
              if (confirm(`Ta bort ${suspiciousSegments.length} flaggade segment? Detta kan inte ångras.`)) {
                removeSuspiciousSegments(lectureId);
                setQualityReviewOpen(false);
              }
            }}>Rensa alla flaggade</Button>
            <Button size="sm" onClick={() => setQualityReviewOpen(false)}>Klar</Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={lectureSettingsOpen}
        onOpenChange={setLectureSettingsOpen}
        title="Föreläsningens inställningar"
        description="Kontext, slide-text och lokala val används när studiematerial skapas."
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <Label>Kontext för föreläsningen</Label>
            <Textarea
              className="min-h-28"
              value={node.context}
              onChange={(event) =>
                updateNode(node.id, { context: event.target.value })
              }
              placeholder="Lärandemål, viktiga avgränsningar eller instruktioner…"
            />
          </div>
          <div>
            <Label>Text från slides</Label>
            <Textarea
              className="min-h-40"
              value={lecture.slideText ?? ""}
              onChange={(event) =>
                updateLecture(lectureId, { slideText: event.target.value })
              }
              placeholder="Klistra in eller korrigera text från presentationen. Den kan väljas som källa för Anki-kort."
            />
            {lecture.slidePages?.length ? (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Texten extraherades lokalt från {lecture.slidePages.length}{" "}
                slides. Sidindelningen behålls lokalt och används för framtida
                slidekopplingar.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Studiespråk</Label>
              <Select
                value={node.settings.language ?? ""}
                onChange={(event) =>
                  updateNode(node.id, {
                    settings: {
                      ...node.settings,
                      language: event.target.value || undefined,
                    },
                  })
                }
              >
                <option value="">Ärv automatiskt</option>
                <option value="sv">Svenska</option>
                <option value="en">Engelska</option>
                <option value="mixed">Blandat språk</option>
              </Select>
            </div>
          </div>
          <p className="px-1 text-xs leading-5 text-slate-500">
            Anki-lekar följer automatiskt Kurs → Modul → Föreläsning när kort
            synkas.
          </p>
          <div>
            <Label>Instruktion för kortstil</Label>
            <Input
              value={node.settings.cardStyle ?? ""}
              onChange={(event) =>
                updateNode(node.id, {
                  settings: {
                    ...node.settings,
                    cardStyle: event.target.value || undefined,
                  },
                })
              }
              placeholder="Ärv eller ange en särskild stil för denna föreläsning"
            />
          </div>
        </div>
      </Dialog>
      <Dialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Importera transkript"
        description="Klistra in vanlig text eller rader med tidsstämplar, till exempel 12:30–12:42 Text."
      >
        <Textarea
          value={rawTranscript}
          onChange={(e) => setRawTranscript(e.target.value)}
          className="h-64 font-mono text-xs"
          placeholder={
            "00:00–00:12 Introduktion till ämnet\n00:12–00:31 Första konceptet…"
          }
        />
        <div className="mt-4 flex justify-end">
          <Button disabled={!rawTranscript.trim()} onClick={importTranscript}>
            Importera segment
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function ObjectOverview({ nodeId }: { nodeId: string }) {
  const { nodes, updateNode, removeNode, inheritedContext } = useAppStore();
  const node = nodes.find((n) => n.id === nodeId)!;
  const children = nodes.filter((n) => n.parentId === nodeId);
  const context = inheritedContext(nodeId);
  const contextNodeIds = useMemo(() => {
    const chain: string[] = [];
    let current = nodes.find((item) => item.id === nodeId);
    while (current) {
      chain.unshift(current.id);
      current = current.parentId
        ? nodes.find((item) => item.id === current?.parentId)
        : undefined;
    }
    return chain;
  }, [nodeId, nodes]);
  const contextNodeKey = contextNodeIds.join(":");
  const inheritedFiles = useLiveQuery(
    () => db.assets.where("nodeId").anyOf(contextNodeIds).toArray(),
    [contextNodeKey],
  );
  const contextFileInput = useRef<HTMLInputElement>(null);
  const contextFiles = useLiveQuery(
    () => db.assets.where("nodeId").equals(nodeId).toArray(),
    [nodeId],
  );
  const importContextFiles = async (fileList?: FileList) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const unsupported = files.find(
      (file) =>
        file.type !== "application/pdf" && !/\.(pdf|txt|md)$/i.test(file.name),
    );
    if (unsupported) {
      toast.error("Context stöder PDF-, TXT- och Markdown-filer.");
      return;
    }
    for (const file of files) {
      if (!(await confirmStorageForImport(file, "contextfilen"))) return;
    }
    for (const file of files) {
      let extractedText = "";
      try {
        extractedText =
          file.type === "application/pdf" || /\.pdf$/i.test(file.name)
            ? formatSlideText(await extractPdfPages(file))
            : await file.text();
      } catch {
        toast.warning(`${file.name} sparades, men text kunde inte extraheras.`);
      }
      await db.assets.put({
        id: uid(),
        lectureId: nodeId,
        nodeId,
        kind: "file",
        name: file.name,
        mimeType: file.type || "text/plain",
        blob: file,
        extractedText: extractedText.slice(0, 120_000),
        createdAt: new Date().toISOString(),
      });
    }
    if (contextFileInput.current) contextFileInput.current.value = "";
    toast.success(
      files.length === 1 ? "Contextfil tillagd" : `${files.length} contextfiler tillagda`,
    );
  };
  const removeContextFile = async (id: string, name: string) => {
    if (!confirm(`Ta bort contextfilen ${name}?`)) return;
    await db.assets.delete(id);
    toast.success("Contextfilen togs bort");
  };
  return (
    <div className="ui-app-bg min-w-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-violet-600">
              {
                {
                  workspace: "Studier",
                  course: "Kurs",
                  module: "Modul",
                  topic: "Ämne",
                  lecture: "Föreläsning",
                }[node.type]
              }
            </div>
            <input
              value={node.title}
              onChange={(e) => updateNode(node.id, { title: e.target.value })}
              className="mt-1 w-full border-0 bg-transparent text-3xl font-bold tracking-tight text-slate-900 outline-none"
            />
            <p className="mt-2 text-sm text-slate-500">
              {children.length} underobjekt · lokal lagring
            </p>
          </div>
          {node.type !== "workspace" && (
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                confirm(`Ta bort ${node.title} och allt innehåll?`) &&
                removeNode(node.id)
              }
            >
              <Trash2 className="size-4" /> Ta bort
            </Button>
          )}
        </div>
        <div className="mt-8 grid grid-cols-[1fr_280px] gap-6">
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <MessageSquareText className="size-4 text-violet-500" /> Kontext
                för detta objekt
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Ärvs av alla underliggande objekt och används vid AI-generering.
              </p>
              <Textarea
                className="mt-4 min-h-52"
                value={node.context}
                onChange={(e) =>
                  updateNode(node.id, { context: e.target.value })
                }
                placeholder="Exempel: Kursens lärandemål, notation, tentamensformat eller särskilda instruktioner…"
              />
              <div className="mt-4 border-t border-[var(--palette-border)] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[var(--palette-text)]">
                      Bifogade contextfiler
                    </div>
                    <p className="mt-1 text-xs text-[var(--palette-text-muted)]">
                      PDF, TXT och Markdown extraheras lokalt och ärvs nedåt.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      <FileUp className="size-3.5" /> Lägg till filer
                      <input
                        ref={contextFileInput}
                        type="file"
                        accept="application/pdf,.pdf,text/plain,.txt,text/markdown,.md"
                        multiple
                        className="hidden"
                        onChange={(event) =>
                          void importContextFiles(event.target.files ?? undefined)
                        }
                      />
                    </label>
                  </Button>
                </div>
                {contextFiles?.length ? (
                  <ul className="mt-3 divide-y divide-[var(--palette-border)] rounded-lg border border-[var(--palette-border)]">
                    {contextFiles.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-2 px-3 py-2 text-xs"
                      >
                        <BookText className="size-3.5 shrink-0 text-[var(--palette-text-subtle)]" />
                        <span className="min-w-0 flex-1 truncate font-medium text-[var(--palette-text)]">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-[var(--palette-text-subtle)]">
                          {file.extractedText?.trim()
                            ? `${Math.ceil(file.extractedText.length / 4).toLocaleString("sv-SE")} tokens`
                            : "Ingen text"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void removeContextFile(file.id, file.name)}
                          aria-label={`Ta bort ${file.name}`}
                          title="Ta bort contextfil"
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-[var(--palette-text-subtle)]">
                    Inga filer har lagts till på den här nivån.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 className="size-4 text-violet-500" /> Egna
                inställningar
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Tomma fält använder inställningen från närmaste överordnade
                objekt.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <Label>Studiespråk</Label>
                  <Select
                    value={node.settings.language ?? ""}
                    onChange={(event) =>
                      updateNode(node.id, {
                        settings: {
                          ...node.settings,
                          language: event.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">Ärv automatiskt</option>
                    <option value="sv">Svenska</option>
                    <option value="en">Engelska</option>
                    <option value="mixed">Blandat språk</option>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Instruktion för kortstil</Label>
                  <Input
                    value={node.settings.cardStyle ?? ""}
                    onChange={(event) =>
                      updateNode(node.id, {
                        settings: {
                          ...node.settings,
                          cardStyle: event.target.value || undefined,
                        },
                      })
                    }
                    placeholder="Exempel: korta svar, betona härledningar och exempel"
                  />
                </div>
              </div>
              <p className="mt-4 px-1 text-xs leading-5 text-slate-500">
                Anki-lekar följer alltid bibliotekets Kurs → Modul →
                Föreläsning-struktur.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 className="size-4 text-slate-400" /> Ärvt context
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {context.map((c) => (
                  <div
                    key={`${c.type}-${c.title}`}
                    className="rounded-lg bg-slate-50 p-2 text-xs"
                  >
                    <div className="font-semibold text-slate-600">
                      {c.title}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-slate-400">
                      {c.context}
                    </div>
                  </div>
                ))}
                {inheritedFiles?.map((file) => {
                  const owner = nodes.find((item) => item.id === file.nodeId);
                  return (
                    <div
                      key={file.id}
                      className="rounded-lg bg-slate-50 p-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </div>
                      <div className="mt-1 text-slate-400">
                        {owner?.title ?? "Överordnat objekt"}
                        {file.extractedText?.trim()
                          ? ` · ${Math.ceil(file.extractedText.length / 4).toLocaleString("sv-SE")} tokens`
                          : " · Ingen text kunde extraheras"}
                      </div>
                    </div>
                  );
                })}
                {!context.length && !inheritedFiles?.length && (
                  <p className="text-xs leading-5 text-slate-400">
                    Ingen context eller bifogad fil har lagts till högre upp.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-violet-600 p-6 text-white">
              <div className="text-sm font-semibold">Modulärt bibliotek</div>
              <p className="mt-2 text-xs leading-5 text-violet-100">
                Varje nivå kan ha egen kontext och egna inställningar som ärvs
                nedåt i kursstrukturen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

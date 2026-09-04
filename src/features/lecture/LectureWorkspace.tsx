import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookText,
  ChevronRight,
  Clock3,
  FileUp,
  Maximize2,
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
import { AudioPanel } from "./AudioPanel";
import { toast } from "sonner";

export function LectureWorkspace({ lectureId }: { lectureId: string }) {
  const {
    nodes,
    lectures,
    segments,
    markers,
    updateNode,
    updateLecture,
    updateSegment,
    updateMarker,
    removeMarker,
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
  const transcriptPane = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (activeSegment)
      transcriptPane.current
        ?.querySelector(`[data-segment="${activeSegment}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegment]);
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
    updateLecture(lectureId, { slideAssetId: id, slideName: file.name });
    toast.success("Slides importerade");
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
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
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
      <main className="ui-app-bg grid min-h-0 flex-1 grid-cols-[minmax(320px,1fr)_minmax(360px,0.9fr)] gap-3 overflow-hidden p-3">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-sm">
          <div className="flex h-11 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700">
              <Maximize2 className="size-4 shrink-0 text-slate-400" />
              <span className="shrink-0">Slides</span>
              {slideAsset?.name && (
                <span
                  className="min-w-0 truncate border-l border-slate-200 pl-2 font-normal text-slate-400"
                  title={slideAsset.name}
                >
                  {slideAsset.name}
                </span>
              )}
            </div>
            <label className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50">
              <FileUp className="mr-1 inline size-3.5" /> Lägg till
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => importSlides(e.target.files?.[0])}
              />
            </label>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-4">
            {slideUrl ? (
              slideAsset?.mimeType === "application/pdf" ? (
                <iframe
                  className="h-full w-full rounded-lg bg-white shadow-sm"
                  src={slideUrl}
                  title="Slides"
                />
              ) : (
                <img
                  src={slideUrl}
                  alt="Slides"
                  className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
                />
              )
            ) : (
              <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 px-14 py-12 text-center hover:border-violet-300 hover:bg-white">
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
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex h-11 items-center justify-between border-b border-slate-100 px-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <MessageSquareText className="size-4 text-slate-400" />{" "}
                Transkript{" "}
                <span className="text-[10px] text-slate-500">
                  {transcript.length}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Plus className="size-3.5" /> Importera text
              </Button>
            </div>
            {transcript.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                <Input
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
                      className={`group flex gap-3 rounded-lg px-2 py-2 transition-colors ${activeSegment === s.id ? "bg-violet-50 ring-1 ring-violet-100" : "hover:bg-slate-50"}`}
                    >
                      <button
                        onClick={() => seek(s.start)}
                        className="mt-0.5 shrink-0 font-mono text-[11px] font-medium text-violet-600"
                      >
                        {formatTime(s.start)}
                      </button>
                      <textarea
                        value={s.text}
                        onChange={(e) => updateSegment(s.id, e.target.value)}
                        rows={Math.max(1, Math.ceil(s.text.length / 65))}
                        className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 text-slate-700 outline-none"
                      />
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
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-4 text-xs font-semibold text-slate-700">
                <BookText className="size-4 text-slate-400" /> Anteckningar
              </div>
              <Textarea
                value={lecture.notes}
                onChange={(e) =>
                  updateLecture(lectureId, { notes: e.target.value })
                }
                placeholder="Skriv korta anteckningar här…"
                className="min-h-0 flex-1 rounded-none border-0 p-4 shadow-none focus:ring-0"
              />
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
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
                    <span className="mt-1 flex items-center gap-1 font-mono text-[10px] font-medium text-amber-600">
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
        <div className="mt-8 grid grid-cols-[1fr_280px] gap-5">
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings2 className="size-4 text-slate-400" /> Ärvt context
              </div>
              <div className="mt-3 space-y-2">
                {context.length ? (
                  context.map((c) => (
                    <div
                      key={c.title}
                      className="rounded-lg bg-slate-50 p-2 text-xs"
                    >
                      <div className="font-semibold text-slate-600">
                        {c.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-slate-400">
                        {c.context}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs leading-5 text-slate-400">
                    Ingen context har lagts till högre upp.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-2xl bg-violet-600 p-5 text-white shadow-sm">
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

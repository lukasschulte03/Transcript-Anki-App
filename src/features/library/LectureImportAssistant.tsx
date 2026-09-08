import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileAudio,
  FileText,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { toast } from "../../services/feedbackToast";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input, Label, Select } from "../../components/ui/Form";
import { db } from "../../core/database";
import { useAppStore } from "../../core/store";
import { confirmStorageForImport, formatTime, uid } from "../../lib/utils";
import { extractPdfPages, formatSlideText } from "../../services/pdf";
import { buildVisualIndex } from "../../services/visualIndex";
import {
  audioFingerprint,
  audioFormat,
  audioMimeType,
  formatAudioBytes,
  measureAudioDuration,
  numberedAudioWarnings,
  sortAudioFiles,
  validateAudioFile,
} from "../../services/audioImport";

function byName(files: File[]) {
  return sortAudioFiles(files);
}

export function LectureImportAssistant({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { nodes, lectures, addNode, updateLecture, selectNode, setActiveView, upsertJob } =
    useAppStore();
  const lectureNodes = nodes.filter((node) => node.type === "lecture");
  const modules = nodes.filter((node) => node.type === "module");
  const [targetId, setTargetId] = useState(lectureNodes[0]?.id ?? "new");
  const [parentId, setParentId] = useState(modules[0]?.id ?? "");
  const [newTitle, setNewTitle] = useState("");
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [slideFile, setSlideFile] = useState<File>();
  const [sort, setSort] = useState<"name" | "date" | "manual">("name");
  const [importing, setImporting] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const importAbort = useRef<AbortController | undefined>(undefined);

  const fileOrder = useMemo(() => {
    if (sort === "manual") return audioFiles;
    if (sort === "date")
      return [...audioFiles].sort(
        (left, right) => left.lastModified - right.lastModified,
      );
    return byName(audioFiles);
  }, [audioFiles, sort]);
  const warnings = useMemo(() => numberedAudioWarnings(fileOrder), [fileOrder]);

  useEffect(() => {
    let active = true;
    void Promise.all(
      audioFiles.map(
        async (file) =>
          [audioFingerprint(file), await measureAudioDuration(file)] as const,
      ),
    ).then((measured) => {
      if (active) setDurations(Object.fromEntries(measured));
    });
    return () => {
      active = false;
    };
  }, [audioFiles]);

  const lectureLabel = (id: string) => {
    const lecture = nodes.find((node) => node.id === id);
    if (!lecture) return "Okänd föreläsning";
    const ancestors: string[] = [lecture.title];
    let current = lecture;
    while (current.parentId) {
      const parent = nodes.find((node) => node.id === current.parentId);
      if (!parent || parent.type === "workspace") break;
      ancestors.unshift(parent.title);
      current = parent;
    }
    return ancestors.join(" › ");
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= audioFiles.length) return;
    const ordered = [...audioFiles];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    setAudioFiles(ordered);
    setSort("manual");
  };

  const importAll = async () => {
    if (!fileOrder.length && !slideFile) {
      toast.error("Välj minst en ljudfil eller en slidefil först");
      return;
    }
    if (targetId === "new" && (!parentId || !newTitle.trim())) {
      toast.error("Välj modul och ange namn på den nya föreläsningen");
      return;
    }
    const audioError = fileOrder.map(validateAudioFile).find(Boolean);
    if (audioError) {
      toast.error(audioError);
      return;
    }
    for (const file of [...fileOrder, ...(slideFile ? [slideFile] : [])]) {
      if (!(await confirmStorageForImport(file, "importen"))) return;
    }
    const controller = new AbortController();
    importAbort.current = controller;
    setImporting(true);
    try {
      const lectureId =
        targetId === "new"
          ? addNode(parentId, "lecture", newTitle.trim())
          : targetId;
      const lecture = lectures[lectureId];
      const existingParts = lecture?.audioParts?.length
        ? lecture.audioParts
        : lecture?.audioAssetId
          ? [
              {
                assetId: lecture.audioAssetId,
                name: lecture.audioName ?? "Ljudinspelning",
                duration: lecture.audioDuration,
              },
            ]
          : [];
      const knownFingerprints = new Set(
        (await db.assets.where("lectureId").equals(lectureId).toArray())
          .map((asset) => asset.sourceFingerprint)
          .filter(Boolean),
      );
      const newParts = [] as {
        assetId: string;
        name: string;
        duration?: number;
        sourceFingerprint?: string;
      }[];
      let wasAborted = false;
      for (const file of fileOrder) {
        if (controller.signal.aborted) {
          wasAborted = true;
          break;
        }
        const sourceFingerprint = audioFingerprint(file);
        if (knownFingerprints.has(sourceFingerprint)) continue;
        const id = uid();
        const duration =
          durations[sourceFingerprint] ?? (await measureAudioDuration(file));
        await db.assets.put({
          id,
          lectureId,
          kind: "audio",
          name: file.name,
          mimeType: audioMimeType(file),
          blob: file,
          sourceFingerprint,
          createdAt: new Date().toISOString(),
        });
        newParts.push({
          assetId: id,
          name: file.name,
          duration,
          sourceFingerprint,
        });
      }
      const audioParts = [...existingParts, ...newParts];
      let visualPages: string[] | undefined;
      const patch: Parameters<typeof updateLecture>[1] = audioParts.length
        ? {
            audioAssetId: audioParts[0].assetId,
            audioName: audioParts[0].name,
            audioParts,
            audioDuration: audioParts.reduce(
              (total, part) => total + (part.duration ?? 0),
              0,
            ),
          }
        : {};
      if (slideFile && !wasAborted) {
        const id = uid();
        await db.assets.put({
          id,
          lectureId,
          kind: "slides",
          name: slideFile.name,
          mimeType: slideFile.type || "application/pdf",
          blob: slideFile,
          createdAt: new Date().toISOString(),
        });
        patch.slideAssetId = id;
        patch.slideName = slideFile.name;
        patch.visualIndex = undefined;
        patch.visualIndexHash = undefined;
        patch.visualIndexUpdatedAt = undefined;
        if (
          slideFile.type === "application/pdf" ||
          slideFile.name.toLowerCase().endsWith(".pdf")
        ) {
          try {
            const pages = await extractPdfPages(slideFile);
            visualPages = pages;
            patch.slidePages = pages;
            patch.slideText = formatSlideText(pages);
          } catch {
            toast.message("Slides importerades utan automatisk textextraktion");
          }
        } else if (slideFile.type.startsWith("image/")) {
          visualPages = [`Bild: ${slideFile.name}`];
        }
      }
      updateLecture(lectureId, patch);
      if (slideFile && visualPages) {
        const jobId = `visual-index:${lectureId}:${patch.slideAssetId}`;
        upsertJob({
          id: jobId,
          kind: "library",
          label: "Indexerar slidebilder",
          phase: "queued",
          status: "queued",
          current: 0,
          total: visualPages.length,
          detail: "Förbereder lokala bildbeskrivningar…",
        });
        const pagesForIndex = visualPages;
        window.setTimeout(() => {
          upsertJob({
            id: jobId,
            kind: "library",
            label: "Indexerar slidebilder",
            phase: "indexing",
            status: "active",
            current: 0,
            total: pagesForIndex.length,
            detail: "Bygger lokala bildbeskrivningar…",
          });
          void buildVisualIndex(slideFile, pagesForIndex)
            .then(({ sourceHash, candidates }) => {
              updateLecture(lectureId, {
                visualIndex: candidates,
                visualIndexHash: sourceHash,
                visualIndexUpdatedAt: new Date().toISOString(),
              });
              upsertJob({
                id: jobId,
                kind: "library",
                label: "Indexerar slidebilder",
                phase: "complete",
                status: "complete",
                current: candidates.length,
                total: pagesForIndex.length,
                detail: `${candidates.length} lokala bildkandidater är klara.`,
              });
            })
            .catch((error) =>
              upsertJob({
                id: jobId,
                kind: "library",
                label: "Indexerar slidebilder",
                phase: "error",
                status: "error",
                current: 0,
                total: pagesForIndex.length,
                detail: String(error),
              }),
            );
        }, 0);
      }
      selectNode(lectureId);
      setActiveView("workspace");
      onOpenChange(false);
      setAudioFiles([]);
      setSlideFile(undefined);
      setNewTitle("");
      if (wasAborted)
        toast.message(
          "Importen avbröts. Sparade ljuddelar finns kvar; välj samma filer igen för att fortsätta.",
        );
      else
        toast.success(
          newParts.length
            ? "Föreläsningen importerades"
            : "Alla valda ljudfiler fanns redan i föreläsningen",
        );
    } catch (error) {
      toast.error(`Importen kunde inte slutföras: ${String(error)}`);
    } finally {
      setImporting(false);
      importAbort.current = undefined;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Importera föreläsning"
      description="Granska mål och filordning innan materialet sparas lokalt."
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Mål</Label>
            <Select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {lectureNodes.map((lecture) => (
                <option key={lecture.id} value={lecture.id}>
                  {lectureLabel(lecture.id)}
                </option>
              ))}
              <option value="new">Skapa ny föreläsning…</option>
            </Select>
          </div>
          {targetId === "new" && (
            <div>
              <Label>Modul</Label>
              <Select
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Välj modul</option>
                {modules.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {targetId === "new" && (
          <div>
            <Label>Föreläsningens namn</Label>
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Exempel: Akut buk"
            />
          </div>
        )}

        <div className="border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Ljuddelar</Label>
              <p className="mt-1 text-xs text-slate-500">
                Behålls separat och spelas som en sammanhängande tidslinje.
              </p>
            </div>
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="h-8 w-36 text-xs"
            >
              <option value="name">Filnamn</option>
              <option value="date">Datum</option>
              <option value="manual">Manuellt</option>
            </Select>
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-4 text-xs font-medium text-slate-600 hover:border-violet-300 hover:bg-violet-50/40">
            <FileAudio className="size-4 text-violet-600" /> Välj en eller flera
            ljudfiler
            <input
              type="file"
              accept="audio/*,.m4a,.aac,.mp3,.wav,.mp4,.mpeg,.webm,.ogg,.opus,.flac"
              multiple
              className="hidden"
              onChange={(event) =>
                setAudioFiles(byName(Array.from(event.target.files ?? [])))
              }
            />
          </label>
          {fileOrder.length > 0 && (
            <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {fileOrder.map((file, index) => (
                <div
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                  key={`${file.name}-${file.lastModified}`}
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-slate-100 text-slate-500">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-slate-400">
                    {audioFormat(file)} · {formatAudioBytes(file.size)} ·{" "}
                    {durations[audioFingerprint(file)]
                      ? formatTime(durations[audioFingerprint(file)])
                      : "läser längd…"}
                  </span>
                  <button
                    type="button"
                    className="disabled:text-slate-300"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Flytta upp"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="disabled:text-slate-300"
                    disabled={index === fileOrder.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Flytta ned"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="mt-3 space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              {warnings.map((warning) => (
                <p key={warning}>
                  <TriangleAlert className="mr-1 inline size-3.5" />
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <Label>Slides (valfritt)</Label>
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs font-medium text-slate-600 hover:border-violet-300 hover:bg-violet-50/40">
            <FileText className="size-4 text-violet-600" />{" "}
            {slideFile?.name ?? "Välj PDF eller bild"}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(event) => setSlideFile(event.target.files?.[0])}
            />
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            importing ? importAbort.current?.abort() : onOpenChange(false)
          }
        >
          {importing ? (
            <>
              <X className="size-4" /> Avbryt import
            </>
          ) : (
            "Avbryt"
          )}
        </Button>
        <Button onClick={() => void importAll()} disabled={importing}>
          {importing ? (
            "Importerar…"
          ) : (
            <>
              <Upload className="size-4" /> Importera
            </>
          )}
        </Button>
      </div>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileAudio, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Input, Label, Select } from "../../components/ui/Form";
import { db } from "../../core/database";
import { useAppStore } from "../../core/store";
import { confirmStorageForImport, uid } from "../../lib/utils";
import { extractPdfPages, formatSlideText } from "../../services/pdf";

function byName(files: File[]) {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, "sv", { numeric: true }),
  );
}

export function LectureImportAssistant({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { nodes, lectures, addNode, updateLecture, selectNode, setActiveView } =
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

  const fileOrder = useMemo(() => {
    if (sort === "manual") return audioFiles;
    if (sort === "date")
      return [...audioFiles].sort(
        (left, right) => left.lastModified - right.lastModified,
      );
    return byName(audioFiles);
  }, [audioFiles, sort]);

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
    for (const file of [...fileOrder, ...(slideFile ? [slideFile] : [])]) {
      if (!(await confirmStorageForImport(file, "importen"))) return;
    }
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
      const newParts = [] as { assetId: string; name: string }[];
      for (const file of fileOrder) {
        const id = uid();
        await db.assets.put({
          id,
          lectureId,
          kind: "audio",
          name: file.name,
          mimeType: file.type || "audio/mpeg",
          blob: file,
          createdAt: new Date().toISOString(),
        });
        newParts.push({ assetId: id, name: file.name });
      }
      const audioParts = [...existingParts, ...newParts];
      const patch: Parameters<typeof updateLecture>[1] = audioParts.length
        ? {
            audioAssetId: audioParts[0].assetId,
            audioName: audioParts[0].name,
            audioParts,
          }
        : {};
      if (slideFile) {
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
        if (
          slideFile.type === "application/pdf" ||
          slideFile.name.toLowerCase().endsWith(".pdf")
        ) {
          try {
            const pages = await extractPdfPages(slideFile);
            patch.slidePages = pages;
            patch.slideText = formatSlideText(pages);
          } catch {
            toast.message("Slides importerades utan automatisk textextraktion");
          }
        }
      }
      updateLecture(lectureId, patch);
      selectNode(lectureId);
      setActiveView("workspace");
      onOpenChange(false);
      setAudioFiles([]);
      setSlideFile(undefined);
      setNewTitle("");
      toast.success("Föreläsningen importerades");
    } catch (error) {
      toast.error(`Importen kunde inte slutföras: ${String(error)}`);
    } finally {
      setImporting(false);
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
              accept="audio/*"
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
                    {Math.round(file.size / 1024 / 1024)} MB
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
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Avbryt
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

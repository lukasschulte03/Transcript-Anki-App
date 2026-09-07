import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  Check,
  CloudDownload,
  FolderPlus,
  Inbox as InboxIcon,
  LoaderCircle,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input, Label, Select } from "../../components/ui/Form";
import { db } from "../../core/database";
import { useAppStore } from "../../core/store";
import { confirmStorageForImport, cn, uid } from "../../lib/utils";
import { toast } from "../../services/feedbackToast";
import {
  downloadGoogleDriveInboxFile,
  listGoogleDriveInbox,
  markGoogleDriveInboxFilesImported,
  type InboxAudioFile,
} from "../../services/googleDriveInbox";

const formatSize = (bytes: number) => {
  if (!bytes) return "Okänd storlek";
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
};

function lecturePath(
  id: string,
  nodes: ReturnType<typeof useAppStore.getState>["nodes"],
) {
  const node = nodes.find((item) => item.id === id);
  if (!node) return "Okänd föreläsning";
  const path = [node.title];
  let current = node;
  while (current.parentId) {
    const parent = nodes.find((item) => item.id === current.parentId);
    if (!parent || parent.type === "workspace") break;
    path.unshift(parent.title);
    current = parent;
  }
  return path.join(" › ");
}

export function DriveInbox() {
  const {
    nodes,
    lectures,
    settings,
    addNode,
    updateLecture,
    selectNode,
    setActiveView,
  } = useAppStore();
  const [files, setFiles] = useState<InboxAudioFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [targetId, setTargetId] = useState("new");
  const [parentId, setParentId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const lecturesInTree = useMemo(
    () => nodes.filter((node) => node.type === "lecture"),
    [nodes],
  );
  const modules = useMemo(
    () => nodes.filter((node) => node.type === "module"),
    [nodes],
  );
  const connected = Boolean(settings.cloudSync.connectedAt);

  const refresh = async () => {
    if (!connected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await listGoogleDriveInbox();
      setFiles(next);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) => next.some((file) => file.id === id)),
          ),
      );
    } catch (error) {
      toast.error(`Kunde inte läsa Google Drive-inkorgen: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Connection state is the only reason this view must refresh automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const importFiles = async () => {
    const chosen = files.filter((file) => selected.has(file.id));
    if (!chosen.length) return toast.error("Välj minst en ljudfil först");
    if (targetId === "new" && (!parentId || !newTitle.trim())) {
      return toast.error(
        "Välj modul och skriv ett namn för den nya föreläsningen",
      );
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
      const parts: { assetId: string; name: string }[] = [];
      for (const file of chosen) {
        const blob = await downloadGoogleDriveInboxFile(file);
        if (!(await confirmStorageForImport(blob, "ljudfilen")))
          throw new Error("Importen avbröts på grund av ledigt utrymme.");
        const assetId = uid();
        await db.assets.put({
          id: assetId,
          lectureId,
          kind: "audio",
          name: file.name,
          mimeType: file.mimeType || blob.type || "audio/mpeg",
          blob,
          createdAt: new Date().toISOString(),
        });
        parts.push({ assetId, name: file.name });
      }
      const audioParts = [...existingParts, ...parts];
      updateLecture(lectureId, {
        audioAssetId: audioParts[0]?.assetId,
        audioName: audioParts[0]?.name,
        audioParts,
      });
      await markGoogleDriveInboxFilesImported(
        chosen.map((file) => file.id),
        lectureId,
      );
      setFiles((current) => current.filter((file) => !selected.has(file.id)));
      setSelected(new Set());
      setNewTitle("");
      selectNode(lectureId);
      setActiveView("workspace");
      toast.success(
        chosen.length === 1
          ? "Ljudfil importerad från Google Drive"
          : `${chosen.length} ljudfiler importerades från Google Drive`,
      );
    } catch (error) {
      toast.error(`Importen kunde inte slutföras: ${String(error)}`);
    } finally {
      setImporting(false);
    }
  };

  if (!connected) {
    return (
      <main className="ui-app-bg min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-[var(--palette-primary-muted)] text-[var(--palette-accent)]">
            <InboxIcon className="size-5" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-[var(--palette-text)]">
            Din Google Drive-inkorg
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--palette-text-muted)]">
            Koppla Google Drive och låt din iPhone-inspelare spara ljudfiler i{" "}
            <strong className="font-medium text-[var(--palette-text)]">
              Lectio/Inbox
            </strong>
            . Här väljer du sedan vilken föreläsning de hör till.
          </p>
          <Button className="mt-5" onClick={() => setActiveView("settings")}>
            <Settings /> Öppna synkinställningar
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="ui-app-bg min-w-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--palette-text)]">
              Inkorg
            </h1>
            <p className="mt-1 text-sm text-[var(--palette-text-muted)]">
              Nya ljudfiler i Google Drive:{" "}
              <span className="font-medium text-[var(--palette-text)]">
                {settings.cloudSync.remotePath.trim() || "Lectio"}/Inbox
              </span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || importing}
          >
            <RefreshCw className={cn(loading && "animate-spin")} /> Uppdatera
          </Button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="overflow-hidden rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--palette-border)] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--palette-text)]">
                <AudioLines className="size-4 text-[var(--palette-accent)]" />{" "}
                Oimporterade ljudfiler
              </div>
              {files.length > 0 && (
                <button
                  className="text-xs font-medium text-[var(--palette-accent)] hover:underline"
                  onClick={() =>
                    setSelected(
                      selected.size === files.length
                        ? new Set()
                        : new Set(files.map((file) => file.id)),
                    )
                  }
                >
                  {selected.size === files.length
                    ? "Avmarkera alla"
                    : "Välj alla"}
                </button>
              )}
            </div>
            {loading ? (
              <div className="grid min-h-52 place-items-center text-sm text-[var(--palette-text-muted)]">
                <LoaderCircle className="mr-2 inline size-4 animate-spin" />{" "}
                Hämtar inkorgen…
              </div>
            ) : files.length === 0 ? (
              <div className="grid min-h-52 place-items-center px-6 text-center">
                <div>
                  <InboxIcon className="mx-auto size-5 text-[var(--palette-text-subtle)]" />
                  <p className="mt-3 text-sm font-medium text-[var(--palette-text)]">
                    Inkorgen är tom
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
                    Nya inspelningar visas här när de har laddats upp till
                    Google Drive.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--palette-border)]">
                {files.map((file) => {
                  const checked = selected.has(file.id);
                  return (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => toggle(file.id)}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--palette-surface-hover)]",
                          checked && "bg-[var(--palette-primary-muted)]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            checked
                              ? "border-[var(--palette-primary)] bg-[var(--palette-primary)] text-[var(--palette-primary-foreground)]"
                              : "border-[var(--palette-border-strong)]",
                          )}
                        >
                          <Check
                            className={cn("size-3", !checked && "invisible")}
                          />
                        </span>
                        <AudioLines className="size-4 shrink-0 text-[var(--palette-text-subtle)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--palette-text)]">
                            {file.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--palette-text-muted)]">
                            {formatSize(file.size)}
                            {file.modifiedTime
                              ? ` · ${new Date(file.modifiedTime).toLocaleDateString("sv-SE")}`
                              : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="h-fit rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--palette-text)]">
              Lägg till i biblioteket
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--palette-text-muted)]">
              {selected.size
                ? `${selected.size} vald${selected.size === 1 ? "" : "a"} fil${selected.size === 1 ? "" : "er"} läggs till i filnamnsordning.`
                : "Välj minst en fil i inkorgen."}
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <Label>Mål</Label>
                <Select
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  <option value="new">Skapa ny föreläsning…</option>
                  {lecturesInTree.map((lecture) => (
                    <option key={lecture.id} value={lecture.id}>
                      {lecturePath(lecture.id, nodes)}
                    </option>
                  ))}
                </Select>
              </div>
              {targetId === "new" && (
                <>
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
                  <div>
                    <Label>Föreläsningens namn</Label>
                    <Input
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      placeholder="Exempel: Akut buk"
                    />
                  </div>
                </>
              )}
              <Button
                className="w-full"
                onClick={() => void importFiles()}
                disabled={!selected.size || importing}
              >
                <CloudDownload className="size-4" />
                {importing
                  ? "Hämtar och importerar…"
                  : targetId === "new"
                    ? "Skapa och importera"
                    : "Importera till föreläsning"}
              </Button>
            </div>
            <div className="mt-4 border-t border-[var(--palette-border)] pt-3 text-xs leading-5 text-[var(--palette-text-subtle)]">
              <FolderPlus className="mr-1 inline size-3.5" /> Efter import
              kopplas ljudet direkt till föreläsningen. Originalfilen ligger
              kvar i{" "}
              <span className="font-medium text-[var(--palette-text-muted)]">
                Inbox
              </span>
              , men visas inte igen i Lectio.
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  AudioLines,
  Check,
  CheckCircle2,
  CloudDownload,
  FolderPlus,
  Inbox as InboxIcon,
  LoaderCircle,
  RefreshCw,
  Settings,
} from "lucide-react";
import type {
  InboxAudioFile,
  InboxImportProgress,
  LectioClient,
  LibraryNode,
} from "../../../application/lectioClient";
import { useLibrary, useSettings } from "../../shared/useLectioClient";
import { NextButton, NextEmptyState, NextSelect } from "../ui/NextPrimitives";
import "./inbox.css";

function formatSize(bytes: number) {
  if (!bytes) return "Okänd storlek";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function nodePath(id: string, nodes: LibraryNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: string[] = [];
  let current = byId.get(id);
  while (current && current.type !== "workspace") {
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.join(" › ");
}

export function InboxView({ client }: { client: LectioClient }) {
  const library = useLibrary(client);
  const settings = useSettings(client);
  const [files, setFiles] = useState<InboxAudioFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [targetId, setTargetId] = useState("new");
  const [parentId, setParentId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [message, setMessage] = useState<
    { tone: "error" | "warning" | "success"; text: string } | undefined
  >();
  const [progress, setProgress] = useState<InboxImportProgress>();
  const connected = Boolean(settings.cloudSync.connectedAt);
  const remotePath = settings.cloudSync.remotePath.trim() || "Lectio";
  const lectures = useMemo(
    () => library.nodes.filter((node) => node.type === "lecture"),
    [library.nodes],
  );
  const modules = useMemo(
    () => library.nodes.filter((node) => node.type === "module"),
    [library.nodes],
  );
  const chosen = useMemo(
    () => files.filter((file) => selected.has(file.id)),
    [files, selected],
  );

  const refresh = async () => {
    if (!connected) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(undefined);
    const result = await client.inbox.list();
    if (result.ok) {
      setFiles(result.value);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) =>
              result.value.some((file) => file.id === id),
            ),
          ),
      );
    } else {
      setMessage({ tone: "error", text: result.error.message });
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // Only a changed connection should trigger an automatic remote request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importFiles = async () => {
    setMessage(undefined);
    if (!chosen.length) {
      setMessage({ tone: "error", text: "Välj minst en ljudfil först." });
      return;
    }
    if (targetId === "new" && (!parentId || !newTitle.trim())) {
      setMessage({
        tone: "error",
        text: "Välj en modul och ge den nya föreläsningen ett namn.",
      });
      return;
    }

    setImporting(true);
    setProgress({ completed: 0, total: chosen.length, detail: "Förbereder…" });
    let createdLectureId: string | undefined;
    try {
      let lectureId = targetId;
      if (targetId === "new") {
        const created = client.library.addNode(
          parentId,
          "lecture",
          newTitle.trim(),
        );
        if (!created.ok) {
          setMessage({ tone: "error", text: created.error.message });
          return;
        }
        lectureId = created.value;
        createdLectureId = lectureId;
      }

      const result = await client.inbox.import(chosen, lectureId, setProgress);
      if (!result.ok) {
        if (createdLectureId) await client.library.removeNode(createdLectureId);
        setMessage({ tone: "error", text: result.error.message });
        return;
      }

      setFiles((current) => current.filter((file) => !selected.has(file.id)));
      setSelected(new Set());
      setNewTitle("");
      setProgress(undefined);
      if (result.value.remoteMoveFailed) {
        setMessage({
          tone: "warning",
          text: "Ljudet är importerat, men kunde inte flyttas till Lectio/media. Det går att synka senare.",
        });
      } else {
        setMessage({
          tone: "success",
          text:
            result.value.imported === 1
              ? "Ljudfilen är tillagd i föreläsningen."
              : `${result.value.imported} ljudfiler är tillagda i föreläsningen.`,
        });
      }
      client.session.selectNode(lectureId);
      client.session.setActiveView("workspace");
    } finally {
      setImporting(false);
    }
  };

  if (!connected) {
    return (
      <div className="inbox-view inbox-view-centered">
        <NextEmptyState
          icon={<InboxIcon />}
          title="Koppla din Google Drive-inkorg"
          description="Lägg inspelningar i Lectio/Inbox från mobilen. Här väljer du sedan vilken föreläsning de hör till."
          action={
            <NextButton
              tone="primary"
              onClick={() => client.session.setActiveView("settings")}
            >
              <Settings />
              Öppna synkinställningar
            </NextButton>
          }
        />
      </div>
    );
  }

  return (
    <div className="inbox-view">
      <header className="inbox-header">
        <div>
          <h1>Inkorg</h1>
          <p>Nya inspelningar från {remotePath}/Inbox</p>
        </div>
        <NextButton
          onClick={() => void refresh()}
          disabled={loading || importing}
        >
          <RefreshCw className={loading ? "inbox-spin" : undefined} />
          Uppdatera
        </NextButton>
      </header>

      {message && (
        <div
          className="inbox-message"
          data-tone={message.tone}
          role={message.tone === "error" ? "alert" : "status"}
          aria-live={message.tone === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {message.tone === "success" ? <CheckCircle2 /> : <AlertTriangle />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="inbox-layout">
        <section className="inbox-files" aria-labelledby="inbox-file-heading">
          <div className="inbox-section-heading">
            <div>
              <h2 id="inbox-file-heading">Ljudfiler</h2>
              <span>{loading ? "Hämtar…" : `${files.length} väntar`}</span>
            </div>
            {files.length > 0 && (
              <button
                type="button"
                className="inbox-select-all"
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
            <div className="inbox-state" role="status" aria-live="polite">
              <LoaderCircle className="inbox-spin" />
              <span>Läser Google Drive…</span>
            </div>
          ) : files.length === 0 ? (
            <NextEmptyState
              className="inbox-empty"
              icon={<InboxIcon />}
              title="Inkorgen är tom"
              description="Nya ljudfiler visas automatiskt när de har laddats upp till Google Drive."
            />
          ) : (
            <ul className="inbox-file-list">
              {files.map((file) => {
                const checked = selected.has(file.id);
                return (
                  <li key={file.id}>
                    <label className="inbox-file" data-selected={checked}>
                      <input
                        type="checkbox"
                        name="inbox-audio-file"
                        checked={checked}
                        onChange={() => toggle(file.id)}
                        disabled={importing}
                      />
                      <span className="inbox-check" aria-hidden="true">
                        <Check />
                      </span>
                      <span className="inbox-file-icon" aria-hidden="true">
                        <AudioLines />
                      </span>
                      <span className="inbox-file-copy">
                        <strong>{file.name}</strong>
                        <span>
                          {formatSize(file.size)}
                          {file.modifiedTime
                            ? ` · ${new Date(file.modifiedTime).toLocaleDateString("sv-SE")}`
                            : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside
          className="inbox-destination"
          aria-labelledby="inbox-target-heading"
        >
          <span className="inbox-destination-icon" aria-hidden="true">
            <FolderPlus />
          </span>
          <div className="inbox-destination-title">
            <h2 id="inbox-target-heading">Lägg till i biblioteket</h2>
            <p>
              {chosen.length
                ? `${chosen.length} ${chosen.length === 1 ? "fil vald" : "filer valda"}`
                : "Välj ljudfiler till vänster"}
            </p>
          </div>

          <label className="inbox-field">
            <span>Mål</span>
            <NextSelect
              className="inbox-select"
              label="Mål"
              value={targetId}
              onChange={setTargetId}
              disabled={importing}
              options={[
                { value: "new", label: "Skapa ny föreläsning" },
                ...lectures.map((lecture) => ({
                  value: lecture.id,
                  label: nodePath(lecture.id, library.nodes),
                })),
              ]}
            />
          </label>

          {targetId === "new" && (
            <div className="inbox-new-lecture">
              <label className="inbox-field">
                <span>Modul</span>
                <NextSelect
                  className="inbox-select"
                  label="Modul"
                  value={parentId}
                  onChange={setParentId}
                  disabled={importing}
                  options={[
                    { value: "", label: "Välj modul" },
                    ...modules.map((module) => ({
                      value: module.id,
                      label: nodePath(module.id, library.nodes),
                    })),
                  ]}
                />
              </label>
              <label className="inbox-field">
                <span>Namn</span>
                <input
                  name="inbox-lecture-title"
                  autoComplete="off"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Exempel: Akut buk"
                  disabled={importing}
                />
              </label>
            </div>
          )}

          {importing && progress && (
            <div
              className="inbox-progress"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div>
                <span>{progress.detail}</span>
                <strong>
                  {progress.completed}/{progress.total}
                </strong>
              </div>
              <progress value={progress.completed} max={progress.total} />
            </div>
          )}

          <NextButton
            className="inbox-import-button"
            tone="primary"
            onClick={() => void importFiles()}
            disabled={!chosen.length || importing}
          >
            {importing ? (
              <LoaderCircle className="inbox-spin" />
            ) : (
              <CloudDownload />
            )}
            {importing
              ? "Importerar…"
              : targetId === "new"
                ? "Skapa och importera"
                : "Importera till föreläsning"}
          </NextButton>

          <p className="inbox-footnote">
            Efter import kopplas ljudet till föreläsningen och flyttas till
            {` ${remotePath}/media`}.
          </p>
        </aside>
      </div>
    </div>
  );
}

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  FileText,
  Headphones,
  Layers,
  LoaderCircle,
  MessageSquareText,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LectioClient,
  TranscriptSegment,
} from "../../../application/lectioClient";
import { useJobs, useLibrary } from "../../shared/useLectioClient";
import { LectureAudio } from "./LectureAudio";
import { LecturePdf } from "./LecturePdf";
import { lectureCopy as c, formatTime } from "./lectureCopy";
import "./lecture.css";

function TranscriptRow({
  segment,
  client,
  onSeek,
  query,
}: {
  segment: TranscriptSegment;
  client: LectioClient;
  onSeek(time: number): void;
  query: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment.text);
  const pieces = query
    ? segment.text.split(
        new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
      )
    : [segment.text];
  return (
    <article className="lecture-transcript-row">
      <button
        className="lecture-timestamp"
        onClick={() => onSeek(segment.start)}
        aria-label={`Spela från ${formatTime(segment.start)}`}
      >
        {formatTime(segment.start)}
      </button>
      {editing ? (
        <textarea
          aria-label={`Redigera avsnitt ${formatTime(segment.start)}`}
          autoFocus
          value={text}
          rows={4}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            client.transcript.updateSegment(segment.id, text);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setText(segment.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className="lecture-transcript-text"
          title="Klicka för att redigera"
          onClick={() => {
            setText(segment.text);
            setEditing(true);
          }}
        >
          {pieces.map((piece, index) =>
            query && piece.toLocaleLowerCase() === query.toLocaleLowerCase() ? (
              <mark key={index}>{piece}</mark>
            ) : (
              piece
            ),
          )}
        </button>
      )}
    </article>
  );
}

export function LectureView({
  client,
  lectureId,
  onBusyChange,
}: {
  client: LectioClient;
  lectureId: string;
  onBusyChange(value: boolean): void;
}) {
  const library = useLibrary(client);
  const jobs = useJobs(client);
  const node = library.nodes.find((item) => item.id === lectureId)!;
  const lecture = library.lectures[lectureId] ?? { lectureId, notes: "" };
  const segments = useMemo(
    () =>
      library.segments
        .filter((item) => item.lectureId === lectureId)
        .sort((a, b) => a.start - b.start),
    [library.segments, lectureId],
  );
  const markers = library.markers
    .filter((item) => item.lectureId === lectureId)
    .sort((a, b) => a.time - b.time);
  const cards = library.cards.filter((item) => item.lectureId === lectureId);
  const [tab, setTab] = useState("transcript");
  const [mobilePanel, setMobilePanel] = useState("slides");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Set<string> | null>(null);
  const [limit, setLimit] = useState(80);
  const [notes, setNotes] = useState(lecture.notes);
  const [noteStatus, setNoteStatus] = useState(c.saved as string);
  const [confirm, setConfirm] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [seek, setSeek] = useState({ time: 0, serial: 0 });
  const position = useRef(0);
  const updatePosition = useCallback((time: number) => {
    position.current = time;
  }, []);
  const pdfInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const pendingNotes = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const setOccupied = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange(value);
    },
    [onBusyChange],
  );
  const saveNotes = useCallback(() => {
    if (pendingNotes.current === null) return;
    const result = client.library.updateLecture(lectureId, {
      notes: pendingNotes.current,
    });
    if (result.ok) {
      pendingNotes.current = null;
      setNoteStatus(c.saved);
    } else setError(result.error.message);
  }, [client, lectureId]);
  useEffect(() => {
    const timer = setTimeout(saveNotes, 600);
    return () => clearTimeout(timer);
  }, [notes, saveNotes]);
  useEffect(
    () => () => {
      saveNotes();
      onBusyChange(false);
    },
    [saveNotes, onBusyChange],
  );
  const ancestry: typeof library.nodes = [];
  let parent = library.nodes.find((item) => item.id === node.parentId);
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.type !== "workspace") ancestry.unshift(parent);
    parent = library.nodes.find((item) => item.id === parent!.parentId);
  }
  const filtered = matches
    ? segments.filter((item) => matches.has(item.id))
    : segments;
  const hasAudio = Boolean(lecture.audioAssetId || lecture.audioParts?.length);
  const running = jobs.filter(
    (job) =>
      job.kind === "transcription" &&
      (job.status === "active" || job.status === "queued"),
  );

  const importFiles = async (files: File[]) => {
    if (busy || !files.length) return;
    setOccupied(true);
    setImporting(true);
    setError("");
    setNotice("");
    try {
      for (const file of files) {
        const pdf = file.name.toLowerCase().endsWith(".pdf");
        const result = await client.assets[
          pdf ? "importSlides" : "importAudio"
        ](lectureId, {
          name: file.name,
          mimeType: pdf ? "application/pdf" : file.type,
          bytes: await file.arrayBuffer(),
          lastModified: file.lastModified,
        });
        if (!result.ok) throw new Error(result.error.message);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : c.importFailed);
    } finally {
      setOccupied(false);
      setImporting(false);
    }
  };
  const transcribe = async (overwrite = false) => {
    if (segments.length && !overwrite) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    setError("");
    const result = await client.workflows.enqueue(
      "transcribe",
      [lectureId],
      overwrite,
    );
    if (result.ok) setNotice(c.queued);
    else setError(result.error.message);
  };
  const jump = (time: number) =>
    setSeek((previous) => ({ time, serial: previous.serial + 1 }));

  return (
    <div
      className="lecture-view"
      data-mobile-panel={mobilePanel}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Välj PDF"
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac"
        hidden
        multiple
        aria-label="Välj ljudfiler"
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <header className="lecture-heading">
        <div className="lecture-heading-copy">
          <nav className="lecture-breadcrumb" aria-label="Sökväg">
            {ancestry.map((item) => (
              <span key={item.id}>
                <button
                  disabled={busy}
                  onClick={() => {
                    saveNotes();
                    client.session.selectNode(item.id);
                  }}
                >
                  {item.title}
                </button>
                <ChevronRight />
              </span>
            ))}
          </nav>
          <h1 title={node.title}>{node.title}</h1>
          <div className="lecture-meta">
            <span>{node.type === "topic" ? "Ämne" : "Föreläsning"}</span>
            {lecture.slideAssetId && (
              <span>
                <FileText />
                {lecture.slidePages?.length
                  ? `${lecture.slidePages.length} slides`
                  : c.slides}
              </span>
            )}
            {hasAudio && (
              <span>
                <Headphones />
                {lecture.audioDuration
                  ? formatTime(lecture.audioDuration)
                  : "Ljud"}
              </span>
            )}
          </div>
        </div>
        <button
          className="lecture-action lecture-card-action"
          onClick={() => setCardsOpen(true)}
        >
          <Layers />
          {c.cards}
          {cards.length > 0 && (
            <span className="lecture-count">{cards.length}</span>
          )}
          <ArrowUpRight />
        </button>
      </header>
      <div
        className="lecture-compact-tabs"
        role="group"
        aria-label="Visa material eller anteckningar"
      >
        {[
          ["slides", c.slides, FileText],
          ["text", "Transkript & anteckningar", MessageSquareText],
        ].map(([id, label, Icon]) => {
          const TabIcon = Icon as typeof FileText;
          return (
            <button
              key={id as string}
              aria-pressed={mobilePanel === id}
              onClick={() => setMobilePanel(id as string)}
            >
              <TabIcon />
              {label as string}
            </button>
          );
        })}
      </div>
      <div className="lecture-workspace">
        <LecturePdf
          client={client}
          assetId={lecture.slideAssetId}
          name={lecture.slideName}
          busy={busy}
          onImport={() => pdfInput.current?.click()}
        />
        <Tabs.Root
          className="lecture-text-pane"
          value={tab}
          onValueChange={setTab}
        >
          <Tabs.List
            className="lecture-text-tabs"
            aria-label="Föreläsningsmaterial"
          >
            {[
              ["transcript", c.transcript, MessageSquareText],
              ["notes", c.notes, StickyNote],
              ["markers", c.markers, Bookmark],
            ].map(([id, label, Icon]) => {
              const TabIcon = Icon as typeof FileText;
              return (
                <Tabs.Trigger
                  key={id as string}
                  value={id as string}
                  title={label as string}
                >
                  <TabIcon />
                  <span>{label as string}</span>
                  {id === "markers" && markers.length > 0 && (
                    <small>{markers.length}</small>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
          <Tabs.Content value="transcript" className="lecture-text-content">
            <div className="lecture-transcript-tools">
              <label className="lecture-search">
                <Search />
                <input
                  type="search"
                  aria-label={c.search}
                  placeholder={c.search}
                  value={query}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery(value);
                    setLimit(80);
                    setMatches(
                      value.trim()
                        ? new Set(
                            segments
                              .filter((item) =>
                                item.text
                                  .toLocaleLowerCase()
                                  .includes(value.trim().toLocaleLowerCase()),
                              )
                              .map((item) => item.id),
                          )
                        : null,
                    );
                  }}
                />
              </label>
              <button
                className="lecture-icon"
                aria-label={c.transcribe}
                title={c.transcribe}
                disabled={!hasAudio || busy || running.length > 0}
                onClick={() => void transcribe()}
              >
                <Sparkles />
              </button>
            </div>
            {running.length > 0 && (
              <div className="lecture-inline-progress" role="status">
                <LoaderCircle className="lecture-spin" />
                <span>
                  {running[0].label}
                  {running[0].total
                    ? ` · ${running[0].current}/${running[0].total}`
                    : ""}
                </span>
              </div>
            )}
            <div className="lecture-transcript-scroll">
              {!segments.length ? (
                <div className="lecture-empty">
                  <MessageSquareText />
                  <h2>{c.transcriptEmpty}</h2>
                  <p>{c.transcriptHint}</p>
                  <button
                    className="lecture-action"
                    disabled={!hasAudio || busy || running.length > 0}
                    onClick={() => void transcribe()}
                  >
                    <Sparkles />
                    {c.transcribe}
                  </button>
                </div>
              ) : !filtered.length ? (
                <p className="lecture-no-results">{c.noResults}</p>
              ) : (
                <>
                  {filtered.slice(0, limit).map((segment) => (
                    <TranscriptRow
                      key={segment.id}
                      segment={segment}
                      client={client}
                      onSeek={jump}
                      query={query.trim()}
                    />
                  ))}
                  {filtered.length > limit && (
                    <button
                      className="lecture-action lecture-load-more"
                      onClick={() => setLimit((value) => value + 80)}
                    >
                      {c.more} ({filtered.length - limit})
                    </button>
                  )}
                </>
              )}
            </div>
          </Tabs.Content>
          <Tabs.Content value="notes" className="lecture-text-content">
            <div className="lecture-note-status" aria-live="polite">
              <Check />
              {noteStatus}
            </div>
            <textarea
              className="lecture-notes"
              aria-label={c.notes}
              placeholder={c.notesPlaceholder}
              value={notes}
              onBlur={saveNotes}
              onChange={(event) => {
                setNotes(event.target.value);
                pendingNotes.current = event.target.value;
                setNoteStatus(c.savePending);
              }}
            />
          </Tabs.Content>
          <Tabs.Content value="markers" className="lecture-text-content">
            <div className="lecture-marker-toolbar">
              <button
                className="lecture-action"
                disabled={!hasAudio}
                onClick={() => {
                  client.markers.add({
                    lectureId,
                    time: position.current,
                    note: "",
                  });
                }}
              >
                <Bookmark />
                {c.addMarker}
              </button>
            </div>
            <div className="lecture-transcript-scroll">
              {!markers.length ? (
                <div className="lecture-empty">
                  <Bookmark />
                  <h2>{c.markersEmpty}</h2>
                  <p>{c.markerHint}</p>
                </div>
              ) : (
                markers.map((marker) => (
                  <div className="lecture-marker" key={marker.id}>
                    <button
                      className="lecture-timestamp"
                      onClick={() => jump(marker.time)}
                    >
                      {formatTime(marker.time)}
                    </button>
                    <input
                      aria-label={`Anteckning vid ${formatTime(marker.time)}`}
                      defaultValue={marker.note}
                      placeholder="Vad vill du komma ihåg?"
                      onBlur={(event) =>
                        client.markers.update(marker.id, event.target.value)
                      }
                    />
                    <button
                      className="lecture-icon"
                      aria-label={c.removeMarker}
                      onClick={() => client.markers.remove(marker.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))
              )}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
      <LectureAudio
        client={client}
        lecture={lecture}
        busy={busy}
        onPosition={updatePosition}
        seek={seek}
        onImport={() => audioInput.current?.click()}
        onBusy={setOccupied}
        onError={setError}
      />
      {(error || notice || importing) && (
        <div
          className={`lecture-notice ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {importing ? (
            <LoaderCircle className="lecture-spin" />
          ) : error ? (
            <X />
          ) : (
            <Check />
          )}
          <span>{error || (importing ? c.loading : notice)}</span>
          {!importing && (
            <button
              className="lecture-icon"
              aria-label={c.close}
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X />
            </button>
          )}
        </div>
      )}
      {dragging && (
        <div className="lecture-drop-overlay">
          <FileText />
          <span>Släpp PDF eller ljud här</span>
        </div>
      )}
      <Dialog.Root open={confirm} onOpenChange={setConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-confirm">
            <Dialog.Title>{c.replaceTranscript}</Dialog.Title>
            <Dialog.Description>{c.alreadyTranscribed}</Dialog.Description>
            <div className="lecture-dialog-actions">
              <Dialog.Close className="lecture-action">{c.cancel}</Dialog.Close>
              <button
                className="lecture-action"
                onClick={() => void transcribe(true)}
              >
                {c.replaceTranscript}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={cardsOpen} onOpenChange={setCardsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-cards">
            <header>
              <div>
                <Dialog.Title>{c.cards}</Dialog.Title>
                <Dialog.Description>{node.title}</Dialog.Description>
              </div>
              <Dialog.Close className="lecture-icon" aria-label={c.close}>
                <X />
              </Dialog.Close>
            </header>
            <div className="lecture-card-list">
              {cards.length ? (
                cards.map((card, index) => (
                  <article className="lecture-review-card" key={card.id}>
                    <span className="lecture-card-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p>{card.front}</p>
                      <p className="lecture-muted">{card.back}</p>
                    </div>
                    <button
                      className="lecture-action"
                      disabled={card.status !== "generated"}
                      onClick={() => client.cards.approve([card.id])}
                    >
                      <Check />
                      {card.status === "generated"
                        ? c.approve
                        : card.status === "synced"
                          ? c.synced
                          : c.approved}
                    </button>
                  </article>
                ))
              ) : (
                <div className="lecture-empty">
                  <Layers />
                  <h2>{c.cardsEmpty}</h2>
                  <p>{c.cardsHint}</p>
                </div>
              )}
            </div>
            <footer>
              <span>{cards.length} kort</span>
              <button
                className="lecture-action"
                disabled={!cards.some((card) => card.status === "generated")}
                onClick={() =>
                  client.cards.approve(
                    cards
                      .filter((card) => card.status === "generated")
                      .map((card) => card.id),
                  )
                }
              >
                <Check />
                {c.approveAll}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

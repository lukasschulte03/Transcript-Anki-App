import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowUpRight,
  AudioLines,
  Bookmark,
  Check,
  ChevronRight,
  FileText,
  Headphones,
  Image as ImageIcon,
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
  VisualCandidate,
} from "../../../application/lectioClient";
import { useJobs, useLibrary, useSettings } from "../../shared/useLectioClient";
import { LectureAudio } from "./LectureAudio";
import { LecturePdf } from "./LecturePdf";
import { lectureCopy as c, formatTime } from "./lectureCopy";
import { isKeyboardShortcutBlocked } from "../keyboardShortcuts";
import "./lecture.css";

function VisualPreview({
  client,
  lectureId,
  visual,
  onRemove,
}: {
  client: LectioClient;
  lectureId: string;
  visual: VisualCandidate;
  onRemove(): void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let disposed = false;
    let objectUrl = "";
    void client.visuals.thumbnail(lectureId, visual.id).then((result) => {
      if (!disposed && result.ok) {
        objectUrl = URL.createObjectURL(result.value);
        setUrl(objectUrl);
      }
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, lectureId, visual.id]);
  return (
    <article className="lecture-visual-card">
      {url ? (
        <img
          src={url}
          alt={visual.description || `Bild från slide ${visual.slidePage}`}
        />
      ) : (
        <div className="lecture-visual-placeholder">
          <LoaderCircle className="lecture-spin" />
        </div>
      )}
      <div>
        <strong>Slide {visual.slidePage}</strong>
        <p>
          {visual.visualAnalysis?.description ||
            visual.localVision?.description ||
            visual.cropText ||
            visual.description ||
            "Ingen beskrivning ännu."}
        </p>
        {visual.visualAnalysis?.extractedText && (
          <p>OCR: {visual.visualAnalysis.extractedText}</p>
        )}
      </div>
      <button
        className="lecture-icon"
        aria-label="Radera bild"
        onClick={onRemove}
      >
        <Trash2 />
      </button>
    </article>
  );
}

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
    <article
      id={`lecture-transcript-${segment.id}`}
      className="lecture-transcript-row"
      data-segment-id={segment.id}
    >
      <button
        className="lecture-timestamp"
        onClick={() => onSeek(segment.start)}
        aria-label={`Spela från ${formatTime(segment.start)}`}
      >
        {formatTime(segment.start)}
      </button>
      {editing ? (
        <textarea
          name={`transcript-segment-${segment.id}`}
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
  const settings = useSettings(client);
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
  const slideCount = lecture.slidePages
    ? lecture.slidePages.length +
      Object.values(lecture.slidePageSplits ?? {}).reduce(
        (total, regions) => total + Math.max(0, regions.length - 1),
        0,
      )
    : 0;
  const [tab, setTab] = useState("transcript");
  const [mobilePanel, setMobilePanel] = useState("slides");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [followTranscript, setFollowTranscript] = useState(true);
  const [matches, setMatches] = useState<Set<string> | null>(null);
  const [limit, setLimit] = useState(80);
  const [notes, setNotes] = useState(lecture.notes);
  const [noteStatus, setNoteStatus] = useState(c.saved as string);
  const [confirm, setConfirm] = useState(false);
  const [markerToRemove, setMarkerToRemove] = useState<string | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [cancellingJob, setCancellingJob] = useState(false);
  const [syncingCards, setSyncingCards] = useState(false);
  const [generatingCards, setGeneratingCards] = useState(false);
  const [cardDeleteTarget, setCardDeleteTarget] = useState<
    "all" | string | null
  >(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [lectureJobIds, setLectureJobIds] = useState<string[]>([]);
  const [seek, setSeek] = useState({ time: 0, serial: 0 });
  const filtered = useMemo(
    () =>
      matches ? segments.filter((item) => matches.has(item.id)) : segments,
    [matches, segments],
  );
  const hasAudio = Boolean(lecture.audioAssetId || lecture.audioParts?.length);
  const running = jobs.filter(
    (job) =>
      job.kind === "transcription" &&
      (job.status === "active" || job.status === "queued") &&
      lectureJobIds.includes(job.id),
  );
  const imageJob = jobs.find(
    (job) =>
      (job.id === `visual-index:${lectureId}` ||
        job.id === `visual-describe:${lectureId}`) &&
      (job.status === "active" || job.status === "queued"),
  );
  const indexingImages = Boolean(imageJob);
  const position = useRef(0);
  const segmentsRef = useRef(segments);
  const filteredRef = useRef(filtered);
  const limitRef = useRef(limit);
  const activeSegmentId = useRef<string | null>(null);
  const activeTranscriptRow = useRef<HTMLElement | null>(null);
  const transcriptScroll = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  segmentsRef.current = segments;
  filteredRef.current = filtered;
  limitRef.current = limit;
  const syncActiveTranscriptRow = useCallback(() => {
    const candidateRow = activeSegmentId.current
      ? document.getElementById(`lecture-transcript-${activeSegmentId.current}`)
      : null;
    const nextRow =
      candidateRow && transcriptScroll.current?.contains(candidateRow)
        ? candidateRow
        : null;
    if (activeTranscriptRow.current !== nextRow) {
      activeTranscriptRow.current?.removeAttribute("data-audio-active");
      activeTranscriptRow.current = nextRow;
    }
    nextRow?.setAttribute("data-audio-active", "true");
  }, []);
  const centerActiveTranscriptRow = useCallback(() => {
    if (!followTranscriptRef.current) return;
    requestAnimationFrame(() => {
      const container = transcriptScroll.current;
      const row = activeSegmentId.current
        ? document.getElementById(
            `lecture-transcript-${activeSegmentId.current}`,
          )
        : null;
      if (!container || !row || !container.contains(row)) return;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const centeredTop =
        container.scrollTop +
        rowRect.top -
        containerRect.top -
        (container.clientHeight - rowRect.height) / 2;
      const maxTop = container.scrollHeight - container.clientHeight;
      container.scrollTo({
        top: Math.max(0, Math.min(maxTop, centeredTop)),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  }, []);
  const pauseTranscriptFollow = useCallback(() => {
    const container = transcriptScroll.current;
    if (
      !followTranscriptRef.current ||
      !container ||
      container.scrollHeight <= container.clientHeight + 2
    ) {
      return;
    }
    followTranscriptRef.current = false;
    setFollowTranscript(false);
  }, []);
  const resumeTranscriptFollow = useCallback(() => {
    followTranscriptRef.current = true;
    setFollowTranscript(true);
    centerActiveTranscriptRow();
  }, [centerActiveTranscriptRow]);
  const updatePosition = useCallback(
    (time: number) => {
      position.current = time;
      const source = segmentsRef.current;
      let low = 0;
      let high = source.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (source[middle].start <= time) low = middle + 1;
        else high = middle;
      }
      const candidate = source[low - 1];
      const nextId = candidate && time <= candidate.end ? candidate.id : null;
      if (activeSegmentId.current === nextId) return;

      activeSegmentId.current = nextId;
      syncActiveTranscriptRow();
      if (!nextId) return;
      centerActiveTranscriptRow();

      const visibleIndex = filteredRef.current.findIndex(
        (segment) => segment.id === nextId,
      );
      if (visibleIndex >= limitRef.current) {
        const nextLimit = Math.min(
          filteredRef.current.length,
          Math.ceil((visibleIndex + 1) / 80) * 80,
        );
        limitRef.current = nextLimit;
        setLimit(nextLimit);
      }
    },
    [centerActiveTranscriptRow, syncActiveTranscriptRow],
  );
  useEffect(() => {
    syncActiveTranscriptRow();
    centerActiveTranscriptRow();
  }, [
    centerActiveTranscriptRow,
    filtered,
    limit,
    segments,
    syncActiveTranscriptRow,
    tab,
  ]);
  const pdfInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const transcriptSearchRef = useRef<HTMLInputElement>(null);
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
  }, [client, lectureId, setError]);
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
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      const hasCommand = event.ctrlKey || event.metaKey;
      if (isKeyboardShortcutBlocked(event, hasCommand && key === "f")) return;

      if (hasCommand && key === "f") {
        event.preventDefault();
        setTab("transcript");
        requestAnimationFrame(() => transcriptSearchRef.current?.focus());
      } else if (hasCommand && event.key === "Enter") {
        event.preventDefault();
        setCardsOpen(true);
      } else if (!hasCommand && event.shiftKey && key === "t") {
        event.preventDefault();
        setTab("transcript");
        requestAnimationFrame(() => transcriptSearchRef.current?.focus());
      } else if (!hasCommand && event.shiftKey && key === "i") {
        event.preventDefault();
        audioInput.current?.click();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  if (!node) {
    return (
      <div className="lecture-missing" role="alert">
        <FileText />
        <h1>Föreläsningen kunde inte öppnas</h1>
        <p>
          Objektet finns inte längre i biblioteket. Välj en annan föreläsning.
        </p>
      </div>
    );
  }
  const ancestry: typeof library.nodes = [];
  let parent = library.nodes.find((item) => item.id === node.parentId);
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.type !== "workspace") ancestry.unshift(parent);
    parent = library.nodes.find((item) => item.id === parent!.parentId);
  }
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
    if (result.ok) {
      setLectureJobIds((current) => [
        ...new Set([...current, ...result.value]),
      ]);
      setNotice(c.queued);
    } else setError(result.error.message);
  };
  const cancelTranscription = async () => {
    const job = running[0];
    if (!job || cancellingJob) return;
    setCancellingJob(true);
    setError("");
    const result = await client.jobs.cancel(job.id);
    if (result.ok) setNotice("Transkriberingen avbryts…");
    else setError(result.error.message);
    setCancellingJob(false);
  };
  const approveCards = (ids: string[]) => {
    const result = client.cards.approve(ids);
    if (result.ok) setNotice(`${result.value} kort godkändes.`);
    else setError(result.error.message);
  };
  const syncApprovedCards = async () => {
    if (syncingCards) return;
    setSyncingCards(true);
    setError("");
    const result = await client.workflows.enqueue("sync", [lectureId]);
    if (result.ok) setNotice("Godkända kort har lagts i synkkön.");
    else setError(result.error.message);
    setSyncingCards(false);
  };
  const generateCards = async () => {
    if (generatingCards) return;
    if (cards.length) {
      const backup = await client.workflows.createBackup();
      if (!backup.ok) return setError(backup.error.message);
    }
    setGeneratingCards(true);
    const result = await client.workflows.enqueue(
      "generate",
      [lectureId],
      cards.length > 0,
    );
    if (result.ok) setNotice("Kortgenereringen har lagts i kön.");
    else setError(result.error.message);
    setGeneratingCards(false);
  };
  const extractImages = async () => {
    if (indexingImages) return;
    setImagesOpen(false);
    const result = await client.visuals.indexLecture(lectureId);
    if (!result.ok) setError(result.error.message);
    else setNotice(`${result.value} slidebilder hittades.`);
  };
  const describeImages = async () => {
    if (indexingImages) return;
    setImagesOpen(false);
    const result = await client.visuals.describeLecture(lectureId);
    if (!result.ok) setError(result.error.message);
    else setNotice(`${result.value} bildutklipp analyserades.`);
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
        name="lecture-slides"
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
        name="lecture-audio"
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
                {slideCount ? `${slideCount} slides` : c.slides}
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
          aria-label={`Öppna Anki-kort för ${node.title}`}
          onClick={() => setCardsOpen(true)}
        >
          <Layers />
          Anki-kort
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
          slidePageSplits={lecture.slidePageSplits}
          busy={busy}
          onImport={() => pdfInput.current?.click()}
          onSplitPagesChange={(sourcePages, regions) => {
            const next: NonNullable<typeof lecture.slidePageSplits> = {};
            for (const sourcePage of sourcePages) {
              if (regions) next[sourcePage] = regions;
            }
            const result = client.library.updateLecture(lectureId, {
              slidePageSplits: Object.keys(next).length ? next : undefined,
            });
            if (!result.ok) setError(result.error.message);
            else
              setNotice(
                regions
                  ? "Samma uppdelning har använts på alla PDF-sidor."
                  : "Uppdelningen har återställts på alla PDF-sidor.",
              );
            return result.ok;
          }}
          onImages={() => setImagesOpen(true)}
          imageCount={lecture.visualIndex?.length ?? 0}
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
                  ref={transcriptSearchRef}
                  type="search"
                  name="transcript-search"
                  autoComplete="off"
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
              <div
                className="lecture-inline-progress"
                role="status"
                aria-live="polite"
                aria-label="Transkribering pågår"
              >
                <LoaderCircle className="lecture-spin" />
                <span>
                  {running[0].label}
                  {running[0].total
                    ? ` · ${running[0].current}/${running[0].total}`
                    : ""}
                </span>
                <button
                  className="lecture-action lecture-cancel-job"
                  disabled={cancellingJob}
                  onClick={() => void cancelTranscription()}
                >
                  <X />
                  {cancellingJob ? "Avbryter…" : "Avbryt"}
                </button>
              </div>
            )}
            <div
              className="lecture-transcript-scroll"
              ref={transcriptScroll}
              onWheel={pauseTranscriptFollow}
              onTouchStart={pauseTranscriptFollow}
              onPointerDown={(event) => {
                const element = event.currentTarget;
                const scrollbarWidth =
                  element.offsetWidth - element.clientWidth;
                const bounds = element.getBoundingClientRect();
                if (
                  scrollbarWidth > 0 &&
                  event.clientX >= bounds.right - scrollbarWidth
                ) {
                  pauseTranscriptFollow();
                }
              }}
            >
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
            {!followTranscript && activeSegmentId.current && (
              <button
                className="lecture-action lecture-follow-transcript"
                aria-label="Återuppta följning av transkriptet"
                onClick={resumeTranscriptFollow}
              >
                <AudioLines aria-hidden="true" />
                Återuppta
              </button>
            )}
          </Tabs.Content>
          <Tabs.Content value="notes" className="lecture-text-content">
            <div className="lecture-note-status" aria-live="polite">
              <Check />
              {noteStatus}
            </div>
            <textarea
              className="lecture-notes"
              name="lecture-notes"
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
                      aria-label={`Spela från markeringen ${formatTime(marker.time)}`}
                      onClick={() => jump(marker.time)}
                    >
                      {formatTime(marker.time)}
                    </button>
                    <input
                      name={`marker-note-${marker.id}`}
                      autoComplete="off"
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
                      onClick={() => setMarkerToRemove(marker.id)}
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
        onMark={() => {
          if (!hasAudio) return;
          const result = client.markers.add({
            lectureId,
            time: position.current,
            note: "",
          });
          if (!result.ok) setError(result.error.message);
          else
            setNotice(
              `Ögonblick markerat vid ${formatTime(position.current)}.`,
            );
        }}
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
      <Dialog.Root
        open={markerToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMarkerToRemove(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-confirm">
            <Dialog.Title>Ta bort markeringen?</Dialog.Title>
            <Dialog.Description>
              Anteckningen och tidspositionen tas bort permanent.
            </Dialog.Description>
            <div className="lecture-dialog-actions">
              <Dialog.Close className="lecture-action">Behåll</Dialog.Close>
              <button
                className="lecture-action lecture-danger-action"
                onClick={() => {
                  if (!markerToRemove) return;
                  const result = client.markers.remove(markerToRemove);
                  if (!result.ok) setError(result.error.message);
                  else setNotice("Markeringen togs bort.");
                  setMarkerToRemove(null);
                }}
              >
                <Trash2 />
                Ta bort
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
                <Dialog.Title>Anki-kort</Dialog.Title>
                <Dialog.Description>
                  {node.title} · Skapa, granska, godkänn, radera och synka kort.
                </Dialog.Description>
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
                      onClick={() => approveCards([card.id])}
                    >
                      <Check />
                      {card.status === "generated"
                        ? c.approve
                        : card.status === "synced"
                          ? c.synced
                          : c.approved}
                    </button>
                    <button
                      className="lecture-icon"
                      aria-label="Radera kort"
                      onClick={() => setCardDeleteTarget(card.id)}
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))
              ) : (
                <div className="lecture-empty">
                  <Layers />
                  <h2>{c.cardsEmpty}</h2>
                  <p>
                    Skapa kort direkt för den här föreläsningen. Dina sparade
                    inställningar för Anki-generering används automatiskt.
                  </p>
                </div>
              )}
            </div>
            <footer>
              <span aria-live="polite">
                {cards.length} kort ·{" "}
                {cards.filter((card) => card.status === "generated").length} att
                granska ·{" "}
                {cards.filter((card) => card.status === "approved").length}{" "}
                godkända
              </span>
              <div className="lecture-card-footer-actions">
                <button
                  className="lecture-action"
                  disabled={generatingCards}
                  onClick={() => void generateCards()}
                >
                  {generatingCards ? (
                    <LoaderCircle className="lecture-spin" />
                  ) : (
                    <Sparkles />
                  )}
                  {cards.length ? "Generera på nytt" : "Generera kort"}
                </button>
                {cards.length > 0 && (
                  <button
                    className="lecture-action"
                    onClick={() => setCardDeleteTarget("all")}
                  >
                    <Trash2 /> Radera alla
                  </button>
                )}
                <button
                  className="lecture-action"
                  disabled={!cards.some((card) => card.status === "generated")}
                  onClick={() =>
                    approveCards(
                      cards
                        .filter((card) => card.status === "generated")
                        .map((card) => card.id),
                    )
                  }
                >
                  <Check />
                  {c.approveAll}
                </button>
                <button
                  className="lecture-action lecture-primary-action"
                  disabled={
                    syncingCards ||
                    !cards.some((card) => card.status === "approved")
                  }
                  onClick={() => void syncApprovedCards()}
                >
                  {syncingCards && <LoaderCircle className="lecture-spin" />}
                  {syncingCards ? "Lägger i kö…" : "Synka godkända"}
                </button>
              </div>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={cardDeleteTarget !== null}
        onOpenChange={(open) => !open && setCardDeleteTarget(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-confirm">
            <Dialog.Title>
              Radera {cardDeleteTarget === "all" ? "alla kort" : "kortet"}?
            </Dialog.Title>
            <Dialog.Description>
              Synkade kort tas även bort ur Anki vid nästa synkning.
            </Dialog.Description>
            <div className="lecture-dialog-actions">
              <Dialog.Close className="lecture-action">Behåll</Dialog.Close>
              <button
                className="lecture-action lecture-danger-action"
                onClick={async () => {
                  const backup = await client.workflows.createBackup();
                  if (!backup.ok) return setError(backup.error.message);
                  const ids =
                    cardDeleteTarget === "all"
                      ? cards.map((card) => card.id)
                      : cardDeleteTarget
                        ? [cardDeleteTarget]
                        : [];
                  ids.forEach((id) => client.cards.remove(id));
                  setCardDeleteTarget(null);
                  setNotice(`${ids.length} kort togs bort.`);
                }}
              >
                <Trash2 /> Radera
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={imagesOpen} onOpenChange={setImagesOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-cards lecture-visuals">
            <header>
              <div>
                <Dialog.Title>Slidebilder</Dialog.Title>
                <Dialog.Description>
                  Extraherade bilder från {node.title}. Granska dem innan de
                  används till Anki-kort.
                </Dialog.Description>
              </div>
              <Dialog.Close className="lecture-icon" aria-label={c.close}>
                <X />
              </Dialog.Close>
            </header>
            {imageJob && (
              <p className="lecture-visual-job-status" role="status">
                {imageJob.label}: {imageJob.detail ?? "Arbetar…"}
              </p>
            )}
            <div className="lecture-visual-grid">
              {lecture.visualIndex?.length ? (
                lecture.visualIndex.map((visual) => (
                  <VisualPreview
                    key={visual.id}
                    client={client}
                    lectureId={lectureId}
                    visual={visual}
                    onRemove={() =>
                      void client.visuals.remove(lectureId, visual.id)
                    }
                  />
                ))
              ) : (
                <div className="lecture-empty">
                  <ImageIcon />
                  <h2>Inga bilder extraherade</h2>
                  <p>
                    Analysera slides för att hitta diagram, illustrationer och
                    fotografier.
                  </p>
                </div>
              )}
            </div>
            <footer>
              <span>{lecture.visualIndex?.length ?? 0} bilder</span>
              <button
                className="lecture-action lecture-primary-action"
                disabled={indexingImages}
                onClick={() => void extractImages()}
              >
                <Sparkles /> Extrahera bilder
              </button>
              {settings.visualAnalysisProvider === "api" &&
                Boolean(lecture.visualIndex?.length) && (
                  <button
                    className="lecture-action"
                    disabled={indexingImages}
                    onClick={() => void describeImages()}
                  >
                    <Sparkles /> Analysera med API
                  </button>
                )}
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

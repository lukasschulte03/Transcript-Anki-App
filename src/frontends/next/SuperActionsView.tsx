import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCheck,
  ChevronRight,
  FileText,
  Images,
  ScanText,
  Send,
  Sparkles,
  Trash2,
  Layers2,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { LectioClient, LibraryNode } from "../../application/lectioClient";
import { useJobs, useLibrary } from "../shared/useLectioClient";
import { NextButton, NextEmptyState } from "./ui/NextPrimitives";
import {
  buildSuperActionEligibility,
  selectableSuperActionLectureIds,
  type SuperAction,
} from "./superActionsEligibility";
import "./overview.css";

const actions: Array<{
  id: SuperAction;
  label: string;
  action: string;
  Icon: typeof FileText;
}> = [
  {
    id: "transcribe",
    label: "Transkribera",
    action: "Starta transkribering",
    Icon: FileText,
  },
  {
    id: "extractImages",
    label: "Extrahera bilder",
    action: "Extrahera slidebilder",
    Icon: Images,
  },
  {
    id: "describeImages",
    label: "Beskriv bilder",
    action: "Skapa korta AI-beskrivningar",
    Icon: ScanText,
  },
  {
    id: "generate",
    label: "Skapa Anki-kort",
    action: "Skapa Anki-kort",
    Icon: Sparkles,
  },
  {
    id: "approve",
    label: "Godkänn kort",
    action: "Godkänn valda kort",
    Icon: CheckCheck,
  },
  {
    id: "sync",
    label: "Synka Anki-kort",
    action: "Synka godkända kort",
    Icon: Send,
  },
  {
    id: "delete",
    label: "Radera Anki-kort",
    action: "Radera Anki-kort",
    Icon: Trash2,
  },
];

export function SuperActionsView({ client }: { client: LectioClient }) {
  const library = useLibrary(client);
  const jobs = useJobs(client);
  const [action, setAction] = useState<SuperAction>("transcribe");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const index = useMemo(() => {
    const nodesById = new Map(library.nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map<string | null, LibraryNode[]>();
    for (const node of library.nodes) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentId, siblings);
    }
    const lectureIdsByNode = new Map<string, string[]>();
    const collect = (id: string): string[] => {
      const cached = lectureIdsByNode.get(id);
      if (cached) return cached;
      const node = nodesById.get(id);
      const ids =
        node?.type === "lecture"
          ? [id]
          : (childrenByParent.get(id) ?? []).flatMap((child) =>
              collect(child.id),
            );
      lectureIdsByNode.set(id, ids);
      return ids;
    };
    library.nodes.forEach((node) => collect(node.id));
    const cardsByLecture = new Map<string, typeof library.cards>();
    for (const card of library.cards) {
      const cards = cardsByLecture.get(card.lectureId) ?? [];
      cards.push(card);
      cardsByLecture.set(card.lectureId, cards);
    }
    return {
      childrenByParent,
      lectureIdsByNode,
      cardsByLecture,
      transcriptLectures: new Set(
        library.segments.map((segment) => segment.lectureId),
      ),
    };
  }, [library.cards, library.nodes, library.segments]);

  const lectures = useMemo(
    () => library.nodes.filter((node) => node.type === "lecture"),
    [library.nodes],
  );
  const roots = useMemo(
    () => library.nodes.filter((node) => node.type === "course"),
    [library.nodes],
  );
  const active = actions.find((item) => item.id === action) ?? actions[0];
  const { nodes, lectures: lectureData, cards, segments, markers } = library;
  const eligibility = useMemo(
    () =>
      buildSuperActionEligibility(action, {
        nodes,
        lectures: lectureData,
        cards,
        segments,
        markers,
      }),
    [action, nodes, lectureData, cards, segments, markers],
  );
  const isComplete = (lectureId: string) => {
    if (action === "transcribe") return index.transcriptLectures.has(lectureId);
    if (action === "extractImages")
      return Boolean(lectureData[lectureId]?.visualIndex?.length);
    if (action === "describeImages") {
      const visuals = lectureData[lectureId]?.visualIndex ?? [];
      return (
        visuals.length > 0 &&
        visuals.every((item) => item.localVision || item.visualAnalysis)
      );
    }
    const cards = index.cardsByLecture.get(lectureId) ?? [];
    if (action === "generate") return cards.length > 0;
    if (action === "delete") return cards.length === 0;
    if (action === "approve")
      return (
        cards.length > 0 && cards.every((item) => item.status !== "generated")
      );
    return cards.length > 0 && cards.every((item) => item.status === "synced");
  };

  const isEligible = (lectureId: string) => eligibility.get(lectureId) === null;
  const eligibleLectureIds = selectableSuperActionLectureIds(
    lectures.map((item) => item.id),
    eligibility,
    isComplete,
    overwrite,
  );
  const selectableIds = new Set(eligibleLectureIds);
  const isSelectable = (lectureId: string) => selectableIds.has(lectureId);
  const selectedEligibleIds = [...selected].filter(isSelectable);

  const toggle = (node: LibraryNode) => {
    const allIds = index.lectureIdsByNode.get(node.id) ?? [];
    const ids = allIds.filter(isSelectable);
    if (!ids.length) return;
    setSelected((current) => {
      const next = new Set(current);
      const shouldAdd = !ids.every((id) => next.has(id));
      ids.forEach((id) => (shouldAdd ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const enqueue = async (overwriteConfirmed = false) => {
    const targetIds = [...selected].filter(isSelectable);
    if (!targetIds.length || busy) return;
    const replacesExisting =
      overwrite && (action === "generate" || action === "transcribe");
    if ((replacesExisting || action === "delete") && !overwriteConfirmed) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    setMessage("");
    if (replacesExisting || action === "delete") {
      const backup = await client.workflows.createBackup();
      if (!backup.ok) {
        setBusy(false);
        setMessage(`Ingen åtgärd startades: ${backup.error.message}`);
        return;
      }
    }
    if (action === "delete") {
      const ids = library.cards
        .filter((card) => targetIds.includes(card.lectureId))
        .map((card) => card.id);
      const failed = ids
        .map((id) => client.cards.remove(id))
        .find((result) => !result.ok);
      setBusy(false);
      if (failed && !failed.ok) setMessage(failed.error.message);
      else {
        setMessage(
          `${ids.length} kort togs bort. Synkade kort tas bort från Anki vid nästa synkning.`,
        );
        setSelected(new Set());
      }
      return;
    }
    const result = await client.workflows.enqueue(action, targetIds, overwrite);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage(`${result.value.length} åtgärder lades i kön.`);
    setSelected(new Set());
  };

  const renderNode = (node: LibraryNode, depth = 0): ReactNode => {
    const children = index.childrenByParent.get(node.id) ?? [];
    const ids = index.lectureIdsByNode.get(node.id) ?? [];
    const selectableIds = ids.filter(isSelectable);
    const checked =
      selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
    const partial = !checked && selectableIds.some((id) => selected.has(id));
    const open = expanded.has(node.id);
    return (
      <li key={node.id}>
        <div
          className="batch-tree-row"
          style={{ "--tree-depth": depth } as CSSProperties}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className="batch-tree-expand"
              aria-label={`${open ? "Fäll ihop" : "Visa innehåll i"} ${node.title}`}
              aria-expanded={open}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              <ChevronRight aria-hidden="true" />
            </button>
          ) : (
            <span className="batch-tree-expand" aria-hidden="true" />
          )}
          <label>
            <input
              type="checkbox"
              name={`batch-node-${node.id}`}
              checked={checked}
              ref={(input) => {
                if (input) input.indeterminate = partial;
              }}
              onChange={() => toggle(node)}
              disabled={!selectableIds.length}
              aria-label={`${node.title}${selectableIds.length ? "" : ", inte valbar för den här åtgärden"}`}
            />
            <span>{node.title}</span>
          </label>
          {node.type === "lecture" && !isEligible(node.id) && (
            <small>{eligibility.get(node.id)}</small>
          )}
          {node.type === "lecture" &&
            isEligible(node.id) &&
            isComplete(node.id) && <small>redan klar</small>}
          {node.type !== "lecture" && !selectableIds.length && (
            <small>Inget underlag</small>
          )}
        </div>
        {children.length > 0 && open && (
          <ul>{children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="overview-page batch-page" aria-labelledby="batch-title">
      <header className="overview-header">
        <div>
          <p className="overview-eyebrow">Flera föreläsningar</p>
          <h1 id="batch-title">Superåtgärder</h1>
          <p>Välj en åtgärd och de föreläsningar som ska bearbetas.</p>
        </div>
      </header>
      <div className="batch-action-tabs" role="group" aria-label="Åtgärd">
        {actions.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={action === id}
            onClick={() => {
              setAction(id);
              setSelected(new Set());
            }}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {lectures.length ? (
        <section className="batch-workspace" aria-label="Välj föreläsningar">
          <div className="batch-toolbar">
            <strong>{selectedEligibleIds.length} valda</strong>
            <NextButton
              tone="quiet"
              aria-label={
                overwrite
                  ? "Välj alla valbara föreläsningar, även redan klara"
                  : "Välj alla ofärdiga valbara föreläsningar"
              }
              title={
                overwrite
                  ? "Inkluderar även redan klara föreläsningar"
                  : "Redan klara föreläsningar väljs när ersättning tillåts"
              }
              onClick={() => setSelected(new Set(eligibleLectureIds))}
            >
              Välj alla
            </NextButton>
            <NextButton tone="quiet" onClick={() => setSelected(new Set())}>
              Rensa
            </NextButton>
          </div>
          <ul className="batch-tree">
            {roots.map((node) => renderNode(node))}
          </ul>
          {action !== "delete" && (
            <label className="batch-overwrite">
              <input
                type="checkbox"
                name="batch-overwrite"
                checked={overwrite}
                onChange={(event) => {
                  const allowOverwrite = event.target.checked;
                  setOverwrite(allowOverwrite);
                  if (!allowOverwrite) {
                    setSelected(
                      (current) =>
                        new Set(
                          [...current].filter(
                            (id) => isEligible(id) && !isComplete(id),
                          ),
                        ),
                    );
                  }
                }}
              />
              <span>
                <strong>Tillåt att befintligt resultat ersätts</strong>
                <small>
                  {action === "extractImages"
                    ? "Välj även föreläsningar där slidebilder redan har extraherats. Befintliga beskrivningar och OCR bevaras där det går."
                    : action === "describeImages"
                      ? "Välj även föreläsningar med befintliga beskrivningar för att uppdatera dem med vald lokal/API-modell."
                    : action === "generate"
                    ? "Välj även klara föreläsningar. Gamla kort ersätts när nya har skapats."
                    : action === "transcribe"
                      ? "Välj även klara föreläsningar. Gamla transkript ersätts först efter lyckad körning."
                      : "Välj även redan klara föreläsningar för en ny körning."}
                </small>
              </span>
            </label>
          )}
          <div className="batch-submit">
            <div aria-live="polite">
              {message ||
                (jobs.some(
                  (job) => job.status === "active" || job.status === "queued",
                )
                  ? "Bakgrundsarbete pågår."
                  : "")}
            </div>
            <NextButton
              tone="primary"
              disabled={!selectedEligibleIds.length || busy}
              onClick={() => void enqueue()}
            >
              {busy ? "Lägger i kön…" : `${active.action} nu`}
            </NextButton>
          </div>
        </section>
      ) : (
        <NextEmptyState
          icon={<Layers2 />}
          title="Inga föreläsningar ännu"
          description="Skapa en föreläsning i biblioteket först."
        />
      )}

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="batch-dialog-overlay" />
          <Dialog.Content className="batch-dialog">
            <Dialog.Title>
              {action === "delete"
                ? "Radera valda Anki-kort?"
                : action === "transcribe"
                  ? "Ersätt befintliga transkript?"
                  : "Ersätt befintliga Anki-kort?"}
            </Dialog.Title>
            <Dialog.Description>
              {selectedEligibleIds.length}{" "}
              {selectedEligibleIds.length === 1
                ? "föreläsning"
                : "föreläsningar"}{" "}
              berörs. Lectio skapar först en lokal återställningspunkt
              {action === "delete"
                ? ", och synkade kort tas bort ur Anki vid nästa synkning."
                : action === "transcribe"
                  ? ". Det gamla transkriptet behålls om den nya transkriberingen misslyckas."
                  : ". De gamla korten tas bort först när nya kort har skapats; synkade kort tas bort ur Anki vid nästa synkning."}
            </Dialog.Description>
            <div className="batch-dialog-actions">
              <Dialog.Close asChild>
                <NextButton>Avbryt</NextButton>
              </Dialog.Close>
              <NextButton tone="danger" onClick={() => void enqueue(true)}>
                Skapa backup och fortsätt
              </NextButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

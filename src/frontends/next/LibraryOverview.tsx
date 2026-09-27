import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  FileAudio,
  FileText,
  Layers2,
  Plus,
} from "lucide-react";
import type { LectioClient, LibraryNode, NodeType } from "../../application/lectioClient";
import { useLibrary } from "../shared/useLectioClient";
import { NextButton, NextEmptyState } from "./ui/NextPrimitives";
import "./library-overview.css";

const labels: Record<"course" | "module" | "topic", string> = {
  course: "Kurs",
  module: "Modul",
  topic: "Ämne",
};

const childLabel: Record<"module" | "topic" | "lecture", string> = {
  module: "modul",
  topic: "ämne",
  lecture: "föreläsning",
};
const childName = (type: NodeType) => type === "topic" ? "nytt ämne" : `ny ${childLabel[type as keyof typeof childLabel]}`;

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function LibraryOverview({
  client,
  nodeId,
}: {
  client: LectioClient;
  nodeId: string;
}) {
  const library = useLibrary(client);
  const node = library.nodes.find((item) => item.id === nodeId);
  const [context, setContext] = useState(node?.context ?? "");
  const [contextStatus, setContextStatus] = useState("");
  const [creating, setCreating] = useState<NodeType | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState("");

  const children = useMemo(
    () =>
      library.nodes
        .filter((item) => item.parentId === nodeId)
        .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)),
    [library.nodes, nodeId],
  );
  const descendants = useMemo(() => {
    const childrenByParent = new Map<string, LibraryNode[]>();
    for (const item of library.nodes) {
      if (!item.parentId) continue;
      const children = childrenByParent.get(item.parentId) ?? [];
      children.push(item);
      childrenByParent.set(item.parentId, children);
    }
    const result: LibraryNode[] = [];
    const pending = [...(childrenByParent.get(nodeId) ?? [])];
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      result.push(item);
      pending.push(...(childrenByParent.get(item.id) ?? []));
    }
    return result;
  }, [library.nodes, nodeId]);
  const lectureIds = new Set(
    descendants.filter((item) => item.type === "lecture").map((item) => item.id),
  );
  const transcriptCount = new Set(
    library.segments
      .filter((segment) => lectureIds.has(segment.lectureId))
      .map((segment) => segment.lectureId),
  ).size;
  const cardCount = library.cards.filter((card) => lectureIds.has(card.lectureId)).length;
  const ancestor = node?.parentId
    ? library.nodes.find((item) => item.id === node.parentId)
    : undefined;
  const inherited: LibraryNode[] = [];
  const seen = new Set<string>();
  let current = ancestor;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.context?.trim()) inherited.push(current);
    current = current.parentId
      ? library.nodes.find((item) => item.id === current?.parentId)
      : undefined;
  }

  if (!node || (node.type !== "course" && node.type !== "module" && node.type !== "topic")) {
    return <NextEmptyState icon={<BookOpen />} title="Objektet kunde inte öppnas" description="Välj ett annat objekt i biblioteket." />;
  }

  const createType = node.type === "course" ? "module" : "lecture";
  const create = (type: NodeType) => {
    const title = newTitle.trim();
    if (!title) return;
    const result = client.library.addNode(nodeId, type, title);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCreating(null);
    setNewTitle("");
    setError("");
    client.session.selectNode(result.value);
    client.session.setActiveView("workspace");
  };
  const saveContext = () => {
    if (context === node.context) return true;
    const result = client.library.updateNode(nodeId, { context });
    if (!result.ok) {
      setError(result.error.message);
      setContextStatus("");
      return false;
    } else {
      setError("");
      setContextStatus("Sparat");
      return true;
    }
  };
  const open = (id: string) => {
    if (!saveContext()) return;
    client.session.selectNode(id);
    client.session.setActiveView("workspace");
  };

  return (
    <div className="library-overview" aria-labelledby="library-overview-title">
      <div className="library-overview-inner">
        <header className="library-overview-header">
          <div>
            {ancestor && (
              <button className="library-overview-parent" onClick={() => open(ancestor.id)}>
                {ancestor.title}<ArrowRight aria-hidden="true" />
              </button>
            )}
            <h1 id="library-overview-title">{node.title}</h1>
            <p>{labels[node.type]} · {countLabel(lectureIds.size, "föreläsning", "föreläsningar")}</p>
          </div>
          {node.type !== "topic" && (
            <NextButton tone="primary" onClick={() => { setCreating(createType); setNewTitle(""); }}>
              <Plus aria-hidden="true" /> Ny {childLabel[createType]}
            </NextButton>
          )}
        </header>

        <section className="library-overview-summary" aria-label="Material i {node.title}">
          <div><BookOpen aria-hidden="true" /><strong>{lectureIds.size}</strong><span>föreläsningar</span></div>
          <div><FileAudio aria-hidden="true" /><strong>{transcriptCount}</strong><span>transkriberade</span></div>
          <div><Layers2 aria-hidden="true" /><strong>{cardCount}</strong><span>Anki-kort</span></div>
        </section>

        <section className="library-overview-section" aria-labelledby="library-contents-title">
          <div className="library-overview-section-heading">
            <h2 id="library-contents-title">Innehåll</h2>
            <span>{children.length}</span>
          </div>
          {creating && (
            <form className="library-overview-create" onSubmit={(event) => { event.preventDefault(); create(creating); }}>
              <input autoFocus aria-label={`Namn på ${childName(creating)}`} placeholder={`Namn på ${childName(creating)}`} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreating(null); }} />
              <NextButton tone="primary" type="submit" disabled={!newTitle.trim()}>Skapa</NextButton>
              <NextButton tone="quiet" onClick={() => setCreating(null)}>Avbryt</NextButton>
            </form>
          )}
          {children.length ? (
            <div className="library-overview-list">
              {children.map((child) => {
                const lecture = library.lectures[child.id];
                const childCount = child.type === "module"
                  ? library.nodes.filter((item) => item.parentId === child.id).length
                  : 0;
                const detail = child.type === "module"
                  ? countLabel(childCount, "objekt", "objekt")
                  : child.type === "topic"
                    ? "Ämne"
                    : [lecture?.slideAssetId && "slides", lecture?.audioParts?.length && "ljud", library.segments.some((segment) => segment.lectureId === child.id) && "transkript"].filter(Boolean).join(" · ") || "Inget material ännu";
                const Icon = child.type === "module" ? Layers2 : child.type === "lecture" ? FileText : BookOpen;
                return <button key={child.id} className="library-overview-item" onClick={() => open(child.id)}>
                  <span className="library-overview-item-icon"><Icon aria-hidden="true" /></span>
                  <span><strong>{child.title}</strong><small>{detail}</small></span>
                  <ArrowRight aria-hidden="true" />
                </button>;
              })}
            </div>
          ) : (
            <NextEmptyState icon={<BookOpen />} title={node.type === "topic" ? "Inget innehåll här ännu" : "Här är det tomt ännu"} description={node.type === "topic" ? "Skriv några rader om ämnet nedan." : `Skapa en ${childLabel[createType]} för att fortsätta bygga biblioteket.`} />
          )}
          {node.type === "module" && !creating && (
            <NextButton tone="quiet" className="library-overview-add-topic" onClick={() => { setCreating("topic"); setNewTitle(""); }}><Plus aria-hidden="true" /> Nytt ämne</NextButton>
          )}
        </section>

        <section className="library-overview-section" aria-labelledby="library-context-title">
          <div className="library-overview-section-heading"><h2 id="library-context-title">Kontext</h2><span className="library-overview-saved" role="status">{contextStatus && <><Check aria-hidden="true" /> {contextStatus}</>}</span></div>
          <p className="library-overview-explanation">Det du skriver här kan användas för föreläsningar och Anki-kort under {node.type === "course" ? "kursen" : node.type === "module" ? "modulen" : "ämnet"}.</p>
          <textarea aria-label={`Kontext för ${node.title}`} value={context} onChange={(event) => { setContext(event.target.value); setContextStatus(""); }} onBlur={saveContext} placeholder="Begrepp, mål eller annat som är bra att känna till…" rows={6} />
          {inherited.length > 0 && <details className="library-overview-inherited"><summary>Ärvt från {inherited.map((item) => item.title).join(" och ")}</summary>{inherited.map((item) => <div key={item.id}><strong>{item.title}</strong><p>{item.context}</p></div>)}</details>}
        </section>
        {error && <p className="library-overview-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock3, LoaderCircle, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import { useAppStore } from "../../core/store";
import type { LibraryNode } from "../../core/types";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { cn } from "../../lib/utils";
import { lectureDeckName, needsAnkiSync } from "../../services/anki";
import { cancelBatchJob, clearFinishedBatchJobs, completeWaitingBatchJob, enqueueBatch, getBatchJobs, resumeBatchQueue, retryBatchJob, subscribeBatchJobs, type BatchAction, type BatchJob } from "../../services/batchActions";

const labels: Record<BatchAction, string> = { transcribe: "Transkribera", generate: "Skapa Anki-kort", approve: "Godkänn kort", sync: "Synka till Anki" };
const descriptions: Record<BatchAction, string> = {
  transcribe: "Bearbetar ljudfiler sekventiellt med din valda transkriptionsmetod.",
  generate: "API körs automatiskt. Copy/paste ger en handoff-kö, en föreläsning i taget.",
  approve: "Godkänner alla genererade kort i de valda föreläsningarna.",
  sync: "Skickar bara godkända ändringar och borttagningar inkrementellt till Anki.",
};

function descendants(nodes: LibraryNode[], id: string) {
  const result: string[] = [];
  const visit = (parentId: string) => nodes.filter((node) => node.parentId === parentId).forEach((node) => { if (node.type === "lecture") result.push(node.id); visit(node.id); });
  const self = nodes.find((node) => node.id === id);
  if (self?.type === "lecture") result.push(self.id); else visit(id);
  return result;
}

function StatusIcon({ job }: { job: BatchJob }) {
  if (job.status === "running") return <LoaderCircle className="size-4 animate-spin text-[var(--palette-accent)]" />;
  if (job.status === "complete") return <CircleCheck className="size-4 text-[var(--palette-success)]" />;
  if (job.status === "error") return <CircleAlert className="size-4 text-[var(--palette-danger)]" />;
  if (job.status === "cancelled") return <X className="size-4 text-[var(--palette-text-subtle)]" />;
  return <Clock3 className="size-4 text-[var(--palette-warning)]" />;
}

export function SuperActions() {
  const store = useAppStore();
  const { nodes, lectures, segments, cards, pendingAnkiDeletions, settings, selectNode, setActiveView } = store;
  const jobs = useSyncExternalStore(subscribeBatchJobs, getBatchJobs, getBatchJobs);
  const [action, setAction] = useState<BatchAction>("transcribe");
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(() => nodes.filter((node) => node.type !== "lecture").map((node) => node.id));
  useEffect(() => resumeBatchQueue(), []);
  const lectureNodes = useMemo(() => nodes.filter((node) => node.type === "lecture"), [nodes]);

  const hasInput = (id: string) => {
    const lecture = lectures[id];
    if (action === "transcribe") return Boolean(lecture?.audioAssetId || lecture?.audioParts?.length);
    if (action === "generate") return Boolean(lecture?.notes.trim() || lecture?.slideText?.trim() || segments.some((segment) => segment.lectureId === id));
    if (action === "approve") return cards.some((card) => card.lectureId === id && card.status === "generated");
    const deck = lectureDeckName(nodes, id, settings.defaultDeck);
    return cards.some((card) => card.lectureId === id && (card.status === "approved" || Boolean(card.ankiSyncError) || (card.status === "synced" && needsAnkiSync(card, deck)))) || pendingAnkiDeletions.some((item) => item.lectureId === id);
  };
  const alreadyDone = (id: string) => action === "transcribe"
    ? segments.some((segment) => segment.lectureId === id)
    : action === "generate"
      ? cards.some((card) => card.lectureId === id)
      : action === "approve"
        ? !cards.some((card) => card.lectureId === id && card.status === "generated") && cards.some((card) => card.lectureId === id)
        : !hasInput(id) && cards.some((card) => card.lectureId === id && card.status === "synced");
  const latestJob = (id: string) => [...jobs].reverse().find((job) => job.action === action && job.lectureId === id);
  const activeJob = (id: string) => jobs.some((job) => job.action === action && job.lectureId === id && ["queued", "running", "waiting"].includes(job.status));
  const selectable = (id: string) => (hasInput(id) || alreadyDone(id)) && !activeJob(id);
  const possible = lectureNodes.filter((node) => hasInput(node.id) && !alreadyDone(node.id) && !activeJob(node.id));
  const toggleMany = (ids: string[]) => {
    const candidates = ids.filter(selectable);
    setSelected((current) => candidates.length && candidates.every((id) => current.includes(id)) ? current.filter((id) => !candidates.includes(id)) : [...new Set([...current, ...candidates])]);
  };
  const start = () => {
    const targets = lectureNodes.filter((node) => selected.includes(node.id));
    const completed = targets.filter((node) => alreadyDone(node.id));
    if (action === "transcribe" && completed.length && !confirm(`${completed.length} valda föreläsningar har redan transkript. Dessa transkript ersätts. Fortsätt?`)) return;
    if (action === "generate" && completed.length && !confirm(`${completed.length} valda föreläsningar har redan kort. Nya kort läggs till för granskning; godkända och synkade kort behålls. Fortsätt?`)) return;
    enqueueBatch(action, targets.map(({ id, title }) => ({ id, title })), completed.length > 0);
    setSelected([]);
  };
  const openWaiting = (job: BatchJob) => { selectNode(job.lectureId); setActiveView("cards"); };

  const renderNode = (node: LibraryNode, depth = 0): ReactNode => {
    const children = nodes.filter((item) => item.parentId === node.id).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const ids = descendants(nodes, node.id).filter(selectable);
    const checked = ids.length > 0 && ids.every((id) => selected.includes(id));
    const partial = ids.some((id) => selected.includes(id)) && !checked;
    const open = expanded.includes(node.id);
    const job = node.type === "lecture" ? latestJob(node.id) : undefined;
    const done = node.type === "lecture" && alreadyDone(node.id);
    return <div key={node.id}>
      <div className={cn("flex min-h-11 items-center gap-2 border-b border-[var(--palette-border)] px-3 transition-colors", ids.length ? "hover:bg-[var(--palette-surface-hover)]" : "opacity-45", done && "bg-[var(--palette-surface-muted)]/60")} style={{ paddingLeft: 12 + depth * 22 }}>
        {children.length ? <button className="grid size-7 place-items-center rounded-md text-[var(--palette-text-muted)] hover:bg-[var(--palette-surface-hover)]" onClick={() => setExpanded((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id])} aria-label={open ? "Fäll ihop" : "Fäll ut"}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button> : <span className="size-7" />}
        <button type="button" disabled={!ids.length} onClick={() => toggleMany(ids)} className={cn("grid size-4 shrink-0 place-items-center rounded border outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]", checked || partial ? "border-[var(--palette-primary)] bg-[var(--palette-primary)] text-[var(--palette-primary-foreground)]" : "border-[var(--palette-border-strong)] bg-[var(--palette-surface)]")} role="checkbox" aria-checked={partial ? "mixed" : checked}>{checked ? <Check className="size-3" /> : partial ? <span className="h-px w-2 bg-current" /> : null}</button>
        <span className={cn("min-w-0 flex-1 truncate text-sm", node.type === "lecture" ? "text-[var(--palette-text)]" : "font-medium text-[var(--palette-text-muted)]")}>{node.title}</span>
        {done && <span className="text-xs text-[var(--palette-text-subtle)]">Redan klar · kan köras igen</span>}
        {job && <span className="flex max-w-72 items-center gap-2 truncate text-xs text-[var(--palette-text-muted)]"><StatusIcon job={job} /><span className="truncate">{job.detail}</span></span>}
        {(job?.status === "error" || job?.status === "cancelled") && <Button size="sm" variant="ghost" onClick={() => retryBatchJob(job.id)}><RotateCcw className="mr-1 size-3.5" />Försök igen</Button>}
        {(job?.status === "running" || job?.status === "queued") && <Button size="sm" variant="ghost" onClick={() => void cancelBatchJob(job.id)}>Avbryt</Button>}
        {job?.status === "waiting" && <><Button size="sm" variant="outline" onClick={() => openWaiting(job)}>Öppna</Button><Button size="sm" variant="ghost" onClick={() => completeWaitingBatchJob(job.id)}>Markera klar</Button></>}
      </div>
      {children.length && open ? children.map((child) => renderNode(child, depth + 1)) : null}
    </div>;
  };

  const roots = nodes.filter((node) => node.parentId && nodes.find((parent) => parent.id === node.parentId)?.type === "workspace");
  const relevantJobs = jobs.filter((job) => job.action === action);
  const activeCount = relevantJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  return <main className="ui-app-bg min-w-0 flex-1 overflow-auto"><PageHeader title="Super Actions" /><div className="mx-auto max-w-6xl space-y-5 p-6">
    <div className="flex gap-1 overflow-x-auto border-b border-[var(--palette-border)]" role="tablist">{(Object.keys(labels) as BatchAction[]).map((item) => <button key={item} role="tab" aria-selected={action === item} onClick={() => { setAction(item); setSelected([]); }} className={cn("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)]", action === item ? "border-[var(--palette-primary)] text-[var(--palette-accent)]" : "border-transparent text-[var(--palette-text-muted)] hover:text-[var(--palette-text)]")}>{labels[item]}</button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[var(--palette-text-muted)]">{descriptions[action]}</p><div className="flex items-center gap-2">{relevantJobs.some((job) => ["complete", "error", "cancelled"].includes(job.status)) && <Button variant="ghost" size="sm" onClick={clearFinishedBatchJobs}><Trash2 className="mr-1.5 size-4" />Rensa klara</Button>}<Button variant="outline" size="sm" onClick={() => setSelected(possible.map((node) => node.id))}>Välj alla möjliga ({possible.length})</Button></div></div>
    <section className="overflow-hidden border-y border-[var(--palette-border)] bg-[var(--palette-surface)]" aria-label="Bibliotek för batchåtgärder">{roots.length ? roots.map((root) => renderNode(root)) : <EmptyState icon={Wand2} title="Inga föreläsningar att köra" description="Skapa en kurs och några föreläsningar först." className="border-0" />}</section>
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--palette-border-strong)] bg-[var(--palette-surface)] px-4 py-3"><div><p className="text-sm font-medium text-[var(--palette-text)]">{selected.length} föreläsningar valda</p><p className="mt-0.5 text-xs text-[var(--palette-text-muted)]">{activeCount ? `${activeCount} jobb arbetar eller väntar i kön.` : "Ett fel stoppar inte nästa föreläsning."}</p></div><Button disabled={!selected.length} onClick={start}><Wand2 className="mr-2 size-4" />{labels[action]} nu ({selected.length})</Button></div>
  </div></main>;
}

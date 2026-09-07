import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";

type Action = "transcribe" | "generate" | "approve" | "sync";
const labels: Record<Action, string> = {
  transcribe: "Transkribera",
  generate: "Skapa Anki-kort",
  approve: "Godkänn kort",
  sync: "Synka till Anki",
};

export function SuperActions() {
  const { nodes, lectures, cards, updateCard, selectNode, setActiveView } = useAppStore();
  const [action, setAction] = useState<Action>("generate");
  const [selected, setSelected] = useState<string[]>([]);
  const lecturesInLibrary = useMemo(() => nodes.filter((node) => node.type === "lecture"), [nodes]);
  const eligible = (id: string) => action === "transcribe"
    ? Boolean(lectures[id]?.audioAssetId || lectures[id]?.audioParts?.length)
    : action === "generate"
      ? Boolean(lectures[id]?.notes || cards.some((card) => card.lectureId === id))
      : action === "approve"
        ? cards.some((card) => card.lectureId === id && card.status === "generated")
        : cards.some((card) => card.lectureId === id && card.status === "approved");
  const possible = lecturesInLibrary.filter((node) => eligible(node.id));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const run = () => {
    if (action === "approve") {
      cards.filter((card) => selected.includes(card.lectureId) && card.status === "generated")
        .forEach((card) => updateCard(card.id, { status: "approved" }));
      return;
    }
    if (selected[0]) selectNode(selected[0]);
    setActiveView(action === "sync" || action === "generate" ? "cards" : "workspace");
  };
  return <main className="ui-app-bg min-w-0 flex-1 overflow-auto p-6">
    <div className="mx-auto max-w-5xl space-y-6">
      <header><p className="text-sm font-medium text-[var(--palette-accent)]">Batchåtgärder</p><h1 className="mt-1 text-2xl font-semibold text-[var(--palette-text)]">Super Actions</h1><p className="mt-2 text-sm text-[var(--palette-text-muted)]">Välj föreläsningar och arbeta igenom dem en i taget.</p></header>
      <div className="flex flex-wrap gap-2">{(Object.keys(labels) as Action[]).map((item) => <Button key={item} variant={action === item ? "default" : "outline"} size="sm" onClick={() => { setAction(item); setSelected([]); }}>{labels[item]}</Button>)}</div>
      <section className="rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--palette-border)] p-4"><div><h2 className="font-semibold text-[var(--palette-text)]">Hela biblioteket</h2><p className="text-sm text-[var(--palette-text-muted)]">Dämpade rader saknar underlag för denna åtgärd.</p></div><Button variant="outline" size="sm" onClick={() => setSelected(possible.map((node) => node.id))}>Välj alla möjliga</Button></div>
        <div className="divide-y divide-[var(--palette-border)]">{lecturesInLibrary.map((node) => { const ready = eligible(node.id); return <label key={node.id} className={`flex items-center gap-3 p-4 ${ready ? "cursor-pointer" : "opacity-45"}`}><input type="checkbox" disabled={!ready} checked={selected.includes(node.id)} onChange={() => toggle(node.id)} className="size-4 accent-[var(--palette-primary)]"/><span className="flex-1 text-sm font-medium text-[var(--palette-text)]">{node.title}</span><span className="text-xs text-[var(--palette-text-muted)]">{ready ? "Möjlig" : "Ej tillgänglig"}</span></label>; })}</div>
      </section>
      <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-[var(--palette-border-strong)] bg-[var(--palette-surface)] p-4 shadow-lg"><span className="text-sm text-[var(--palette-text-muted)]">{selected.length} föreläsningar valda</span><Button disabled={!selected.length} onClick={run}><Wand2 className="mr-2 size-4" />{action === "approve" ? "Godkänn kort nu" : `${labels[action]} nu`}</Button></div>
    </div>
  </main>;
}

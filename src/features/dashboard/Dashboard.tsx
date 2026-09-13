import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  FileUp,
  FolderTree,
  Keyboard,
  Mic,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { useAppStore } from "../../core/store";
import { LectureImportAssistant } from "../library/LectureImportAssistant";

export function Dashboard() {
  const [importOpen, setImportOpen] = useState(false);
  const { nodes, cards, lectures, selectNode, setActiveView } = useAppStore();
  const courseNodes = nodes.filter((node) => node.type === "course");
  const lectureNodes = nodes.filter((node) => node.type === "lecture");
  const recent = [...lectureNodes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const approved = cards.filter((card) => card.status === "approved").length;
  const openRecent = () => {
    setActiveView("workspace");
    if (recent[0]) selectNode(recent[0].id);
  };

  return (
    <div className="ui-app-bg min-w-0 flex-1 overflow-auto">
      <PageHeader
        title="Översikt"
        actions={
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="size-3.5" /> Importera ljud
          </Button>
        }
      />

      <main className="mx-auto w-full max-w-7xl p-6">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {recent.length ? "Fortsätt där du slutade" : "Bygg ditt studiebibliotek"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {recent.length
                ? "Ljud, transkript, slides och kort hålls samlade i samma struktur."
                : "Skapa först en kurs och strukturera sedan materialet efter modul och ämne."}
            </p>
          </div>
          <Button size="md" onClick={openRecent}>
            {recent.length ? <Mic /> : <FolderTree />}
            {recent.length ? "Öppna senaste föreläsningen" : "Öppna biblioteket"}
          </Button>
        </section>

        <section className="flex flex-wrap divide-x divide-border border-y border-border py-4">
          <Stat icon={BookOpen} label="Kurser" value={courseNodes.length} hint="i ditt bibliotek" />
          <Stat icon={FileText} label="Föreläsningar" value={lectureNodes.length} hint={`${Object.values(lectures).filter((item) => item.audioAssetId).length} med ljud`} />
          <Stat icon={CheckCircle2} label="Redo för Anki" value={approved} hint={`${cards.filter((card) => card.status === "synced").length} redan synkade`} />
        </section>

        <section className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            <SectionHeading title="Senaste föreläsningar" action="Visa biblioteket" onAction={() => setActiveView("workspace")} />
            {recent.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((node) => (
                  <button key={node.id} onClick={() => { selectNode(node.id); setActiveView("workspace"); }} className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground"><FileText className="size-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{node.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{new Date(node.createdAt).toLocaleDateString("sv-SE")}</span></span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            ) : <EmptyRecent onOpen={() => setActiveView("workspace")} />}

            <details className="mt-8 border-t border-border pt-5" open={!recent.length}>
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Så använder du Lectio
              </summary>
              <div className="mt-5 grid gap-6 md:grid-cols-3">
                <WorkflowStep icon={Mic} title="Fånga material" text="Spela in eller importera ljud. Lägg till slides och korta anteckningar vid behov." />
                <WorkflowStep icon={FileText} title="Bearbeta" text="Transkribera, sök och markera sådant som är viktigt inför tentan." />
                <WorkflowStep icon={Sparkles} title="Granska och synka" text="Skapa kort, granska dem och synka bara det du godkänner." />
              </div>
              <p className="mt-6 max-w-3xl text-sm leading-6 text-muted-foreground">
                Context och bifogade filer från kurs och modul följer automatiskt med nedåt i biblioteket. Du väljer alltid vilka källor som faktiskt används när kort skapas.
              </p>
              <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => setActiveView("workspace")}>Hantera context i biblioteket <ArrowRight /></Button>
            </details>
          </div>

          <aside className="space-y-6 border-l border-border pl-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Keyboard className="size-4 text-muted-foreground" /> Genvägar</div>
              <div className="space-y-3">
                <Shortcut keys={["Ctrl", "1–5"]} label="Växla mellan översikt, bibliotek, Anki, Inkorg och Super Actions" />
                <Shortcut keys={["Ctrl", "N"]} label="Skapa nästa objekt i strukturen" />
                <Shortcut keys={["Mellanslag"]} label="Spela upp eller pausa ljud" />
                <Shortcut keys={["M"]} label="Markera viktigt ögonblick" />
                <Shortcut keys={["Ctrl", "B"]} label="Visa eller dölj sidofält" />
                <Button variant="outline" size="sm" className="mt-1 w-full" onClick={() => window.dispatchEvent(new Event("lectio:show-shortcuts"))}>Visa alla kortkommandon</Button>
              </div>
            <div className="border-t border-border pt-5">
              <p className="text-sm leading-6 text-muted-foreground">Inspelningar och ditt bibliotek lagras lokalt. När du väljer en moln-AI visas vilka källor som skickas innan något genereras.</p>
            </div>
          </aside>
        </section>
      </main>
      <LectureImportAssistant open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-foreground">{title}</h2>{action && <Button variant="link" size="sm" className="px-0" onClick={onAction}>{action}</Button>}</div>;
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof BookOpen; label: string; value: number; hint: string }) {
  return <div className="flex min-w-48 flex-1 items-center gap-3 px-5 first:pl-0"><Icon className="size-4 text-muted-foreground" /><div><div className="text-lg font-semibold tabular-nums text-foreground">{value} <span className="text-sm font-medium">{label.toLocaleLowerCase("sv-SE")}</span></div><div className="text-xs text-muted-foreground">{hint}</div></div></div>;
}

function WorkflowStep({ icon: Icon, title, text }: { icon: typeof Mic; title: string; text: string }) {
  return <div className="flex gap-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></div><div><h3 className="text-sm font-medium text-foreground">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></div>;
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return <div className="flex items-center justify-between gap-3 text-xs"><span className="leading-5 text-muted-foreground">{label}</span><span className="flex shrink-0 items-center gap-1">{keys.map((key) => <kbd key={key} className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-foreground">{key}</kbd>)}</span></div>;
}

function EmptyRecent({ onOpen }: { onOpen: () => void }) {
  return <EmptyState icon={FolderTree} title="Inga föreläsningar ännu" description="Skapa en kurs, modul och föreläsning för att börja samla material." action={<Button variant="outline" size="sm" onClick={onOpen}>Öppna biblioteket</Button>} />;
}

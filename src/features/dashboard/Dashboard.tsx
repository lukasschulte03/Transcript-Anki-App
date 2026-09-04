import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileUp,
  FileText,
  Mic,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useAppStore } from "../../core/store";
import { Button } from "../../components/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function Dashboard() {
  const {
    nodes,
    cards,
    lectures,
    settings,
    updateSettings,
    selectNode,
    setActiveView,
  } = useAppStore();
  const courseNodes = nodes.filter((node) => node.type === "course");
  const lectureNodes = nodes.filter((node) => node.type === "lecture");
  const recent = [...lectureNodes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const approved = cards.filter((card) => card.status === "approved").length;
  return (
    <div className="ui-app-bg min-w-0 flex-1 overflow-auto">
      <header className="flex h-14 items-center justify-between border-b border-[var(--palette-border)] bg-[var(--palette-surface)] px-6">
        <div>
          <h1 className="text-sm font-semibold text-[var(--palette-text)]">Översikt</h1>
        </div>
        <Button size="sm" onClick={() => setActiveView("workspace")}>
          <Plus className="size-4" /> Öppna kurser
        </Button>
      </header>
      <main className="mx-auto w-full max-w-7xl p-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Ditt lokala studiebibliotek</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              Hej! Här är din översikt.
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiveView("workspace");
              if (recent[0]) selectNode(recent[0].id);
            }}
          >
            <Mic className="size-4" /> {recent[0] ? "Fortsätt senaste" : "Kom igång"}
          </Button>
        </div>

        <Card className="mb-6 gap-0 border border-border py-0 shadow-none">
          <CardHeader className="border-b border-border py-4">
            <CardTitle>Snabbstart</CardTitle>
            <CardDescription>
              Fånga föreläsningen först. Organisera och repetera efteråt.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 py-4 sm:grid-cols-3">
            <QuickAction icon={BookOpen} title="1. Organisera" text="Skapa kurs, modul och föreläsning." onClick={() => setActiveView("workspace")} />
            <QuickAction icon={Mic} title="2. Fånga" text="Spela in eller importera ljudfiler." onClick={() => setActiveView("workspace")} />
            <QuickAction icon={Sparkles} title="3. Repetera" text="Skapa och granska Anki-kort." onClick={() => setActiveView("cards")} />
          </CardContent>
        </Card>
        {!courseNodes.length && !settings.onboardingDismissed && (
          <section className="relative mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <button
              className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => updateSettings({ onboardingDismissed: true })}
              aria-label="Dölj startguiden"
              title="Dölj startguiden"
            >
              <X className="size-4" />
            </button>
            <h2 className="text-base font-semibold text-slate-900">
              Börja med din första föreläsning
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <OnboardingStep
                number="1"
                title="Skapa kurs"
                text="Lägg till kurs, modul och föreläsning."
                action="Öppna kurser"
                onClick={() => setActiveView("workspace")}
              />
              <OnboardingStep
                number="2"
                title="Lägg till material"
                text="Importera slides och ljud, eller spela in direkt."
                icon={FileUp}
              />
              <OnboardingStep
                number="3"
                title="Transkribera och repetera"
                text="Granska resultatet och skapa Anki-kort när du vill."
                icon={Sparkles}
              />
            </div>
          </section>
        )}
        <section className="grid grid-cols-3 gap-4">
          <Stat
            icon={BookOpen}
            label="Kurser"
            value={courseNodes.length}
            hint="i ditt bibliotek"
          />
          <Stat
            icon={FileText}
            label="Föreläsningar"
            value={lectureNodes.length}
            hint={`${Object.values(lectures).filter((x) => x.audioAssetId).length} med ljud`}
          />
          <Stat
            icon={CheckCircle2}
            label="Redo för Anki"
            value={approved}
            hint={`${cards.filter((x) => x.status === "synced").length} redan synkade`}
          />
        </section>
        <section className="mt-8 grid grid-cols-[1fr_320px] gap-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">
                Senaste föreläsningar
              </h2>
              <button
                onClick={() => setActiveView("workspace")}
                className="text-xs font-medium text-violet-600"
              >
                Visa kurser
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {recent.length ? (
                recent.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => {
                      selectNode(node.id);
                      setActiveView("workspace");
                    }}
                    className="group rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
                        <FileText className="size-4" />
                      </div>
                      <ArrowRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-500" />
                    </div>
                    <div className="mt-4 truncate text-sm font-semibold text-slate-800">
                      {node.title}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock3 className="size-3" />{" "}
                      {new Date(node.createdAt).toLocaleDateString("sv-SE")}
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-10 text-center text-sm text-slate-400">
                  Din senaste föreläsning kommer att visas här.
                </div>
              )}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Arbetsflöde
            </h2>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <Flow
                icon={Mic}
                title="Fånga"
                text="Spela in eller importera ljud"
              />
              <Flow
                icon={FileText}
                title="Förstå"
                text="Transkript, slides och markeringar"
              />
              <Flow
                icon={Sparkles}
                title="Repetera"
                text="Granska och synka Anki-kort"
                last
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function OnboardingStep({
  number,
  title,
  text,
  action,
  onClick,
  icon: Icon = BookOpen,
}: {
  number: string;
  title: string;
  text: string;
  action?: string;
  onClick?: () => void;
  icon?: typeof BookOpen;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-slate-50 p-4">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
        {number}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon className="size-4 text-violet-500" /> {title}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
        {action && onClick && (
          <button
            onClick={onClick}
            className="mt-3 text-xs font-medium text-violet-600 hover:text-violet-800"
          >
            {action} →
          </button>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  title,
  text,
  onClick,
}: {
  icon: typeof BookOpen;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card className="flex-row items-center gap-4 border border-border p-4 shadow-none">
      <div className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </div>
        <div className="text-xs font-medium text-muted-foreground">
          {label} <span className="font-normal">· {hint}</span>
        </div>
      </div>
    </Card>
  );
}
function Flow({
  icon: Icon,
  title,
  text,
  last,
}: {
  icon: typeof Mic;
  title: string;
  text: string;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      {!last && (
        <span className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-slate-200" />
      )}
      <div className="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
        <Icon className="size-3.5" />
      </div>
      <div>
        <div className="text-xs font-semibold text-slate-700">{title}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{text}</div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  Check,
  CheckCheck,
  Clipboard,
  Cloud,
  ExternalLink,
  FileJson,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../core/store";
import type { CardType, Flashcard } from "../../core/types";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select, Textarea } from "../../components/ui/Form";
import {
  createCardPrompt,
  generateCardsWithApi,
  parseCardResponse,
} from "../../services/ai";
import {
  ensureDeck,
  lectureDeckName,
  openAnkiDesktop,
  syncCard,
  testAnki,
  withoutStructuralTags,
} from "../../services/anki";
import { openExternal } from "../../services/platform";
import { toast } from "sonner";

const cardTypes: { id: CardType; label: string }[] = [
  { id: "basic", label: "Fråga / svar" },
  { id: "cloze", label: "Cloze" },
  { id: "concept", label: "Koncept" },
  { id: "definition", label: "Definition" },
  { id: "problem", label: "Problem" },
];

const generationPreferences = [
  "Undvik triviala frågor.",
  "Prioritera examinationsrelevant förståelse.",
  "Använd konkreta exempel när det hjälper.",
  "Håll svaren korta och precisa.",
] as const;

export function CardStudio() {
  const {
    nodes,
    lectures,
    segments,
    markers,
    cards,
    settings,
    selectedId,
    addCards,
    updateCard,
    removeCard,
    updateSettings,
    inheritedContext,
  } = useAppStore();
  const lecturesList = nodes.filter((n) => n.type === "lecture");
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const scopedLectureIds = useMemo(() => {
    if (!selectedNode || selectedNode.type === "workspace")
      return new Set(lecturesList.map((lecture) => lecture.id));
    const included = new Set<string>([selectedNode.id]);
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach((node) => {
        if (
          node.parentId &&
          included.has(node.parentId) &&
          !included.has(node.id)
        ) {
          included.add(node.id);
          changed = true;
        }
      });
    }
    return new Set(
      lecturesList
        .filter((lecture) => included.has(lecture.id))
        .map((lecture) => lecture.id),
    );
  }, [lecturesList, nodes, selectedNode]);
  const scopedLectures = lecturesList.filter((lecture) =>
    scopedLectureIds.has(lecture.id),
  );
  const initial =
    nodes.find((n) => n.id === selectedId)?.type === "lecture"
      ? selectedId
      : (lecturesList[0]?.id ?? "");
  const [selectedLectureId, setLectureId] = useState(initial);
  const lectureId = scopedLectureIds.has(selectedLectureId)
    ? selectedLectureId
    : (scopedLectures[0]?.id ?? "");
  const [count, setCount] = useState(20);
  const [types, setTypes] = useState<CardType[]>(["basic", "concept"]);
  const [sources, setSources] = useState({
    transcript: true,
    notes: true,
    markers: true,
    slides: true,
    context: true,
  });
  const [preferences, setPreferences] = useState<string[]>([
    generationPreferences[0],
    generationPreferences[1],
    generationPreferences[3],
  ]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [ankiHelpOpen, setAnkiHelpOpen] = useState(false);
  const [openingAnki, setOpeningAnki] = useState(false);
  const [response, setResponse] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<
    "all" | "generated" | "approved" | "synced"
  >("all");
  const node = nodes.find((n) => n.id === lectureId);
  const lecture = lectures[lectureId];
  const inheritedSettings = useMemo(() => {
    const chain = [];
    let current = nodes.find((item) => item.id === lectureId);
    while (current) {
      chain.unshift(current.settings);
      current = current.parentId
        ? nodes.find((item) => item.id === current?.parentId)
        : undefined;
    }
    return Object.assign({}, ...chain) as {
      language?: string;
      cardStyle?: string;
    };
  }, [nodes, lectureId]);
  const lectureCards = cards.filter(
    (c) =>
      c.lectureId === lectureId && (filter === "all" || c.status === filter),
  );
  const contextPreview = useMemo(
    () => [
      ...(settings.userContext.trim()
        ? [{ title: "Global Anki-context", context: settings.userContext }]
        : []),
      ...inheritedContext(lectureId).map(({ title, context }) => ({
        title,
        context,
      })),
    ],
    [lectureId, settings.userContext, inheritedContext],
  );
  const prompt = useMemo(
    () =>
      node
        ? createCardPrompt({
            lectureId,
            title: node.title,
            context: sources.context
              ? contextPreview
                  .map((item) => `${item.title}: ${item.context}`)
                  .join("\n\n")
              : "",
            notes: sources.notes ? (lecture?.notes ?? "") : "",
            transcript: sources.transcript
              ? segments.filter((x) => x.lectureId === lectureId)
              : [],
            markers: sources.markers
              ? markers.filter((x) => x.lectureId === lectureId)
              : [],
            slideText: sources.slides ? (lecture?.slideText ?? "") : "",
            count,
            types,
            preferences,
            cardStyle: inheritedSettings.cardStyle,
          })
        : "",
    [
      node,
      lectureId,
      lecture?.notes,
      lecture?.slideText,
      segments,
      markers,
      count,
      types,
      contextPreview,
      sources,
      preferences,
      inheritedSettings.cardStyle,
    ],
  );
  const importResponse = () => {
    try {
      const parsed = parseCardResponse(response, lectureId);
      const identity = (front: string, back: string) =>
        `${front}\u0000${back}`.replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const known = new Set(
        cards
          .filter((card) => card.lectureId === lectureId)
          .map((card) => identity(card.front, card.back)),
      );
      const unique = parsed.filter((card) => {
        const key = identity(card.front, card.back);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      if (!unique.length) {
        toast.error("Alla importerade kort är redan skapade för föreläsningen");
        return;
      }
      addCards(unique);
      setResponse("");
      setPromptOpen(false);
      const skipped = parsed.length - unique.length;
      toast.success(
        `${unique.length} kort importerade${skipped ? ` · ${skipped} dubbletter hoppades över` : ""}`,
      );
    } catch (e) {
      toast.error(`Svaret kunde inte läsas: ${String(e)}`);
    }
  };
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompten kopierades");
  };
  const generateApi = async () => {
    if (!apiKey) {
      toast.error("Ange en API-nyckel för denna session");
      return;
    }
    setBusy(true);
    try {
      const raw = await generateCardsWithApi(prompt, settings, apiKey);
      setResponse(raw);
      toast.success("AI-svaret är klart – granska och importera");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const syncApproved = async () => {
    const approved = cards.filter(
      (c) =>
        c.lectureId === lectureId &&
        (c.status === "approved" || c.status === "synced"),
    );
    if (!approved.length) return toast.error("Godkänn minst ett kort först");
    setBusy(true);
    try {
      await testAnki(settings.ankiUrl);
      const deck = await ensureDeck(
        settings.ankiUrl,
        lectureDeckName(nodes, lectureId, settings.defaultDeck),
      );
      let done = 0;
      const failed: string[] = [];
      let firstFailure = "";
      for (const card of approved) {
        try {
          const tags = [...new Set(withoutStructuralTags(card.tags))];
          const id = await syncCard(settings.ankiUrl, deck, { ...card, tags });
          updateCard(card.id, { status: "synced", ankiId: id, tags });
          done++;
        } catch (error) {
          failed.push(card.front);
          if (!firstFailure) {
            firstFailure =
              error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (done) toast.success(`${done} kort synkades till Anki`);
      if (failed.length)
        toast.error(
          `${failed.length} kort kunde inte synkas${firstFailure ? `: ${firstFailure}` : "."}`,
        );
    } catch {
      setAnkiHelpOpen(true);
    } finally {
      setBusy(false);
    }
  };
  const pasteResponse = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("Urklippet är tomt");
      setResponse(text);
      toast.success("AI-svaret hämtades från urklippet");
    } catch (error) {
      toast.error(`Kunde inte läsa urklippet: ${String(error)}`);
    }
  };
  const openAnki = async () => {
    setOpeningAnki(true);
    try {
      await openAnkiDesktop();
      toast.success(
        "Anki öppnas. Vänta tills AnkiConnect är redo och försök igen.",
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setOpeningAnki(false);
    }
  };
  if (!lecturesList.length || !scopedLectures.length)
    return (
      <div className="ui-app-bg grid flex-1 place-items-center">
        <div className="text-center">
          <Layers3 className="mx-auto size-10 text-slate-300" />
          <h2 className="mt-3 font-semibold text-slate-800">
            {lecturesList.length
              ? "Det finns inga föreläsningar under valt objekt"
              : "Skapa en föreläsning först"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Kort kopplas alltid till sin ursprungliga föreläsning.
          </p>
        </div>
      </div>
    );
  return (
    <div className="ui-app-bg flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Anki-kort</h1>
          <p className="text-xs text-slate-400">Generera, granska och synka</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={lectureId}
            onChange={(e) => setLectureId(e.target.value)}
            className="w-56"
          >
            {scopedLectures.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={syncApproved} disabled={busy}>
            <Send className="size-4" /> Synka godkända
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[330px_1fr] gap-px bg-slate-200">
        <aside className="overflow-auto bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Sparkles className="size-4 text-violet-500" /> Generera nya kort
          </div>
          <div className="mt-5">
            <Label>Antal kort: {count}</Label>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-2 w-full accent-violet-600"
            />
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Få</span>
              <span>Många</span>
            </div>
          </div>
          <div className="mt-5">
            <Label>Korttyper</Label>
            <div className="space-y-2">
              {cardTypes.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={types.includes(t.id)}
                    onChange={() =>
                      setTypes((x) =>
                        x.includes(t.id)
                          ? x.filter((v) => v !== t.id)
                          : [...x, t.id],
                      )
                    }
                    className="accent-violet-600"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            <div className="font-semibold text-slate-700">Källor</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  [
                    "transcript",
                    `Transkript (${segments.filter((x) => x.lectureId === lectureId).length})`,
                  ],
                  ["notes", "Anteckningar"],
                  ["markers", "Markeringar"],
                  ["slides", `Slide-text${lecture?.slideText ? " ✓" : ""}`],
                  ["context", "Ärvd kontext"],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-1.5"
                >
                  <input
                    type="checkbox"
                    checked={sources[id]}
                    onChange={() =>
                      setSources((current) => ({
                        ...current,
                        [id]: !current[id],
                      }))
                    }
                    className="accent-violet-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Förhandsgranska context som används
            </summary>
            <div className="mt-3 space-y-2 text-xs leading-5 text-slate-500">
              {sources.context && contextPreview.length ? (
                contextPreview.map((item) => (
                  <div key={item.title} className="rounded-lg bg-slate-50 p-2">
                    <div className="font-semibold text-slate-700">
                      {item.title}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {item.context}
                    </div>
                  </div>
                ))
              ) : (
                <p>
                  {sources.context
                    ? "Ingen global eller ärvd context har lagts till."
                    : "Context är avstängt i källvalen ovan."}
                </p>
              )}
            </div>
          </details>
          <div className="mt-4">
            <Label>Kvalitetsval</Label>
            <div className="space-y-2">
              {generationPreferences.map((preference) => (
                <label
                  key={preference}
                  className="flex cursor-pointer items-start gap-2 text-xs leading-4 text-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={preferences.includes(preference)}
                    onChange={() =>
                      setPreferences((current) =>
                        current.includes(preference)
                          ? current.filter((item) => item !== preference)
                          : [...current, preference],
                      )
                    }
                    className="mt-0.5 accent-violet-600"
                  />
                  {preference}
                </label>
              ))}
            </div>
          </div>
          <Button
            className="mt-5 w-full"
            disabled={!types.length}
            onClick={() => setPromptOpen(true)}
          >
            <Sparkles className="size-4" /> Fortsätt
          </Button>
        </aside>
        <main className="ui-app-bg min-w-0 overflow-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
              {(["all", "generated", "approved", "synced"] as const).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === f ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                  >
                    {f === "all"
                      ? "Alla"
                      : f === "generated"
                        ? "Nya"
                        : f === "approved"
                          ? "Godkända"
                          : "Synkade"}
                  </button>
                ),
              )}
            </div>
            <span className="text-xs text-slate-400">
              {lectureCards.length} kort
            </span>
          </div>
          <div className="grid gap-3">
            {lectureCards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                update={updateCard}
                remove={removeCard}
              />
            ))}
            {!lectureCards.length && (
              <div className="grid min-h-72 place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 text-center">
                <div>
                  <FileJson className="mx-auto size-9 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-600">
                    Inga kort här ännu
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Generera via copy/paste eller API.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <Dialog
        open={ankiHelpOpen}
        onOpenChange={setAnkiHelpOpen}
        title="Öppna Anki för att synka"
        description="Lectio kan inte nå AnkiConnect. Kontrollera att Anki Desktop är öppet och att tillägget AnkiConnect är installerat."
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void openAnki()}
            disabled={openingAnki}
          >
            {openingAnki ? "Öppnar…" : "Öppna Anki"}
          </Button>
          <Button
            onClick={() => {
              setAnkiHelpOpen(false);
              void syncApproved();
            }}
          >
            Försök igen
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        title="Generera Anki-kort"
        description="Copy/paste och API använder samma validerade kortformat."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => updateSettings({ aiMode: "clipboard" })}
              className={`rounded-xl border p-3 text-left transition ${settings.aiMode === "clipboard" ? "border-violet-500 bg-violet-50 ring-1 ring-violet-100" : "border-slate-200 hover:border-slate-300"}`}
            >
              <Clipboard className="size-4 text-violet-600" />
              <div className="mt-2 text-xs font-semibold text-slate-800">
                Copy/paste
              </div>
              <div className="text-[10px] text-slate-500">
                Standard · befintlig AI-tjänst
              </div>
            </button>
            <button
              onClick={() => updateSettings({ aiMode: "api" })}
              className={`rounded-xl border p-3 text-left transition ${settings.aiMode === "api" ? "border-violet-500 bg-violet-50 ring-1 ring-violet-100" : "border-slate-200 hover:border-slate-300"}`}
            >
              <Cloud className="size-4 text-slate-500" />
              <div className="mt-2 text-xs font-semibold">Eget API</div>
              <div className="text-[10px] text-slate-500">
                {settings.aiProvider} · {settings.aiModel}
              </div>
            </button>
          </div>
          {settings.aiMode === "clipboard" ? (
            <>
              <div>
                <Label>Färdig prompt</Label>
                <Textarea
                  readOnly
                  value={prompt}
                  className="h-36 font-mono text-[10px]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="min-w-40 flex-1"
                  onClick={copyPrompt}
                >
                  <Clipboard className="size-4" /> Kopiera prompt
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void openExternal("https://chatgpt.com")}
                  title="ChatGPT"
                >
                  <ExternalLink className="size-4" /> ChatGPT
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openExternal("https://claude.ai")}
                >
                  Claude
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openExternal("https://gemini.google.com")}
                >
                  Gemini
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-xs text-slate-500">
                {settings.aiProvider} · {settings.aiModel}. Nyckeln används bara
                för denna körning och sparas inte.
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API-nyckel"
                  className="flex-1"
                />
                <Button onClick={generateApi} disabled={busy || !apiKey}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}{" "}
                  Generera
                </Button>
              </div>
            </div>
          )}
          <div className="border-t border-slate-100 pt-4">
            <Label>
              {settings.aiMode === "clipboard"
                ? "Klistra in AI-svaret här"
                : "AI-svar för granskning"}
            </Label>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="h-28 font-mono text-[10px]"
              placeholder='{"cards":[…]}'
            />
            {settings.aiMode === "clipboard" && (
              <button
                onClick={() => void pasteResponse()}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800"
              >
                <Clipboard className="size-3.5" /> Hämta svar från urklippet
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!response.trim()}
              onClick={importResponse}
            >
              <Plus className="size-4" /> Validera och importera
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function CardRow({
  card,
  update,
  remove,
}: {
  card: Flashcard;
  update: (id: string, p: Partial<Flashcard>) => void;
  remove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateContent = (patch: Partial<Flashcard>) =>
    update(card.id, {
      ...patch,
      status: card.status === "synced" ? "approved" : card.status,
    });
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-4">
        <div
          className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full ${card.status === "synced" ? "bg-emerald-100 text-emerald-700" : card.status === "approved" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"}`}
        >
          {card.status === "synced" ? (
            <CheckCheck className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={card.front}
                onChange={(e) => updateContent({ front: e.target.value })}
              />
              <Textarea
                value={card.back}
                onChange={(e) => updateContent({ back: e.target.value })}
              />
              <div className="grid grid-cols-[150px_1fr] gap-2">
                <Select
                  value={card.type}
                  onChange={(event) =>
                    updateContent({ type: event.target.value as CardType })
                  }
                >
                  {cardTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={card.tags.join(", ")}
                  onChange={(event) =>
                    updateContent({
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Taggar, separerade med komma"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold text-slate-800">
                {card.front}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-600">
                {card.back}
              </div>
            </>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500">
              {card.type}
            </span>
            {card.tags.map((t) => (
              <span key={t} className="text-[10px] text-slate-400">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditing(!editing)}
          >
            {editing ? (
              <Check className="size-4" />
            ) : (
              <Pencil className="size-4" />
            )}
          </Button>
          {card.status === "generated" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => update(card.id, { status: "approved" })}
            >
              Godkänn
            </Button>
          )}{" "}
          {card.status === "approved" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update(card.id, { status: "generated" })}
            >
              <RefreshCw className="size-3.5" /> Ångra
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => remove(card.id)}>
            <Trash2 className="size-4 text-slate-400" />
          </Button>
        </div>
      </div>
    </article>
  );
}

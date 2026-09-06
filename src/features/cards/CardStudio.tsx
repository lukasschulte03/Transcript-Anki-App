import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
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
import { db } from "../../core/database";
import type { CardType, Flashcard } from "../../core/types";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select, Textarea } from "../../components/ui/Form";
import {
  createCardPrompt,
  duplicateExplanation,
  generateCardsWithApi,
  parseCardResponse,
  likelyDuplicate,
} from "../../services/ai";
import {
  ensureDeck,
  deleteNote,
  lectureDeckName,
  needsAnkiSync,
  openAnkiDesktop,
  syncCard,
  testAnki,
  withoutStructuralTags,
} from "../../services/anki";
import { openExternal } from "../../services/platform";
import {
  deleteCredential,
  readCredential,
  writeCredential,
} from "../../services/credentials";
import { toast } from "../../services/feedbackToast";

function courseIdForLecture(
  nodes: ReturnType<typeof useAppStore.getState>["nodes"],
  lectureId: string,
) {
  let current = nodes.find((node) => node.id === lectureId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.type === "course") return current.id;
    visited.add(current.id);
    current = current.parentId
      ? nodes.find((node) => node.id === current!.parentId)
      : undefined;
  }
  return undefined;
}

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
    updateLecture,
    removeCard,
    pendingAnkiDeletions,
    resolveAnkiNoteDeletion,
    markAnkiNoteDeletionError,
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
  // Navigation in the library decides which lecture is in focus. Keeping a
  // second picker here made the current view and the selected library item
  // disagree, especially when switching course or module.
  const lectureId =
    selectedNode?.type === "lecture" && scopedLectureIds.has(selectedNode.id)
      ? selectedNode.id
      : (scopedLectures[0]?.id ?? "");
  const [density, setDensity] = useState<"few" | "balanced" | "many">("balanced");
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
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [savedApiKey, setSavedApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<
    "all" | "generated" | "approved" | "synced"
  >("all");
  const credentialKey = `ai:${settings.aiProvider}`;
  useEffect(() => {
    let cancelled = false;
    if (settings.aiMode !== "api") return;
    void readCredential(credentialKey)
      .then((secret) => {
        if (cancelled) return;
        setSavedApiKey(Boolean(secret));
        if (secret) setApiKey(secret);
      })
      .catch(() => {
        if (!cancelled) setSavedApiKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialKey, settings.aiMode]);
  const node = nodes.find((n) => n.id === lectureId);
  const lecture = lectures[lectureId];
  const courseId = useMemo(
    () => courseIdForLecture(nodes, lectureId),
    [nodes, lectureId],
  );
  const courseCards = useMemo(
    () =>
      cards.filter(
        (card) =>
          courseId
            ? courseIdForLecture(nodes, card.lectureId) === courseId
            : card.lectureId === lectureId,
      ),
    [cards, courseId, lectureId, nodes],
  );
  const currentDeck = lectureDeckName(nodes, lectureId, settings.defaultDeck);
  const pendingSyncCount = cards.filter(
    (card) =>
      card.lectureId === lectureId &&
      (card.ankiSyncError ||
        ((card.status === "approved" || card.status === "synced") &&
          needsAnkiSync(card, currentDeck))),
  ).length +
    pendingAnkiDeletions.filter((pending) => pending.lectureId === lectureId)
      .length;
  const syncStatuses = useMemo(
    () =>
      scopedLectures.map((lectureNode) => {
        const deck = lectureDeckName(nodes, lectureNode.id, settings.defaultDeck);
        const lectureCards = cards.filter((card) => card.lectureId === lectureNode.id);
        const pendingCards = lectureCards.filter(
          (card) =>
            card.ankiSyncError ||
            ((card.status === "approved" || card.status === "synced") &&
              needsAnkiSync(card, deck)),
        );
        const pendingDeletions = pendingAnkiDeletions.filter(
          (deletion) => deletion.lectureId === lectureNode.id,
        );
        const errors = [
          ...lectureCards
            .filter((card) => card.ankiSyncError)
            .map((card) => ({
              message: card.ankiSyncError!,
              at: card.ankiSyncErrorAt ?? "",
            })),
          ...pendingDeletions
            .filter((deletion) => deletion.error)
            .map((deletion) => ({ message: deletion.error!, at: deletion.updatedAt ?? "" })),
        ].sort((left, right) => right.at.localeCompare(left.at));
        return {
          lecture: lectureNode,
          pending: pendingCards.length + pendingDeletions.length,
          lastSyncedAt: lectures[lectureNode.id]?.ankiLastSyncedAt,
          lastError: errors[0],
        };
      }),
    [cards, lectures, nodes, pendingAnkiDeletions, scopedLectures, settings.defaultDeck],
  );
  const contextNodeIds = useMemo(() => {
    const chain: string[] = [];
    let current = nodes.find((item) => item.id === lectureId);
    while (current) {
      chain.unshift(current.id);
      current = current.parentId
        ? nodes.find((item) => item.id === current?.parentId)
        : undefined;
    }
    return chain;
  }, [lectureId, nodes]);
  const contextNodeKey = contextNodeIds.join(":");
  const contextFiles = useLiveQuery(
    () => db.assets.where("nodeId").anyOf(contextNodeIds).toArray(),
    [contextNodeKey],
  );
  const [excludedContextFileIds, setExcludedContextFileIds] = useState<
    string[]
  >([]);
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
  const generatedCards = cards.filter(
    (card) => card.lectureId === lectureId && card.status === "generated",
  );
  const scopedGeneratedCards = cards.filter(
    (card) => scopedLectureIds.has(card.lectureId) && card.status === "generated",
  );
  const approvedCards = cards.filter(
    (card) => card.lectureId === lectureId && card.status === "approved",
  );
  const isBulkScope = selectedNode?.type === "course" || selectedNode?.type === "module";
  const approveAllGenerated = () => {
    if (!generatedCards.length) return;
    generatedCards.forEach((card) =>
      updateCard(card.id, { status: "approved" }),
    );
    toast.success(`${generatedCards.length} kort godkändes`);
  };
  const approveAllScopedGenerated = () => {
    if (!scopedGeneratedCards.length) return;
    const scopeLabel = selectedNode?.type === "course" ? "kursen" : "modulen";
    if (!confirm(`Godkänn ${scopedGeneratedCards.length} nya kort i ${scopeLabel}?`)) return;
    scopedGeneratedCards.forEach((card) => updateCard(card.id, { status: "approved" }));
    toast.success(`${scopedGeneratedCards.length} kort godkändes i ${scopeLabel}`);
  };
  const syncScopedWithPreview = () => {
    const scopeLabel = selectedNode?.type === "course" ? "kursen" : "modulen";
    const scoped = cards.filter(
      (card) =>
        scopedLectureIds.has(card.lectureId) &&
        (card.status === "approved" || card.status === "synced"),
    );
    const pending = scoped.filter(
      (card) =>
        card.ankiSyncError ||
        needsAnkiSync(
          card,
          lectureDeckName(nodes, card.lectureId, settings.defaultDeck),
        ),
    );
    const pendingDeletions = pendingAnkiDeletions.filter((deletion) =>
      deletion.lectureId ? scopedLectureIds.has(deletion.lectureId) : false,
    );
    if (
      !confirm(
        `Synka ${scopeLabel}?\\n\\n${scopedLectureIds.size} föreläsningar · ${scoped.length} godkända/synkade kort · ${pending.length} väntande ändringar · ${pendingDeletions.length} väntande borttagningar.${pendingDeletions.length ? `\\n\\nAnki-noter som tas bort:\\n${pendingDeletions.map((deletion) => `Anki-ID ${deletion.ankiId}`).join("\\n")}` : ""}\\n\\nBara dessa objekt påverkas i Anki.`,
      )
    )
      return;
    void syncApproved(false, scopedLectureIds, false);
  };
  const undoAllApproved = () => {
    if (!approvedCards.length) return;
    approvedCards.forEach((card) =>
      updateCard(card.id, { status: "generated" }),
    );
    toast.success(`${approvedCards.length} godkännanden ångrades`);
  };
  const deleteVisibleCards = () => {
    if (!lectureCards.length) return;
    if (
      !window.confirm(
        `Ta bort ${lectureCards.length} visade kort? Detta kan inte ångras.`,
      )
    )
      return;
    lectureCards.forEach((card) => removeCard(card.id));
    toast.success(`${lectureCards.length} kort togs bort`);
  };
  const includedContextFiles = (contextFiles ?? []).filter(
    (file) =>
      file.extractedText?.trim() && !excludedContextFileIds.includes(file.id),
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
      ...includedContextFiles.map((file) => ({
        title: `${nodes.find((item) => item.id === file.nodeId)?.title ?? "Context"} · ${file.name}`,
        context: file.extractedText?.trim() ?? "",
      })),
    ],
    [
      lectureId,
      settings.userContext,
      inheritedContext,
      includedContextFiles,
      nodes,
    ],
  );
  const contextTokenEstimate = Math.ceil(
    contextPreview.reduce((total, item) => total + item.context.length, 0) / 4,
  );
  const cardLimit = density === "few" ? 16 : density === "balanced" ? 36 : 64;
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
            density,
            count: cardLimit,
            types,
            preferences,
            cardStyle: inheritedSettings.cardStyle,
            existingCards: courseCards.map(({ front, back }) => ({ front, back })),
          })
        : "",
    [
      node,
      lectureId,
      lecture?.notes,
      lecture?.slideText,
      segments,
      markers,
      density,
      types,
      contextPreview,
      sources,
      preferences,
      inheritedSettings.cardStyle,
      courseCards,
      cardLimit,
    ],
  );
  const importResponse = () => {
    try {
      const parsed = parseCardResponse(response, lectureId).slice(0, cardLimit);
      const identity = (front: string, back: string) =>
        `${front}\u0000${back}`.replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const known = new Set(courseCards.map((card) => identity(card.front, card.back)));
      const unique = parsed.filter((card) => {
        const key = identity(card.front, card.back);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      if (!unique.length) {
        toast.error("Alla importerade kort finns redan i den här kursen");
        return;
      }
      const addedIds = addCards(unique);
      unique.forEach((card, index) => {
        const earlierImported = unique.slice(0, index).map((candidate, candidateIndex) => ({
          ...candidate,
          id: addedIds[candidateIndex],
        }));
        const similar = likelyDuplicate(card.front, [...courseCards, ...earlierImported]);
        if (!similar) return;
        const terms = duplicateExplanation(card.front, similar);
        updateCard(addedIds[index], {
          duplicateWarning: `Liknar “${similar.front}”${terms ? ` · Gemensamma begrepp: ${terms}` : ""}`,
          duplicateOfId: similar.id,
        });
      });
      setResponse("");
      setPromptOpen(false);
      const skipped = parsed.length - unique.length;
      toast.success(
        `${unique.length} kort importerade${skipped ? ` · ${skipped} exakta dubbletter hoppades över` : ""}`,
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
      if (rememberApiKey) {
        await writeCredential(credentialKey, apiKey);
        setSavedApiKey(true);
      } else if (savedApiKey) {
        await deleteCredential(credentialKey);
        setSavedApiKey(false);
      }
      const raw = await generateCardsWithApi(prompt, settings, apiKey);
      setResponse(raw);
      toast.success("AI-svaret är klart – granska och importera");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  const syncApproved = async (
    onlyPending = false,
    targetLectureIds = new Set([lectureId]),
    confirmDeletions = true,
  ) => {
    const eligibleCards = cards.filter(
      (c) =>
        targetLectureIds.has(c.lectureId) &&
        (c.status === "approved" || c.status === "synced"),
    );
    const pendingDeletions = pendingAnkiDeletions.filter((deletion) =>
      deletion.lectureId ? targetLectureIds.has(deletion.lectureId) : false,
    );
    if (!eligibleCards.length && !pendingDeletions.length)
      return toast.error("Godkänn minst ett kort först");
    if (
      confirmDeletions &&
      pendingDeletions.length &&
      !confirm(
        `Synken tar bort ${pendingDeletions.length} väntande Anki-not${pendingDeletions.length === 1 ? "ering" : "eringar"}.\n\n${pendingDeletions.map((deletion) => `Anki-ID ${deletion.ankiId}`).join("\n")}`,
      )
    )
      return;
    setBusy(true);
    try {
      await testAnki(settings.ankiUrl);
      let deleted = 0;
      let deletionFailure = "";
      for (const deletion of pendingDeletions) {
        try {
          await deleteNote(settings.ankiUrl, deletion.ankiId);
          resolveAnkiNoteDeletion(deletion.ankiId);
          deleted++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          markAnkiNoteDeletionError(deletion.ankiId, message);
          if (!deletionFailure) deletionFailure = message;
        }
      }
      const decks = new Map<string, string>();
      const deckFor = async (id: string) => {
        const known = decks.get(id);
        if (known) return known;
        const deck = await ensureDeck(settings.ankiUrl, lectureDeckName(nodes, id, settings.defaultDeck));
        decks.set(id, deck);
        return deck;
      };
      const cardsToSync = eligibleCards.filter((card) =>
        card.status === "approved" || card.ankiSyncError || !card.ankiId || card.ankiDeck !== lectureDeckName(nodes, card.lectureId, settings.defaultDeck),
      );
      let done = 0;
      const failed: string[] = [];
      let firstFailure = "";
      for (const card of cardsToSync) {
        try {
          const deck = await deckFor(card.lectureId);
          if (onlyPending && !needsAnkiSync(card, deck) && !card.ankiSyncError) continue;
          const tags = [...new Set(withoutStructuralTags(card.tags))];
          const id = await syncCard(settings.ankiUrl, deck, { ...card, tags });
          updateCard(card.id, {
            status: "synced",
            ankiId: id,
            ankiDeck: deck,
            tags,
            ankiSyncError: undefined,
            ankiSyncErrorAt: undefined,
            ankiSyncedAt: new Date().toISOString(),
          });
          done++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          updateCard(card.id, {
            ankiSyncError: message,
            ankiSyncErrorAt: new Date().toISOString(),
          });
          failed.push(card.front);
          if (!firstFailure) {
            firstFailure = message;
          }
        }
      }
      if (done || deleted)
        toast.success(
          [done ? `${done} kort synkades` : "", deleted ? `${deleted} kort togs bort` : ""]
            .filter(Boolean)
            .join(" · ") + " i Anki",
        );
      if (!done && !deleted && !failed.length && !deletionFailure)
        toast.message("Anki är redan uppdaterat");
      if (failed.length)
        toast.error(
          `${failed.length} kort kunde inte synkas${firstFailure ? `: ${firstFailure}` : "."}`,
        );
      if (deletionFailure)
        toast.error(`Ett borttaget kort kunde inte tas bort i Anki: ${deletionFailure}`);
      if (done || deleted)
        targetLectureIds.forEach((id) => updateLecture(id, { ankiLastSyncedAt: new Date().toISOString() }));
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
          {pendingSyncCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => void syncApproved(true)} disabled={busy}>
              Försök igen ({pendingSyncCount})
            </Button>
          )}
          <Button variant="secondary" onClick={() => void syncApproved()} disabled={busy}>
            <Send className="size-4" /> Synka godkända
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[330px_1fr] gap-px bg-slate-200">
        <aside className="overflow-auto bg-white p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Sparkles className="size-4 text-violet-500" /> Generera nya kort
          </div>
          <div className="mt-5">
            <Label>Hur omfattande ska repetitionen vara?</Label>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
              {([['few', 'Få'], ['balanced', 'Lagom'], ['many', 'Många']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setDensity(value)} className={`rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${density === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">AI:n avgör hur många kort materialet motiverar och undviker utfyllnad.</p>
          </div>
          <details className="mt-5 rounded-lg border border-border bg-card px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Avancerat: korttyper, källor och kvalitetsval</summary>
            <div className="pt-1">
          <div className="mt-6">
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
              {sources.context && (contextFiles?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-2">
                  <div className="mb-1 font-semibold text-[var(--palette-text)]">
                    Bifogade filer
                  </div>
                  {(contextFiles ?? []).map((file) => {
                    const available = Boolean(file.extractedText?.trim());
                    const included =
                      available && !excludedContextFileIds.includes(file.id);
                    return (
                      <label
                        key={file.id}
                        className="flex cursor-pointer items-center gap-2 py-0.5 text-[var(--palette-text-muted)]"
                      >
                        <input
                          type="checkbox"
                          checked={included}
                          disabled={!available}
                          onChange={() =>
                            setExcludedContextFileIds((current) =>
                              current.includes(file.id)
                                ? current.filter((id) => id !== file.id)
                                : [...current, file.id],
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-[var(--palette-text-subtle)]">
                          {available
                            ? `${Math.ceil((file.extractedText?.length ?? 0) / 4).toLocaleString("sv-SE")} tokens`
                            : "Ingen text"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {sources.context && contextTokenEstimate > 12_000 && (
                <p className="rounded-lg bg-[var(--palette-warning-muted)] px-2 py-1.5 text-[var(--palette-warning)]">
                  Den valda contexten är ungefär {contextTokenEstimate.toLocaleString("sv-SE")} tokens. Mycket material skickas till vald AI-tjänst när du genererar.
                </p>
              )}
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
            </div>
          </details>
          <Button
            className="mt-6 w-full"
            disabled={!types.length}
            onClick={() => setPromptOpen(true)}
          >
            <Sparkles className="size-4" /> Fortsätt
          </Button>
        </aside>
        <main className="ui-app-bg min-w-0 overflow-auto p-6">
          <details
            className="mb-4 rounded-lg border border-border bg-card"
            open={syncStatuses.some((status) => status.pending || status.lastError)}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
              Anki-synkstatus
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {syncStatuses.reduce((total, status) => total + status.pending, 0)} väntande
              </span>
            </summary>
            <div className="border-t border-border">
              {syncStatuses.map((status) => (
                <div key={status.lecture.id} className="grid gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(10rem,1fr)_auto_auto] sm:items-center sm:gap-4">
                  <span className="truncate text-sm font-medium text-foreground">{status.lecture.title}</span>
                  <span className={status.pending ? "text-xs text-[var(--palette-warning)]" : "text-xs text-muted-foreground"}>
                    {status.pending ? `${status.pending} väntande` : "Inga väntande ändringar"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {status.lastSyncedAt
                      ? `Senast synkad ${new Date(status.lastSyncedAt).toLocaleString("sv-SE")}`
                      : "Aldrig synkad"}
                  </span>
                  {status.lastError && (
                    <p className="sm:col-span-3 text-xs leading-5 text-destructive" title={status.lastError.message}>
                      Senaste fel: {status.lastError.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
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
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {isBulkScope && (
              <Button
                variant="secondary"
                size="sm"
                onClick={approveAllScopedGenerated}
                disabled={!scopedGeneratedCards.length}
              >
                <CheckCheck className="size-3.5" /> Godkänn alla i {selectedNode?.type === "course" ? "kursen" : "modulen"}
                {scopedGeneratedCards.length ? ` (${scopedGeneratedCards.length})` : ""}
              </Button>
            )}
            {isBulkScope && (
              <Button
                variant="outline"
                size="sm"
                onClick={syncScopedWithPreview}
                disabled={busy}
              >
                <Send className="size-3.5" /> Synka godkända i {selectedNode?.type === "course" ? "kursen" : "modulen"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={approveAllGenerated}
              disabled={!generatedCards.length}
            >
              <CheckCheck className="size-3.5" /> Godkänn alla nya
              {generatedCards.length ? ` (${generatedCards.length})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={undoAllApproved}
              disabled={!approvedCards.length}
            >
              <RefreshCw className="size-3.5" /> Ångra godkända
              {approvedCards.length ? ` (${approvedCards.length})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteVisibleCards}
              disabled={!lectureCards.length}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Radera visade
            </Button>
          </div>
          <div className="grid gap-3">
            {lectureCards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              update={updateCard}
              remove={removeCard}
              cards={cards}
              />
            ))}
            {!lectureCards.length && (
              <div className="grid min-h-72 place-items-center rounded-xl border-2 border-dashed border-slate-200 bg-white/50 text-center">
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
              <div className="text-xs text-slate-500">
                Standard · befintlig AI-tjänst
              </div>
            </button>
            <button
              onClick={() => updateSettings({ aiMode: "api" })}
              className={`rounded-xl border p-3 text-left transition ${settings.aiMode === "api" ? "border-violet-500 bg-violet-50 ring-1 ring-violet-100" : "border-slate-200 hover:border-slate-300"}`}
            >
              <Cloud className="size-4 text-slate-500" />
              <div className="mt-2 text-xs font-semibold">Eget API</div>
              <div className="text-xs text-slate-500">
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
                  className="h-36 font-mono text-xs"
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
                {settings.aiProvider} · {settings.aiModel}. Nyckeln sparas bara
                om du väljer det nedan, i Windows Credential Manager.
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
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberApiKey}
                    onChange={(event) =>
                      setRememberApiKey(event.target.checked)
                    }
                  />
                  Kom ihåg nyckeln säkert på den här datorn
                </label>
                {savedApiKey && (
                  <button
                    type="button"
                    className="font-medium text-violet-700 hover:text-violet-900"
                    onClick={async () => {
                      await deleteCredential(credentialKey);
                      setApiKey("");
                      setSavedApiKey(false);
                      toast.success("Den sparade API-nyckeln togs bort");
                    }}
                  >
                    Glöm sparad nyckel
                  </button>
                )}
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
              className="h-28 font-mono text-xs"
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
  cards,
}: {
  card: Flashcard;
  update: (id: string, p: Partial<Flashcard>) => void;
  remove: (id: string) => void;
  cards: Flashcard[];
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
          {card.duplicateWarning && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-[var(--palette-warning-muted)] px-2.5 py-2 text-xs text-[var(--palette-warning)]">
              <span>{card.duplicateWarning}</span>
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => update(card.id, { duplicateWarning: undefined, duplicateOfId: undefined })}>Behåll ändå</button>
              {card.duplicateOfId && cards.some((candidate) => candidate.id === card.duplicateOfId) && (
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => {
                  const original = cards.find((candidate) => candidate.id === card.duplicateOfId);
                  if (!original) return;
                  update(original.id, { back: original.back.trim() === card.back.trim() ? original.back : `${original.back}\n\n${card.back}` });
                  remove(card.id);
                }}>Slå ihop</button>
              )}
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => remove(card.id)}>Radera nya</button>
            </div>
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
            <span className="text-xs font-medium text-slate-500">
              {card.type}
            </span>
            {card.tags.map((t) => (
              <span key={t} className="text-xs text-slate-400">
                #{t}
              </span>
            ))}
          </div>
          {card.ankiSyncError && (
            <p className="mt-2 text-xs leading-5 text-[var(--palette-danger)]">
              Synkfel: {card.ankiSyncError}
            </p>
          )}
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

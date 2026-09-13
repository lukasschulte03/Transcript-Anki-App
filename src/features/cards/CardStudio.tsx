/* oxlint-disable react/set-state-in-effect, react-hooks/exhaustive-deps -- derived prompt state deliberately resets per source and uses an explicit dependency budget. */
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  CheckCheck,
  Clipboard,
  Cloud,
  ExternalLink,
  FileJson,
  Image,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  AudioLines,
  FileText,
  Presentation,
} from "lucide-react";
import { useAppStore } from "../../core/store";
import { db } from "../../core/database";
import {
  resolveCardGenerationSettings,
  type CardGenerationSettings,
  type CardType,
  type Flashcard,
} from "../../core/types";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SourceSummary } from "../../components/WorkspacePatterns";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Label, Select, Textarea } from "../../components/ui/Form";
import {
  createCardPrompt,
  cardPromptSummary,
  cardResponseErrorMessage,
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
import { useStoredCredential } from "../../hooks/useStoredCredential";
import { toast } from "../../services/feedbackToast";
import {
  chunkCardCeiling,
  planGenerationChunks,
  type GenerationChunk,
} from "../../services/ankiChunking";
import {
  CARD_GENERATION_PRICE_CATALOG_VERSION,
  estimateCardGenerationCost,
  estimateCardOutputTokens,
  formatCardGenerationCost,
} from "../../services/cardGenerationCost";
import {
  moduleVisualCandidates,
  resolveVisualMedia,
  selectVisualCandidates,
} from "../../services/visualIndex";

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

function moduleIdForLecture(
  nodes: ReturnType<typeof useAppStore.getState>["nodes"],
  lectureId: string,
) {
  let current = nodes.find((node) => node.id === lectureId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.type === "module") return current.id;
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
    setActiveView,
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
  const savedGeneration = resolveCardGenerationSettings(settings.cardGeneration);
  const [density, setDensity] = useState<"few" | "balanced" | "many">(
    () => savedGeneration.density,
  );
  const [types, setTypes] = useState<CardType[]>(() => savedGeneration.types);
  const [sources, setSources] = useState(() => savedGeneration.sources);
  const [preferences, setPreferences] = useState<string[]>(
    () => savedGeneration.preferences,
  );
  const [promptOpen, setPromptOpen] = useState(false);
  const [ankiHelpOpen, setAnkiHelpOpen] = useState(false);
  const [openingAnki, setOpeningAnki] = useState(false);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [clipboardChunkIndex, setClipboardChunkIndex] = useState(0);
  const [filter, setFilter] = useState<
    "all" | "generated" | "approved" | "synced"
  >("all");
  const credentialKey = `ai:${settings.aiProvider}`;
  const {
    credential: apiKey,
    configured: apiKeyConfigured,
    loading: apiKeyLoading,
  } = useStoredCredential(credentialKey, settings.aiMode === "api");
  const node = nodes.find((n) => n.id === lectureId);
  const lecture = lectures[lectureId];
  const moduleId = useMemo(
    () => moduleIdForLecture(nodes, lectureId),
    [nodes, lectureId],
  );
  const moduleVisuals = useMemo(
    () =>
      moduleId
        ? moduleVisualCandidates(nodes, lectures, moduleId)
        : (lecture?.visualIndex ?? []).map((candidate) => ({
            ...candidate,
            lectureId,
            lectureTitle: node?.title ?? "Föreläsning",
            moduleId: "",
          })),
    [lecture?.visualIndex, lectureId, lectures, moduleId, node?.title, nodes],
  );
  const visualSources = useMemo(
    () => new Map(moduleVisuals.map((candidate) => [candidate.id, candidate.lectureId])),
    [moduleVisuals],
  );
  const rankedModuleVisuals = useMemo(
    () =>
      [...moduleVisuals].sort(
        (left, right) =>
          Number(right.lectureId === lectureId) - Number(left.lectureId === lectureId) ||
          left.slidePage - right.slidePage,
      ),
    [lectureId, moduleVisuals],
  );
  const courseId = useMemo(
    () => courseIdForLecture(nodes, lectureId),
    [nodes, lectureId],
  );
  const courseCards = useMemo(
    () =>
      cards.filter((card) =>
        courseId
          ? courseIdForLecture(nodes, card.lectureId) === courseId
          : card.lectureId === lectureId,
      ),
    [cards, courseId, lectureId, nodes],
  );
  const currentDeck = lectureDeckName(nodes, lectureId, settings.defaultDeck);
  const pendingSyncCount =
    cards.filter(
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
        const deck = lectureDeckName(
          nodes,
          lectureNode.id,
          settings.defaultDeck,
        );
        const lectureCards = cards.filter(
          (card) => card.lectureId === lectureNode.id,
        );
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
            .map((deletion) => ({
              message: deletion.error!,
              at: deletion.updatedAt ?? "",
            })),
        ].sort((left, right) => right.at.localeCompare(left.at));
        return {
          lecture: lectureNode,
          pending: pendingCards.length + pendingDeletions.length,
          lastSyncedAt: lectures[lectureNode.id]?.ankiLastSyncedAt,
          lastError: errors[0],
        };
      }),
    [
      cards,
      lectures,
      nodes,
      pendingAnkiDeletions,
      scopedLectures,
      settings.defaultDeck,
    ],
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
  const [contextLevels, setContextLevels] = useState(
    () => savedGeneration.contextLevels,
  );
  const updateGenerationDefaults = (
    patch: Partial<CardGenerationSettings>,
  ) => {
    const current = resolveCardGenerationSettings(settings.cardGeneration);
    updateSettings({
      cardGeneration: {
        ...current,
        ...patch,
        sources: { ...current.sources, ...patch.sources },
        contextLevels: { ...current.contextLevels, ...patch.contextLevels },
      },
    });
  };
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
    (card) =>
      scopedLectureIds.has(card.lectureId) && card.status === "generated",
  );
  const approvedCards = cards.filter(
    (card) => card.lectureId === lectureId && card.status === "approved",
  );
  const isBulkScope =
    selectedNode?.type === "course" || selectedNode?.type === "module";
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
    if (
      !confirm(
        `Godkänn ${scopedGeneratedCards.length} nya kort i ${scopeLabel}?`,
      )
    )
      return;
    scopedGeneratedCards.forEach((card) =>
      updateCard(card.id, { status: "approved" }),
    );
    toast.success(
      `${scopedGeneratedCards.length} kort godkändes i ${scopeLabel}`,
    );
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
        ? [
            {
              title: "Global Anki-context",
              context: settings.userContext,
              type: "global" as const,
            },
          ]
        : []),
      ...inheritedContext(lectureId).map(({ title, context, type }) => ({
        title,
        context,
        type,
      })),
      ...includedContextFiles.map((file) => ({
        title: `${nodes.find((item) => item.id === file.nodeId)?.title ?? "Context"} · ${file.name}`,
        context: file.extractedText?.trim() ?? "",
        type: nodes.find((item) => item.id === file.nodeId)?.type ?? "lecture",
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
  const selectedContextPreview = contextPreview.filter(
    (item) => contextLevels[item.type as keyof typeof contextLevels],
  );
  const cardLimit = density === "few" ? 16 : density === "balanced" ? 36 : 64;
  const selectedTranscript = useMemo(
    () =>
      sources.transcript
        ? segments.filter((segment) => segment.lectureId === lectureId)
        : [],
    [lectureId, segments, sources.transcript],
  );
  const generationChunks = useMemo(
    () => planGenerationChunks(selectedTranscript),
    [selectedTranscript],
  );
  const activeChunk =
    generationChunks[Math.min(clipboardChunkIndex, generationChunks.length - 1)];
  useEffect(() => {
    setClipboardChunkIndex(0);
  }, [lectureId, sources.transcript]);
  const sourceStatus = useMemo(() => {
    const lectureTranscript = segments.filter(
      (segment) => segment.lectureId === lectureId,
    );
    const transcriptEnd = lectureTranscript.reduce(
      (latest, segment) => Math.max(latest, segment.end),
      0,
    );
    const audioDuration = lecture?.audioDuration ?? 0;
    const transcriptCoverage = !sources.transcript
      ? "Transkript: inte valt."
      : !lectureTranscript.length
        ? "Transkript: inget tillgängligt; använd övriga valda källor självständigt."
        : audioDuration > 0 && transcriptEnd < audioDuration * 0.98
          ? `Transkript: delvis, täcker ungefär ${Math.floor(transcriptEnd / 60)} av ${Math.ceil(audioDuration / 60)} minuter.`
          : "Transkript: valt underlag.";
    return [
      transcriptCoverage,
      sources.slides
        ? lecture?.slideText?.trim()
          ? "Slides: komplett tillgänglig slide-text är vald och kan ge egna kort."
          : "Slides: valda, men ingen läsbar slide-text finns."
        : "Slides: inte valda.",
      sources.notes
        ? lecture?.notes?.trim()
          ? "Anteckningar: valt underlag."
          : "Anteckningar: valda, men tomma."
        : "Anteckningar: inte valda.",
      sources.context ? "Context: valt underlag." : "Context: inte valt.",
    ].join("\n");
  }, [
    lecture?.audioDuration,
    lecture?.notes,
    lecture?.slideText,
    lectureId,
    segments,
    sources,
  ]);
  const promptForChunk = (chunk: GenerationChunk) =>
    node
      ? createCardPrompt({
          lectureId,
          title: node.title,
          context: sources.context
            ? selectedContextPreview
                .map((item) => `${item.title}: ${item.context}`)
                .join("\n\n")
            : "",
          sourceStatus:
            chunk.total > 1
              ? `${sourceStatus}\nBearbeta del ${chunk.index + 1} av ${chunk.total}. Skapa bara kort från denna transkriptdel, men använd slides och anteckningar för sammanhang.`
              : sourceStatus,
          notes: sources.notes ? (lecture?.notes ?? "") : "",
          transcript: chunk.transcript,
          markers: sources.markers
            ? markers.filter((x) => x.lectureId === lectureId)
            : [],
          slideText: sources.slides ? (lecture?.slideText ?? "") : "",
          visualCandidates: sources.slides
            ? selectVisualCandidates(
                rankedModuleVisuals,
                `${chunk.transcript.map((segment) => segment.text).join("\n")}\n${lecture?.notes ?? ""}`,
              )
            : [],
          density,
          count: chunkCardCeiling(cardLimit, chunk),
          types,
          preferences,
          cardStyle: inheritedSettings.cardStyle,
          existingCards: courseCards.map(({ front, back }) => ({ front, back })),
        })
      : "";
  const prompt = useMemo(
    () => promptForChunk(activeChunk),
    [
      node,
      lectureId,
      lecture?.notes,
      lecture?.slideText,
      markers,
      density,
      types,
      selectedContextPreview,
      sources,
      preferences,
      inheritedSettings.cardStyle,
      courseCards,
      cardLimit,
      sourceStatus,
      activeChunk,
    ],
  );
  const promptBudget = useMemo(
    () =>
      cardPromptSummary({
        lectureId,
        title: node?.title ?? "",
        context: sources.context
          ? selectedContextPreview
              .map((item) => `${item.title}: ${item.context}`)
              .join("\n\n")
          : "",
        sourceStatus,
        notes: sources.notes ? (lecture?.notes ?? "") : "",
        transcript: activeChunk.transcript,
        markers: sources.markers
          ? markers.filter((item) => item.lectureId === lectureId)
          : [],
        slideText: sources.slides ? (lecture?.slideText ?? "") : "",
        visualCandidates: sources.slides
          ? selectVisualCandidates(
              rankedModuleVisuals,
              `${activeChunk.transcript.map((segment) => segment.text).join("\n")}\n${lecture?.notes ?? ""}`,
            )
          : [],
        density,
        count: chunkCardCeiling(cardLimit, activeChunk),
        types,
        preferences,
        existingCards: courseCards.map(({ front, back }) => ({ front, back })),
      }),
    [
      cardLimit,
      courseCards,
      density,
      lecture?.notes,
      lecture?.slideText,
      rankedModuleVisuals,
      lectureId,
      markers,
      node?.title,
      preferences,
      selectedContextPreview,
      sourceStatus,
      sources,
      types,
      activeChunk,
    ],
  );
  const generationCostEstimate = useMemo(() => {
    const summaries = generationChunks.map((chunk) =>
      cardPromptSummary({
        lectureId,
        title: node?.title ?? "",
        context: sources.context
          ? selectedContextPreview
              .map((item) => `${item.title}: ${item.context}`)
              .join("\n\n")
          : "",
        sourceStatus,
        notes: sources.notes ? (lecture?.notes ?? "") : "",
        transcript: chunk.transcript,
        markers: sources.markers
          ? markers.filter((item) => item.lectureId === lectureId)
          : [],
        slideText: sources.slides ? (lecture?.slideText ?? "") : "",
        visualCandidates: sources.slides
          ? selectVisualCandidates(
              rankedModuleVisuals,
              `${chunk.transcript.map((segment) => segment.text).join("\n")}\n${lecture?.notes ?? ""}`,
            )
          : [],
        density,
        count: chunkCardCeiling(cardLimit, chunk),
        types,
        preferences,
        existingCards: courseCards.map(({ front, back }) => ({ front, back })),
      }),
    );
    const inputTokens = summaries.reduce(
      (total, summary) => total + summary.estimatedTokens + 700,
      0,
    );
    const outputTokens = generationChunks.reduce(
      (total, chunk) =>
        total + estimateCardOutputTokens(chunkCardCeiling(cardLimit, chunk)),
      0,
    );
    return estimateCardGenerationCost(
      settings.aiProvider,
      settings.aiModel,
      inputTokens,
      outputTokens,
    );
  }, [
    cardLimit,
    courseCards,
    density,
    generationChunks,
    lecture?.notes,
    lecture?.slideText,
    rankedModuleVisuals,
    lectureId,
    markers,
    node?.title,
    preferences,
    selectedContextPreview,
    settings.aiModel,
    settings.aiProvider,
    sourceStatus,
    sources,
    types,
  ]);
  const formattedGenerationCost = formatCardGenerationCost(generationCostEstimate);
  const importResponse = () => {
    try {
      const importLimit =
        settings.aiMode === "clipboard"
          ? chunkCardCeiling(cardLimit, activeChunk)
          : generationChunks.reduce(
              (total, chunk) => total + chunkCardCeiling(cardLimit, chunk),
              0,
            );
      const visualIds = new Set(visualSources.keys());
      const parsed = parseCardResponse(response, lectureId)
        .slice(0, importLimit)
        .map((card) =>
          card.visualId && !visualIds.has(card.visualId)
            ? { ...card, visualId: undefined }
            : card.visualId
              ? { ...card, visualLectureId: visualSources.get(card.visualId) }
              : card,
        );
      const identity = (front: string, back: string) =>
        `${front}\u0000${back}`.replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const known = new Set(
        courseCards.map((card) => identity(card.front, card.back)),
      );
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
        const earlierImported = unique
          .slice(0, index)
          .map((candidate, candidateIndex) => ({
            ...candidate,
            id: addedIds[candidateIndex],
          }));
        const similar = likelyDuplicate(card.front, [
          ...courseCards,
          ...earlierImported,
        ]);
        if (!similar) return;
        const terms = duplicateExplanation(card.front, similar);
        updateCard(addedIds[index], {
          duplicateWarning: `Liknar “${similar.front}”${terms ? ` · Gemensamma begrepp: ${terms}` : ""}`,
          duplicateOfId: similar.id,
        });
      });
      setResponse("");
      const skipped = parsed.length - unique.length;
      toast.success(
        `${unique.length} kort importerade${skipped ? ` · ${skipped} exakta dubbletter hoppades över` : ""}`,
      );
      if (
        settings.aiMode === "clipboard" &&
        activeChunk.index < activeChunk.total - 1
      ) {
        setClipboardChunkIndex((current) => current + 1);
        toast.message(
          `Fortsätt med del ${activeChunk.index + 2} av ${activeChunk.total}.`,
        );
      } else {
        setPromptOpen(false);
      }
    } catch (error) {
      toast.error(cardResponseErrorMessage(error));
    }
  };
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    toast.success("Prompten kopierades");
  };
  const copyPromptAndOpen = async (url: string, service: string) => {
    await copyPrompt();
    await openExternal(url);
    toast.message(
      `Prompten är kopierad. Klistra in den i ${service} och kopiera sedan svaret.`,
    );
  };
  const generateApi = async () => {
    if (!apiKey) {
      toast.error("Lägg till en API-nyckel i Inställningar först");
      return;
    }
    setBusy(true);
    try {
      const responses: string[] = [];
      for (const chunk of generationChunks) {
        setGenerationProgress({ current: chunk.index + 1, total: chunk.total });
        const raw = await generateCardsWithApi(
          promptForChunk(chunk),
          settings,
          apiKey,
        );
        responses.push(raw);
      }
      const generatedCards = responses.flatMap((raw) =>
        parseCardResponse(raw, lectureId),
      );
      setResponse(JSON.stringify({ cards: generatedCards }, null, 2));
      toast.success(
        generationChunks.length > 1
          ? `Alla ${generationChunks.length} delar är klara – granska korten.`
          : "AI-svaret är klart – granska och importera",
      );
    } catch (error) {
      toast.error(cardResponseErrorMessage(error));
    } finally {
      setBusy(false);
      setGenerationProgress(null);
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
          const message =
            error instanceof Error ? error.message : String(error);
          markAnkiNoteDeletionError(deletion.ankiId, message);
          if (!deletionFailure) deletionFailure = message;
        }
      }
      const decks = new Map<string, string>();
      const deckFor = async (id: string) => {
        const known = decks.get(id);
        if (known) return known;
        const deck = await ensureDeck(
          settings.ankiUrl,
          lectureDeckName(nodes, id, settings.defaultDeck),
        );
        decks.set(id, deck);
        return deck;
      };
      const cardsToSync = eligibleCards.filter(
        (card) =>
          card.status === "approved" ||
          card.ankiSyncError ||
          !card.ankiId ||
          card.ankiDeck !==
            lectureDeckName(nodes, card.lectureId, settings.defaultDeck),
      );
      let done = 0;
      const failed: string[] = [];
      let firstFailure = "";
      for (const card of cardsToSync) {
        try {
          const deck = await deckFor(card.lectureId);
          if (onlyPending && !needsAnkiSync(card, deck) && !card.ankiSyncError)
            continue;
          const tags = [...new Set(withoutStructuralTags(card.tags))];
          const media = await resolveVisualMedia(
            card,
            lectures[card.visualLectureId ?? card.lectureId],
          );
          const id = await syncCard(
            settings.ankiUrl,
            deck,
            { ...card, tags },
            media,
          );
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
          const message =
            error instanceof Error ? error.message : String(error);
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
          [
            done ? `${done} kort synkades` : "",
            deleted ? `${deleted} kort togs bort` : "",
          ]
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
        toast.error(
          `Ett borttaget kort kunde inte tas bort i Anki: ${deletionFailure}`,
        );
      if (done || deleted)
        targetLectureIds.forEach((id) =>
          updateLecture(id, { ankiLastSyncedAt: new Date().toISOString() }),
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
      const detected = parseCardResponse(text, lectureId);
      if (!detected.length)
        throw new Error("Inga Anki-kort hittades i urklippet");
      setResponse(text);
      toast.success(
        `${detected.length} kort hittades i urklippet och är redo att importeras`,
      );
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
      <PageHeader
        title="Anki-kort"
        description={
          <SourceSummary
            compact
            items={[
              { label: "Ljud", available: Boolean(lecture?.audioAssetId || lecture?.audioParts?.length), icon: AudioLines },
              { label: "Slides", available: Boolean(lecture?.slideAssetId || lecture?.slideText?.trim()), icon: Presentation },
              { label: "Transkript", available: segments.some((item) => item.lectureId === lectureId), icon: FileText },
            ]}
          />
        }
        actions={<>
          {pendingSyncCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void syncApproved(true)}
              disabled={busy}
            >
              Försök igen ({pendingSyncCount})
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void syncApproved()}
            disabled={busy}
          >
            <Send className="size-4" /> Synka godkända
          </Button>
        </>}
      />
      <div className="card-studio-layout grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-px bg-border">
        <aside className="overflow-auto bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Sparkles className="size-4 text-violet-500" /> Generera nya kort
          </div>
          <div className="mt-5">
            <Label>Hur omfattande ska repetitionen vara?</Label>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
              {(
                [
                  ["few", "Få"],
                  ["balanced", "Lagom"],
                  ["many", "Många"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setDensity(value);
                    updateGenerationDefaults({ density: value });
                  }}
                  className={`rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${density === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              AI:n avgör hur många kort materialet motiverar och undviker
              utfyllnad.
            </p>
          </div>
          <details className="mt-5 rounded-lg border border-border bg-card px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Avancerat: korttyper, källor och kvalitetsval
            </summary>
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
                        onChange={() => {
                          const next = types.includes(t.id)
                            ? types.filter((value) => value !== t.id)
                            : [...types, t.id];
                          setTypes(next);
                          updateGenerationDefaults({ types: next });
                        }}
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
                        onChange={() => {
                          const next = { ...sources, [id]: !sources[id] };
                          setSources(next);
                          updateGenerationDefaults({ sources: next });
                        }}
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
                  {sources.context && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-[var(--palette-surface-muted)] px-2.5 py-2 text-[var(--palette-text-muted)]">
                      {(
                        [
                          ["lecture", "Föreläsning"],
                          ["topic", "Ämne"],
                          ["module", "Modul"],
                          ["course", "Kurs"],
                          ["global", "Globalt"],
                        ] as const
                      ).map(([level, label]) => (
                        <label
                          key={level}
                          className="flex cursor-pointer items-center gap-1.5"
                        >
                          <input
                            type="checkbox"
                            checked={contextLevels[level]}
                            onChange={() => {
                              const next = {
                                ...contextLevels,
                                [level]: !contextLevels[level],
                              };
                              setContextLevels(next);
                              updateGenerationDefaults({ contextLevels: next });
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                  {sources.context && (contextFiles?.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-2">
                      <div className="mb-1 font-semibold text-[var(--palette-text)]">
                        Bifogade filer
                      </div>
                      {(contextFiles ?? []).map((file) => {
                        const available = Boolean(file.extractedText?.trim());
                        const included =
                          available &&
                          !excludedContextFileIds.includes(file.id);
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
                      Den valda contexten är ungefär{" "}
                      {contextTokenEstimate.toLocaleString("sv-SE")} tokens.
                      Mycket material skickas till vald AI-tjänst när du
                      genererar.
                    </p>
                  )}
                  {sources.context && selectedContextPreview.length ? (
                    selectedContextPreview.map((item) => (
                      <div
                        key={item.title}
                        className="rounded-lg bg-slate-50 p-2"
                      >
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
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Prompten använder ungefär{" "}
                {promptBudget.estimatedTokens.toLocaleString("sv-SE")} av högst{" "}
                {promptBudget.budgetTokens.toLocaleString("sv-SE")} tokens.
                {promptBudget.relevantCardCount
                  ? ` ${promptBudget.relevantCardCount} närliggande kort används för dubblettskydd.`
                  : " Inga relevanta äldre kort behöver skickas."}
                {promptBudget.omitted
                  ? ` ${promptBudget.omitted} källa${promptBudget.omitted === 1 ? " är" : "or är"} förkortad enligt budgeten.`
                  : ""}
              </p>
              {generationChunks.length > 1 && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Hela föreläsningen behandlas i {generationChunks.length} delar
                  så att inget transkript behöver tappas bort.
                </p>
              )}
              {settings.aiMode === "clipboard" && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Copy/paste använder din befintliga AI-tjänst. Lectio debiterar
                  ingen API-kostnad.
                </p>
              )}
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
                        onChange={() => {
                          const next = preferences.includes(preference)
                            ? preferences.filter((item) => item !== preference)
                            : [...preferences, preference];
                          setPreferences(next);
                          updateGenerationDefaults({ preferences: next });
                        }}
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
        <main className="ui-app-bg min-w-0 overflow-auto p-5 sm:p-6">
          <details
            className="mb-4 rounded-lg border border-border bg-card"
            open={syncStatuses.some(
              (status) => status.pending || status.lastError,
            )}
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
              Anki-synkstatus
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {syncStatuses.reduce(
                  (total, status) => total + status.pending,
                  0,
                )}{" "}
                väntande
              </span>
            </summary>
            <div className="border-t border-border">
              {syncStatuses.map((status) => (
                <div
                  key={status.lecture.id}
                  className="grid gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(10rem,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {status.lecture.title}
                  </span>
                  <span
                    className={
                      status.pending
                        ? "text-xs text-[var(--palette-warning)]"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {status.pending
                      ? `${status.pending} väntande`
                      : "Inga väntande ändringar"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {status.lastSyncedAt
                      ? `Senast synkad ${new Date(status.lastSyncedAt).toLocaleString("sv-SE")}`
                      : "Aldrig synkad"}
                  </span>
                  {status.lastError && (
                    <p
                      className="sm:col-span-3 text-xs leading-5 text-destructive"
                      title={status.lastError.message}
                    >
                      Senaste fel: {status.lastError.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
              {(["all", "generated", "approved", "synced"] as const).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--palette-focus-ring)] ${filter === f ? "bg-[var(--palette-primary)] text-[var(--palette-primary-foreground)]" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
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
            <span className="text-xs text-muted-foreground">
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
                <CheckCheck className="size-3.5" /> Godkänn alla i{" "}
                {selectedNode?.type === "course" ? "kursen" : "modulen"}
                {scopedGeneratedCards.length
                  ? ` (${scopedGeneratedCards.length})`
                  : ""}
              </Button>
            )}
            {isBulkScope && (
              <Button
                variant="outline"
                size="sm"
                onClick={syncScopedWithPreview}
                disabled={busy}
              >
                <Send className="size-3.5" /> Synka godkända i{" "}
                {selectedNode?.type === "course" ? "kursen" : "modulen"}
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
              <EmptyState
                icon={FileJson}
                title="Inga kort här ännu"
                description="Välj Generera för att skapa kort från föreläsningsmaterialet."
                className="min-h-72 bg-card"
              />
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
        description={
          generationChunks.length > 1
            ? `Långa föreläsningar behandlas automatiskt del för del. Del ${activeChunk.index + 1} av ${activeChunk.total}.`
            : "Copy/paste och API använder samma validerade kortformat."
        }
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
              {generationChunks.length > 1 && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Bearbetar del {activeChunk.index + 1} av {activeChunk.total}
                  </span>
                  <span>Slides och anteckningar följer med i varje del.</span>
                </div>
              )}
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground">
                  1. Skicka underlaget till din AI
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Lectio har redan valt material, begränsat context och bett om
                  ett validerbart JSON-svar.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="min-w-52"
                    onClick={() =>
                      void copyPromptAndOpen("https://chatgpt.com", "ChatGPT")
                    }
                  >
                    <ExternalLink className="size-4" /> Öppna ChatGPT och
                    kopiera
                  </Button>
                  <Button variant="outline" onClick={copyPrompt}>
                    <Clipboard className="size-4" /> Kopiera endast prompten
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void copyPromptAndOpen("https://claude.ai", "Claude")
                    }
                  >
                    Claude
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void copyPromptAndOpen(
                        "https://gemini.google.com",
                        "Gemini",
                      )
                    }
                  >
                    Gemini
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{settings.aiProvider} · {settings.aiModel}</span>
                {apiKeyConfigured ? (
                  <span className="font-medium text-[var(--palette-success)]">API-nyckel sparad</span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setActiveView("settings")}>
                    Lägg till API-nyckel
                  </Button>
                )}
              </div>
              <div className="mb-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">
                  Uppskattad API-kostnad: {formattedGenerationCost ?? "Pris saknas"}
                </div>
                <p className="mt-1">
                  Cirka {generationCostEstimate.inputTokens.toLocaleString("sv-SE")} input-token och{" "}
                  {generationCostEstimate.outputTokens.toLocaleString("sv-SE")} output-token
                  {generationChunks.length > 1
                    ? ` över ${generationChunks.length} delar`
                    : ""}
                  . Beräknas lokalt innan inget material eller någon nyckel skickas.
                </p>
                {generationCostEstimate.priceSource === "local-catalog" && (
                  <p className="mt-1">
                    Pris från Lectios lokala referenskatalog ({CARD_GENERATION_PRICE_CATALOG_VERSION}); kontrollera alltid providerns faktiska pris före större körningar.
                  </p>
                )}
                {!formattedGenerationCost && (
                  <p className="mt-1">
                    Lectio har ingen verifierad prisuppgift för vald modell. Du kan
                    fortfarande generera kort.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="sm:ml-auto" onClick={generateApi} disabled={busy || !apiKeyConfigured || apiKeyLoading}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}{" "}
                  {generationProgress
                    ? `Bearbetar del ${generationProgress.current} av ${generationProgress.total}`
                    : "Generera"}
                </Button>
              </div>
              {generationProgress && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Delarna bearbetas en i taget så att hela föreläsningen får plats.
                </p>
              )}
            </div>
          )}
          <div className="border-t border-slate-100 pt-4">
            <Label>
              {settings.aiMode === "clipboard"
                ? "2. Hämta AI-svaret"
                : "AI-svar för granskning"}
            </Label>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="h-28 font-mono text-xs"
              placeholder='{"cards":[…]}'
            />
            {settings.aiMode === "clipboard" && (
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => void pasteResponse()}
              >
                <Clipboard className="size-4" /> Hämta och kontrollera urklipp
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!response.trim()}
              onClick={importResponse}
            >
              <Plus className="size-4" /> 3. Validera och importera kort
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
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() =>
                  update(card.id, {
                    duplicateWarning: undefined,
                    duplicateOfId: undefined,
                  })
                }
              >
                Behåll ändå
              </button>
              {card.duplicateOfId &&
                cards.some(
                  (candidate) => candidate.id === card.duplicateOfId,
                ) && (
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => {
                      const original = cards.find(
                        (candidate) => candidate.id === card.duplicateOfId,
                      );
                      if (!original) return;
                      update(original.id, {
                        back:
                          original.back.trim() === card.back.trim()
                            ? original.back
                            : `${original.back}\n\n${card.back}`,
                      });
                      remove(card.id);
                    }}
                  >
                    Slå ihop
                  </button>
                )}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => remove(card.id)}
              >
                Radera nya
              </button>
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
            {card.visualId && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--palette-accent)]">
                <Image className="size-3" /> Bild från slides
              </span>
            )}
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

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppSettings,
  BackgroundJob,
  LibraryBackup,
  Flashcard,
  LectureData,
  LibraryNode,
  Marker,
  NodeType,
  TranscriptSegment,
} from "./types";
import { uid } from "../lib/utils";
import { db } from "./database";
import { normalizePalette } from "./theme";

const now = () => new Date().toISOString();
const workspaceId = "workspace-main";

/** Returns whether a node can be placed below the requested parent. */
export function canMoveLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  parentId: string,
) {
  const node = nodes.find((item) => item.id === nodeId);
  const parent = nodes.find((item) => item.id === parentId);
  const allowedParents: Partial<Record<NodeType, NodeType[]>> = {
    course: ["workspace"],
    module: ["course"],
    topic: ["module"],
    lecture: ["module"],
  };
  if (
    !node ||
    !parent ||
    node.id === parent.id ||
    !allowedParents[node.type]?.includes(parent.type)
  ) {
    return false;
  }

  // Keep the tree acyclic even if future node types gain more flexible nesting.
  const seen = new Set<string>();
  let current: LibraryNode | undefined = parent;
  while (current && !seen.has(current.id)) {
    if (current.id === node.id) return false;
    seen.add(current.id);
    current = current.parentId
      ? nodes.find((item) => item.id === current!.parentId)
      : undefined;
  }
  return true;
}

export function canReorderLibraryNode(
  nodes: LibraryNode[],
  nodeId: string,
  targetId: string,
) {
  const node = nodes.find((item) => item.id === nodeId);
  const target = nodes.find((item) => item.id === targetId);
  const isLeaf = (type: NodeType) => type === "topic" || type === "lecture";
  return Boolean(
    node &&
      target &&
      node.id !== target.id &&
      node.parentId === target.parentId &&
      (node.type === target.type || (isLeaf(node.type) && isLeaf(target.type))),
  );
}
const initialPaletteId =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "graphite"
    : "chalk-neutral";
const seedNodes: LibraryNode[] = [
  {
    id: workspaceId,
    parentId: null,
    type: "workspace",
    title: "Mina studier",
    context: "",
    createdAt: now(),
    settings: { language: "sv" },
  },
];

interface AppState {
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
  /** Notes removed locally but not yet confirmed deleted by AnkiConnect. */
  pendingAnkiDeletions: {
    ankiId: number;
    lectureId?: string;
    error?: string;
    updatedAt?: string;
  }[];
  selectedId: string;
  activeView: "dashboard" | "workspace" | "cards" | "settings";
  settings: AppSettings;
  jobs: BackgroundJob[];
  addNode: (parentId: string | null, type: NodeType, title: string) => string;
  updateNode: (id: string, patch: Partial<LibraryNode>) => void;
  moveNode: (id: string, parentId: string) => boolean;
  reorderNode: (id: string, targetId: string) => boolean;
  removeNode: (id: string) => void;
  selectNode: (id: string) => void;
  setActiveView: (view: AppState["activeView"]) => void;
  updateLecture: (lectureId: string, patch: Partial<LectureData>) => void;
  addSegment: (segment: Omit<TranscriptSegment, "id">) => void;
  setSegments: (
    lectureId: string,
    segments: Omit<TranscriptSegment, "id" | "lectureId">[],
  ) => void;
  updateSegment: (id: string, text: string) => void;
  removeSegment: (id: string) => void;
  setSegmentQualityFlag: (id: string, suspicious: boolean) => void;
  addMarker: (marker: Omit<Marker, "id" | "createdAt">) => void;
  updateMarker: (id: string, note: string) => void;
  removeMarker: (id: string) => void;
  removeSuspiciousSegments: (lectureId: string) => void;
  addCards: (cards: Omit<Flashcard, "id">[]) => string[];
  updateCard: (id: string, patch: Partial<Flashcard>) => void;
  removeCard: (id: string) => void;
  resolveAnkiNoteDeletion: (ankiId: number) => void;
  markAnkiNoteDeletionError: (ankiId: number, error: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  upsertJob: (
    job: Omit<BackgroundJob, "startedAt" | "updatedAt"> & {
      startedAt?: string;
    },
  ) => void;
  dismissJob: (id: string) => void;
  inheritedContext: (
    nodeId: string,
  ) => { title: string; context: string; type: NodeType }[];
  importLibrary: (data: Partial<AppState>) => void;
  restoreLibraryBackup: (backup: LibraryBackup) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      nodes: seedNodes,
      lectures: {},
      segments: [],
      markers: [],
      cards: [],
      pendingAnkiDeletions: [],
      selectedId: workspaceId,
      activeView: "dashboard",
      settings: {
        locale: "sv",
        onboardingDismissed: false,
        librarySidebarCollapsed: false,
        selectedPaletteId: initialPaletteId,
        customPalettes: [],
        userContext:
          "Svara på svenska. Skapa tydliga kort med ett koncept per kort.",
        aiMode: "clipboard",
        aiProvider: "openai",
        aiModel: "gpt-4.1-mini",
        aiBaseUrl: "https://api.openai.com/v1",
        transcriptionProvider: "local",
        localTranscriptionModel: "base",
        localTranscriptionAcceleration: "auto",
        transcriptionModel: "whisper-1",
        transcriptionBaseUrl: "https://api.openai.com/v1",
        transcriptionPrompt: "",
        ankiUrl: "http://127.0.0.1:8765",
        defaultDeck: "Lectio",
        cloudSync: {
          provider: "google-drive",
          remotePath: "Lectio",
        },
        backupLimit: 10,
      },
      jobs: [],
      addNode: (parentId, type, title) => {
        const resolvedParentId = parentId ?? workspaceId;
        const parent = get().nodes.find((node) => node.id === resolvedParentId);
        const allowedChildren: Partial<Record<NodeType, NodeType[]>> = {
          workspace: ["course"],
          course: ["module"],
          module: ["topic", "lecture"],
        };
        if (!parent || !allowedChildren[parent.type]?.includes(type)) {
          throw new Error("Objektet kan inte placeras på den här nivån");
        }
        const id = uid();
        const node: LibraryNode = {
          id,
          parentId: resolvedParentId,
          type,
          title,
          sortIndex: get().nodes.filter((item) => item.parentId === resolvedParentId)
            .length,
          context: "",
          createdAt: now(),
          settings: {},
        };
        set((s) => ({
          nodes: [...s.nodes, node],
          selectedId: id,
          lectures:
            type === "lecture"
              ? { ...s.lectures, [id]: { lectureId: id, notes: "" } }
              : s.lectures,
        }));
        return id;
      },
      updateNode: (id, patch) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        })),
      moveNode: (id, parentId) => {
        const nodes = get().nodes;
        if (!canMoveLibraryNode(nodes, id, parentId)) return false;
        set({
          nodes: nodes.map((node) =>
            node.id === id ? { ...node, parentId } : node,
          ),
        });
        return true;
      },
      reorderNode: (id, targetId) => {
        const nodes = get().nodes;
        if (!canReorderLibraryNode(nodes, id, targetId)) return false;
        const node = nodes.find((item) => item.id === id)!;
        const siblings = nodes.filter((item) => item.parentId === node.parentId);
        const remaining = siblings.filter((item) => item.id !== id);
        const targetIndex = remaining.findIndex((item) => item.id === targetId);
        remaining.splice(targetIndex, 0, node);
        const positions = new Map(remaining.map((item, index) => [item.id, index]));
        set({
          nodes: nodes.map((item) =>
            positions.has(item.id)
              ? { ...item, sortIndex: positions.get(item.id) }
              : item,
          ),
        });
        return true;
      },
      removeNode: (id) =>
        set((s) => {
          const descendants = new Set<string>([id]);
          let changed = true;
          while (changed) {
            changed = false;
            s.nodes.forEach((n) => {
              if (
                n.parentId &&
                descendants.has(n.parentId) &&
                !descendants.has(n.id)
              ) {
                descendants.add(n.id);
                changed = true;
              }
            });
          }
          const removedIds = [...descendants];
          void db.backups.put({
            id: uid(),
            createdAt: now(),
            reason: "deletion",
            nodes: s.nodes,
            lectures: s.lectures,
            segments: s.segments,
            markers: s.markers,
            cards: s.cards,
            settings: s.settings,
            assetCount: 0,
          });
          void db.transaction(
            "rw",
            db.assets,
            db.recordingSessions,
            db.recordingChunks,
            async () => {
              await db.assets.where("lectureId").anyOf(removedIds).delete();
              const sessions = await db.recordingSessions
                .where("lectureId")
                .anyOf(removedIds)
                .toArray();
              const sessionIds = sessions.map((session) => session.id);
              if (sessionIds.length)
                await db.recordingChunks
                  .where("sessionId")
                  .anyOf(sessionIds)
                  .delete();
              await db.recordingSessions
                .where("lectureId")
                .anyOf(removedIds)
                .delete();
            },
          );
          const lectures = { ...s.lectures };
          removedIds.forEach((removedId) => delete lectures[removedId]);
          return {
            nodes: s.nodes.filter((n) => !descendants.has(n.id)),
            lectures,
            selectedId: workspaceId,
            segments: s.segments.filter((x) => !descendants.has(x.lectureId)),
            markers: s.markers.filter((x) => !descendants.has(x.lectureId)),
            cards: s.cards.filter((x) => !descendants.has(x.lectureId)),
            pendingAnkiDeletions: Array.from(
              new Map(
                [
                  ...s.pendingAnkiDeletions,
                  ...s.cards
                    .filter(
                      (card) =>
                        descendants.has(card.lectureId) && card.ankiId !== undefined,
                    )
                    .map((card) => ({
                      ankiId: card.ankiId as number,
                      lectureId: card.lectureId,
                    })),
                ].map((item) => [item.ankiId, item]),
              ).values(),
            ),
          };
        }),
      selectNode: (id) => set({ selectedId: id }),
      setActiveView: (activeView) => set({ activeView }),
      updateLecture: (lectureId, patch) =>
        set((s) => ({
          lectures: {
            ...s.lectures,
            [lectureId]: {
              ...(s.lectures[lectureId] ?? { lectureId, notes: "" }),
              ...patch,
            },
          },
        })),
      addSegment: (segment) =>
        set((s) => ({ segments: [...s.segments, { ...segment, id: uid() }] })),
      setSegments: (lectureId, segments) =>
        set((s) => ({
          segments: [
            ...s.segments.filter((x) => x.lectureId !== lectureId),
            ...segments.map((x) => ({ ...x, id: uid(), lectureId })),
          ],
        })),
      updateSegment: (id, text) =>
        set((s) => ({
          segments: s.segments.map((x) => (x.id === id ? { ...x, text } : x)),
        })),
      removeSegment: (id) =>
        set((s) => ({ segments: s.segments.filter((segment) => segment.id !== id) })),
      setSegmentQualityFlag: (id, suspicious) =>
        set((s) => ({
          segments: s.segments.map((segment) =>
            segment.id === id
              ? {
                  ...segment,
                  suspicious,
                  qualityFlags: suspicious ? segment.qualityFlags : undefined,
                }
              : segment,
          ),
        })),
      addMarker: (marker) =>
        set((s) => ({
          markers: [...s.markers, { ...marker, id: uid(), createdAt: now() }],
        })),
      updateMarker: (id, note) =>
        set((s) => ({
          markers: s.markers.map((x) => (x.id === id ? { ...x, note } : x)),
        })),
      removeMarker: (id) =>
        set((s) => ({ markers: s.markers.filter((x) => x.id !== id) })),
      removeSuspiciousSegments: (lectureId) =>
        set((s) => ({
          segments: s.segments.filter(
            (segment) => segment.lectureId !== lectureId || !segment.suspicious,
          ),
        })),
      addCards: (cards) => {
        const ids = cards.map(() => uid());
        set((s) => ({
          cards: [...s.cards, ...cards.map((card, index) => ({ ...card, id: ids[index] }))],
        }));
        return ids;
      },
      updateCard: (id, patch) =>
        set((s) => ({
          cards: s.cards.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeCard: (id) =>
        set((s) => {
          const card = s.cards.find((item) => item.id === id);
          return {
            cards: s.cards.filter((item) => item.id !== id),
            pendingAnkiDeletions:
              card?.ankiId === undefined
                ? s.pendingAnkiDeletions
                : Array.from(
                    new Map(
                      [
                        ...s.pendingAnkiDeletions,
                        { ankiId: card.ankiId, lectureId: card.lectureId },
                      ].map((item) => [item.ankiId, item]),
                    ).values(),
                  ),
          };
        }),
      resolveAnkiNoteDeletion: (ankiId) =>
        set((s) => ({
          pendingAnkiDeletions: s.pendingAnkiDeletions.filter(
            (pending) => pending.ankiId !== ankiId,
          ),
        })),
      markAnkiNoteDeletionError: (ankiId, error) =>
        set((s) => ({
          pendingAnkiDeletions: s.pendingAnkiDeletions.map((pending) =>
            pending.ankiId === ankiId
              ? { ...pending, error, updatedAt: now() }
              : pending,
          ),
        })),
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      upsertJob: (job) =>
        set((s) => {
          const existing = s.jobs.find((item) => item.id === job.id);
          const timestamp = now();
          const next = {
            ...existing,
            ...job,
            startedAt: existing?.startedAt ?? job.startedAt ?? timestamp,
            updatedAt: timestamp,
          } satisfies BackgroundJob;
          return {
            jobs: existing
              ? s.jobs.map((item) => (item.id === job.id ? next : item))
              : [...s.jobs, next],
          };
        }),
      dismissJob: (id) =>
        set((s) => ({ jobs: s.jobs.filter((job) => job.id !== id) })),
      inheritedContext: (nodeId) => {
        const { nodes } = get();
        const chain: LibraryNode[] = [];
        let current = nodes.find((n) => n.id === nodeId);
        while (current) {
          if (current.context.trim()) chain.unshift(current);
          current = current.parentId
            ? nodes.find((n) => n.id === current!.parentId)
            : undefined;
        }
        return chain.map(({ title, context, type }) => ({
          title,
          context,
          type,
        }));
      },
      importLibrary: (data) =>
        set((s) => ({
          ...s,
          ...data,
          settings: {
            ...s.settings,
            ...(data.settings ?? {}),
            customPalettes: Array.isArray(data.settings?.customPalettes)
              ? data.settings.customPalettes.map((palette) =>
                  normalizePalette(palette),
                )
              : s.settings.customPalettes,
          },
        })),
      restoreLibraryBackup: (backup) =>
        set({
          nodes: backup.nodes,
          lectures: backup.lectures,
          segments: backup.segments,
          markers: backup.markers,
          cards: backup.cards,
          settings: backup.settings,
          selectedId: backup.nodes.some((node) => node.id === workspaceId)
            ? workspaceId
            : (backup.nodes[0]?.id ?? workspaceId),
          activeView: "dashboard",
        }),
    }),
    {
      name: "lectio-state-v1",
      version: 13,
      migrate: (persistedState) => {
        const previous = persistedState as AppState;
        const legacySettings = previous.settings as AppSettings & {
          aiMode?: string;
          aiProvider?: string;
          transcriptionProvider?: string;
          appearance?: string;
          accentTheme?: string;
        };
        return {
          ...previous,
          settings: {
            ...legacySettings,
            aiMode:
              legacySettings.aiMode === "api" ? "api" : ("clipboard" as const),
            aiProvider: ["openai", "anthropic", "gemini", "groq"].includes(
              legacySettings.aiProvider ?? "",
            )
              ? (legacySettings.aiProvider as AppSettings["aiProvider"])
              : "openai",
            transcriptionProvider: [
              "local",
              "manual",
              "openai",
              "groq",
            ].includes(legacySettings.transcriptionProvider ?? "")
              ? (legacySettings.transcriptionProvider as AppSettings["transcriptionProvider"])
              : "local",
            localTranscriptionAcceleration:
              legacySettings.localTranscriptionAcceleration ?? "auto",
            transcriptionPrompt: legacySettings.transcriptionPrompt ?? "",
              cloudSync: (() => {
                const legacyCloud = legacySettings.cloudSync as Partial<AppSettings["cloudSync"]>;
                return {
                // Google Drive is the only active direct-sync provider for
                // now. Older placeholder selections must not leave the
                // connection UI disabled after upgrading.
                provider: "google-drive" as const,
                remotePath: legacyCloud?.remotePath?.trim() || "Lectio",
                connectedAt: legacyCloud?.connectedAt,
                accountLabel: legacyCloud?.accountLabel,
                lastSyncedAt: legacyCloud?.lastSyncedAt,
              };
            })(),
            backupLimit: legacySettings.backupLimit ?? 10,
            onboardingDismissed: legacySettings.onboardingDismissed ?? false,
            librarySidebarCollapsed:
              legacySettings.librarySidebarCollapsed ?? false,
            selectedPaletteId:
              legacySettings.selectedPaletteId ??
              (legacySettings.appearance === "dark"
                ? legacySettings.accentTheme === "green"
                  ? "forest"
                  : "midnight"
                : legacySettings.accentTheme === "blue"
                  ? "fjord"
                  : "chalk"),
            customPalettes: Array.isArray(legacySettings.customPalettes)
              ? legacySettings.customPalettes.map((palette) =>
                  normalizePalette(palette),
                )
              : [],
          },
          // Visa den nya översikten en gång efter uppgraderingen. Allt lokalt
          // kursmaterial ligger kvar i samma lagring.
          activeView: "dashboard" as const,
          // Ett pågående native-jobb överlever inte en omstart. Rensa därför
          // gamla indikatorer i stället för att visa ett falskt förlopp.
          jobs: [],
          pendingAnkiDeletions: (previous.pendingAnkiDeletions ?? []).map(
            (pending) =>
              typeof pending === "number" ? { ankiId: pending } : pending,
          ),
        };
      },
    },
  ),
);

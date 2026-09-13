import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AppSettings,
  LibraryBackup,
  Flashcard,
  LectureData,
  LibraryNode,
  Marker,
  NodeType,
  TranscriptSegment,
} from "./types";
import { defaultCardGenerationSettings } from "./types";
import { uid } from "../lib/utils";
import { db } from "./database";
import { normalizePalette } from "./theme";
import {
  backupSourceFromState,
  createLibraryBackup,
} from "../services/libraryBackup";
import {
  finishStartupPhase,
  markStartup,
  startStartupPhase,
} from "../services/startupMetrics";
import { createDeferredLocalStorage } from "./deferredStorage";
import { STATE_STORAGE_KEY } from "../runtimeProfile";
import {
  persistedAppState,
  type PersistedAppState,
} from "../infrastructure/persistence";
import {
  moveLibraryNode,
  reorderLibraryNode,
} from "../domain/libraryTree";

export {
  canMoveLibraryNode,
  canReorderLibraryNode,
  moveLibraryNode,
  reorderLibraryNode,
} from "../domain/libraryTree";

const now = () => new Date().toISOString();
const workspaceId = "workspace-main";
let storeHydrationComplete = false;
const storeHydrationListeners = new Set<() => void>();

export function hasStoreHydrated() {
  return storeHydrationComplete;
}

export function onStoreHydrated(listener: () => void) {
  storeHydrationListeners.add(listener);
  return () => {
    storeHydrationListeners.delete(listener);
  };
}

function completeStoreHydration(error?: unknown) {
  storeHydrationComplete = true;
  finishStartupPhase(
    "library-state-hydration",
    error ? "recovered-error" : "ok",
  );
  markStartup("library-state-hydrated");
  storeHydrationListeners.forEach((listener) => listener());
  storeHydrationListeners.clear();
  if (error) {
    void import("../services/diagnostics").then(({ recordDiagnostic }) =>
      recordDiagnostic("startup:library-state-hydration", error),
    );
  }
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

export interface AppState {
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
  activeView:
    | "dashboard"
    | "workspace"
    | "cards"
    | "inbox"
    | "super-actions"
    | "settings";
  settings: AppSettings;
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
  inheritedContext: (
    nodeId: string,
  ) => { title: string; context: string; type: NodeType }[];
  importLibrary: (data: Partial<AppState>) => void;
  restoreLibraryBackup: (backup: LibraryBackup) => void;
}

startStartupPhase("library-state-hydration");

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedAppState>(
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
        cardGeneration: defaultCardGenerationSettings(),
        transcriptionProvider: "local",
        localTranscriptionModel: "base",
        localTranscriptionAcceleration: "auto",
        localTranscriptionBenchmarks: {},
        transcriptionModel: "whisper-1",
        transcriptionBaseUrl: "https://api.openai.com/v1",
        transcriptionPrompt: "",
        localVisualDescriptions: "off",
        ankiUrl: "http://127.0.0.1:8765",
        defaultDeck: "Lectio",
        cloudSync: {
          provider: "google-drive",
          remotePath: "Lectio",
          autoSyncOnStartAndClose: true,
        },
        backupLimit: 10,
      },
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
          sortIndex: get().nodes.filter(
            (item) => item.parentId === resolvedParentId,
          ).length,
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
        const moved = moveLibraryNode(nodes, id, parentId);
        if (moved === nodes) return false;
        set({ nodes: moved });
        return true;
      },
      reorderNode: (id, targetId) => {
        const nodes = get().nodes;
        const reordered = reorderLibraryNode(nodes, id, targetId);
        if (reordered === nodes) return false;
        set({ nodes: reordered });
        return true;
      },
      removeNode: (id) => {
        const before = get();
        const descendants = new Set<string>([id]);
        let changed = true;
        while (changed) {
          changed = false;
          before.nodes.forEach((node) => {
            if (
              node.parentId &&
              descendants.has(node.parentId) &&
              !descendants.has(node.id)
            ) {
              descendants.add(node.id);
              changed = true;
            }
          });
        }
        const removedIds = [...descendants];
        const lectures = { ...before.lectures };
        removedIds.forEach((removedId) => delete lectures[removedId]);
        set({
          nodes: before.nodes.filter((node) => !descendants.has(node.id)),
          lectures,
          selectedId: workspaceId,
          segments: before.segments.filter(
            (segment) => !descendants.has(segment.lectureId),
          ),
          markers: before.markers.filter(
            (marker) => !descendants.has(marker.lectureId),
          ),
          cards: before.cards.filter(
            (card) => !descendants.has(card.lectureId),
          ),
          pendingAnkiDeletions: Array.from(
            new Map(
              [
                ...before.pendingAnkiDeletions,
                ...before.cards
                  .filter(
                    (card) =>
                      descendants.has(card.lectureId) &&
                      card.ankiId !== undefined,
                  )
                  .map((card) => ({
                    ankiId: card.ankiId as number,
                    lectureId: card.lectureId,
                  })),
              ].map((item) => [item.ankiId, item]),
            ).values(),
          ),
        });
        // Do not remove media until its recoverable backup has committed.
        void (async () => {
          const affectedAssets = (await db.assets.toArray()).filter(
            (asset) =>
              descendants.has(asset.lectureId) ||
              (asset.nodeId !== undefined && descendants.has(asset.nodeId)),
          );
          try {
            await createLibraryBackup(
              "deletion",
              backupSourceFromState(before),
              { retainAssets: affectedAssets },
            );
            await db.transaction(
              "rw",
              db.assets,
              db.visualThumbnails,
              db.recordingSessions,
              db.recordingChunks,
              async () => {
                await db.assets.bulkDelete(
                  affectedAssets.map((asset) => asset.id),
                );
                if (affectedAssets.length)
                  await db.visualThumbnails
                    .where("assetId")
                    .anyOf(affectedAssets.map((asset) => asset.id))
                    .delete();
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
          } catch (error) {
            // Metadata is hidden, but media stays untouched and can be recovered.
            console.error("Lectio kunde inte säkra raderade media", error);
          }
        })();
      },
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
        set((s) => ({
          segments: s.segments.filter((segment) => segment.id !== id),
        })),
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
          cards: [
            ...s.cards,
            ...cards.map((card, index) => ({ ...card, id: ids[index] })),
          ],
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
      name: STATE_STORAGE_KEY,
      version: 16,
      storage: createDeferredLocalStorage<PersistedAppState>(),
      partialize: persistedAppState,
      // Native operations cannot survive a process restart. In particular, an
      // interrupted Drive sync used to be rehydrated as an active job and
      // locked the entire UI even though no sync worker was running.
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as PersistedAppState),
      }),
      onRehydrateStorage: () => (_state, error) =>
        completeStoreHydration(error),
      migrate: (persistedState) => {
        const previous = persistedState as PersistedAppState;
        const legacySettings = previous.settings as Omit<
          AppSettings,
          "localVisualDescriptions"
        > & {
          aiMode?: string;
          aiProvider?: string;
          transcriptionProvider?: string;
          appearance?: string;
          accentTheme?: string;
          localVisualDescriptions?: string;
        };
        return {
          ...previous,
          settings: {
            ...legacySettings,
            aiMode:
              legacySettings.aiMode === "api"
                ? ("api" as const)
                : ("clipboard" as const),
            aiProvider: [
              "openai",
              "anthropic",
              "gemini",
              "groq",
              "custom",
            ].includes(legacySettings.aiProvider ?? "")
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
            // The former local-vision toggle maps to the new opt-in engine.
            // feature. It still remains disabled until the Nvidia package is
            // explicitly installed and verified.
            localVisualDescriptions:
              legacySettings.localVisualDescriptions === "local" ||
              legacySettings.localVisualDescriptions === "nvidia"
                ? ("nvidia" as const)
                : ("off" as const),
            cloudSync: (() => {
              const legacyCloud = legacySettings.cloudSync as Partial<
                AppSettings["cloudSync"]
              >;
              return {
                // Google Drive is the only active direct-sync provider for
                // now. Older placeholder selections must not leave the
                // connection UI disabled after upgrading.
                provider: "google-drive" as const,
                remotePath: legacyCloud?.remotePath?.trim() || "Lectio",
                connectedAt: legacyCloud?.connectedAt,
                accountLabel: legacyCloud?.accountLabel,
                lastSyncedAt: legacyCloud?.lastSyncedAt,
                autoSyncOnStartAndClose:
                  legacyCloud?.autoSyncOnStartAndClose ?? true,
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
          pendingAnkiDeletions: (previous.pendingAnkiDeletions ?? []).map(
            (pending) =>
              typeof pending === "number" ? { ankiId: pending } : pending,
          ),
        };
      },
    },
  ),
);

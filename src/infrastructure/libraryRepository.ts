import { useAppStore, type AppState } from "../core/store";

export type LibraryRepositoryState = Pick<
  AppState,
  | "nodes"
  | "lectures"
  | "segments"
  | "markers"
  | "cards"
  | "pendingAnkiDeletions"
  | "settings"
  | "selectedId"
  | "activeView"
  | "addNode"
  | "updateNode"
  | "moveNode"
  | "reorderNode"
  | "removeNode"
  | "selectNode"
  | "setActiveView"
  | "updateLecture"
  | "addSegment"
  | "setSegments"
  | "updateSegment"
  | "removeSegment"
  | "setSegmentQualityFlag"
  | "addMarker"
  | "updateMarker"
  | "removeMarker"
  | "removeSuspiciousSegments"
  | "addCards"
  | "updateCard"
  | "removeCard"
  | "resolveAnkiNoteDeletion"
  | "markAnkiNoteDeletionError"
  | "updateSettings"
  | "inheritedContext"
  | "importLibrary"
  | "restoreLibraryBackup"
>;

export interface LibraryRepository {
  getState(): LibraryRepositoryState;
  subscribe(listener: (state: LibraryRepositoryState) => void): () => void;
}

export const libraryRepository: LibraryRepository = {
  getState: () => useAppStore.getState(),
  subscribe: (listener) => useAppStore.subscribe((state) => listener(state)),
};

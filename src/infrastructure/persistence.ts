import type { AppState } from "../core/store";

/** The only fields allowed to cross the durable library boundary. */
export type PersistedAppState = Pick<
  AppState,
  | "nodes"
  | "lectures"
  | "segments"
  | "markers"
  | "cards"
  | "pendingAnkiDeletions"
  | "selectedId"
  | "activeView"
  | "settings"
>;

export function persistedAppState(state: AppState): PersistedAppState {
  return {
    nodes: state.nodes,
    lectures: state.lectures,
    segments: state.segments,
    markers: state.markers,
    cards: state.cards,
    pendingAnkiDeletions: state.pendingAnkiDeletions,
    selectedId: state.selectedId,
    activeView: state.activeView,
    settings: state.settings,
  };
}

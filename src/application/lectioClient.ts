import type {
  AppSettings,
  BackgroundJob,
  Flashcard,
  LectureData,
  LibraryBackup,
  LibraryNode,
  Marker,
  NodeType,
  TranscriptSegment,
} from "../core/types";

export type {
  AppSettings,
  BackgroundJob,
  Flashcard,
  LectureData,
  LibraryBackup,
  LibraryNode,
  Marker,
  NodeType,
  TranscriptSegment,
} from "../core/types";

export type ActiveView =
  "dashboard" | "workspace" | "cards" | "inbox" | "super-actions" | "settings";

export type FrontendVariant = "legacy" | "next";
export type DataProfile = "main" | "next" | "stability";

export type LectioErrorCode =
  | "invalid-input"
  | "not-found"
  | "conflict"
  | "capability-unavailable"
  | "cancelled"
  | "provider-error"
  | "storage-error"
  | "unknown";

export type LectioError = {
  code: LectioErrorCode;
  /** Stable, localizable message key. */
  messageKey: string;
  /** Safe Swedish fallback; raw provider/Tauri output is never required by UI. */
  message: string;
};

export type LectioResult<T = void> =
  { ok: true; value: T } | { ok: false; error: LectioError };

export type LibrarySnapshot = {
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
};

export type SessionSnapshot = {
  selectedId: string;
  activeView: ActiveView;
};

export type CapabilitySnapshot = {
  desktop: boolean;
  gpu: "nvidia" | "other" | "none" | "unknown";
  localTranscription: boolean;
  ankiConfigured: boolean;
  driveConnected: boolean;
  credentialStore: boolean;
};

export type BinaryAssetInput = {
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
  lastModified?: number;
};

export type LectioEvent =
  | { type: "library-changed"; snapshot: LibrarySnapshot }
  | { type: "session-changed"; snapshot: SessionSnapshot }
  | { type: "settings-changed"; settings: AppSettings }
  | { type: "jobs-changed"; jobs: BackgroundJob[] }
  | {
      type: "native-lifecycle";
      state: "focus" | "blur" | "online" | "offline";
    }
  | { type: "error"; error: LectioError };

export interface ReadableValue<T> {
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}

export type BatchAction = "transcribe" | "generate" | "approve" | "sync";

/**
 * Stable, framework-independent contract exposed to every Lectio frontend.
 * Implementations may use Zustand, Dexie, Tauri and provider services, but
 * none of those implementation details cross this boundary.
 */
export interface LectioClient {
  readonly runtime: {
    frontend: FrontendVariant;
    dataProfile: DataProfile;
  };
  readonly library: ReadableValue<LibrarySnapshot> & {
    addNode(
      parentId: string | null,
      type: NodeType,
      title: string,
    ): LectioResult<string>;
    updateNode(id: string, patch: Partial<LibraryNode>): LectioResult;
    moveNode(id: string, parentId: string): LectioResult<boolean>;
    reorderNode(id: string, targetId: string): LectioResult<boolean>;
    removeNode(id: string): Promise<LectioResult>;
    updateLecture(id: string, patch: Partial<LectureData>): LectioResult;
    import(
      data: Partial<LibrarySnapshot> & { settings?: AppSettings },
    ): LectioResult;
    restore(backup: LibraryBackup): LectioResult;
  };
  readonly session: ReadableValue<SessionSnapshot> & {
    selectNode(id: string): LectioResult;
    setActiveView(view: ActiveView): LectioResult;
  };
  readonly assets: {
    importAudio(
      lectureId: string,
      input: BinaryAssetInput,
    ): Promise<LectioResult<string>>;
    importSlides(
      lectureId: string,
      input: BinaryAssetInput,
    ): Promise<LectioResult<string>>;
  };
  readonly settings: ReadableValue<AppSettings> & {
    update(patch: Partial<AppSettings>): LectioResult;
  };
  readonly transcript: {
    replace(
      lectureId: string,
      segments: Omit<TranscriptSegment, "id" | "lectureId">[],
    ): LectioResult;
    updateSegment(id: string, text: string): LectioResult;
    removeSegment(id: string): LectioResult;
  };
  readonly markers: {
    add(marker: Omit<Marker, "id" | "createdAt">): LectioResult;
    update(id: string, note: string): LectioResult;
    remove(id: string): LectioResult;
  };
  readonly cards: {
    add(cards: Omit<Flashcard, "id">[]): LectioResult<string[]>;
    update(id: string, patch: Partial<Flashcard>): LectioResult;
    remove(id: string): LectioResult;
    approve(ids: string[]): LectioResult<number>;
  };
  readonly jobs: ReadableValue<BackgroundJob[]> & {
    cancel(id: string): Promise<LectioResult>;
    dismiss(id: string): LectioResult;
  };
  readonly workflows: {
    enqueue(
      action: BatchAction,
      lectureIds: string[],
      overwrite?: boolean,
    ): Promise<LectioResult<string[]>>;
    syncLibrary(): Promise<LectioResult>;
    createBackup(): Promise<LectioResult<string>>;
    exportDiagnostics(): Promise<LectioResult>;
  };
  readonly capabilities: {
    get(): Promise<CapabilitySnapshot>;
  };
  readonly nativeWindow: {
    minimize(): Promise<LectioResult>;
    toggleMaximize(): Promise<LectioResult>;
    close(): Promise<LectioResult>;
  };
  readonly events: {
    subscribe(listener: (event: LectioEvent) => void): () => void;
  };
}

export function isLectioError<T>(
  result: LectioResult<T>,
): result is { ok: false; error: LectioError } {
  return !result.ok;
}

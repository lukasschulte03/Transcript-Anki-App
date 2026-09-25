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
  ThemePalette,
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

export type LibraryTransferProgress = {
  completed: number;
  total?: number;
  detail: string;
};
export type LibraryBackupSummary = {
  id: string;
  createdAt: string;
  nodes: number;
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

export type LocalTranscriptionSetup = {
  model: AppSettings["localTranscriptionModel"];
  installed: boolean;
  size: number;
  nvidiaDetected: boolean;
  nvidiaRuntimeInstalled: boolean;
  nvidiaRuntimeReady: boolean;
  nvidiaName?: string | null;
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
    reorderNode(
      id: string,
      targetId: string,
      position?: "before" | "after",
    ): LectioResult<boolean>;
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
    read(id: string): Promise<LectioResult<Blob>>;
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
  readonly credentials: {
    read(key: string): Promise<LectioResult<boolean>>;
    write(key: string, secret: string): Promise<LectioResult>;
    remove(key: string): Promise<LectioResult>;
  };
  readonly localTranscription: {
    status(
      model: AppSettings["localTranscriptionModel"],
    ): Promise<LectioResult<LocalTranscriptionSetup>>;
    download(
      model: AppSettings["localTranscriptionModel"],
    ): Promise<LectioResult<LocalTranscriptionSetup>>;
    remove(
      model: AppSettings["localTranscriptionModel"],
    ): Promise<LectioResult>;
    installNvidia(): Promise<LectioResult<LocalTranscriptionSetup>>;
  };
  readonly recordings: {
    start(lectureId: string, mimeType: string): Promise<LectioResult<string>>;
    append(
      id: string,
      sequence: number,
      blob: Blob,
      duration: number,
    ): Promise<LectioResult>;
    finish(id: string, duration?: number): Promise<LectioResult<string>>;
    pending(
      lectureId: string,
    ): Promise<LectioResult<{ id: string; name: string }[]>>;
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
    exportLibrary(
      progress?: (value: LibraryTransferProgress) => void,
    ): Promise<LectioResult>;
    importLibraryFile(
      file: Blob,
      name: string,
      progress?: (value: LibraryTransferProgress) => void,
    ): Promise<LectioResult>;
    listBackups(): Promise<LectioResult<LibraryBackupSummary[]>>;
    restoreBackup(id: string): Promise<LectioResult>;
    enqueue(
      action: BatchAction,
      lectureIds: string[],
      overwrite?: boolean,
    ): Promise<LectioResult<string[]>>;
    syncLibrary(): Promise<LectioResult>;
    connectGoogleDrive(): Promise<LectioResult<{ accountLabel: string }>>;
    cancelGoogleDriveConnection(): Promise<LectioResult<boolean>>;
    disconnectGoogleDrive(): Promise<LectioResult>;
    testAnki(): Promise<LectioResult<{ version: number; decks: string[] }>>;
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

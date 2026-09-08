export type NodeType = "workspace" | "course" | "module" | "topic" | "lecture";

export interface LibraryNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  /** Local sibling order. Missing values retain the order from older libraries. */
  sortIndex?: number;
  context: string;
  createdAt: string;
  settings: {
    language?: string;
    ankiDeck?: string;
    cardStyle?: string;
    /** Short, term-focused Whisper lexicon inherited by child objects. */
    transcriptionGlossary?: string;
  };
}

export interface TranscriptSegment {
  id: string;
  lectureId: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
  suspicious?: boolean;
  /** Local-only quality hints. Text is never removed automatically. */
  qualityFlags?: Array<
    "empty" | "very-short" | "duplicate" | "repeated-phrase"
  >;
}

export interface Marker {
  id: string;
  lectureId: string;
  time: number;
  note: string;
  createdAt: string;
}

export type CardStatus = "generated" | "approved" | "synced";
export type CardType = "basic" | "cloze" | "concept" | "definition" | "problem";

export interface Flashcard {
  id: string;
  lectureId: string;
  type: CardType;
  front: string;
  back: string;
  tags: string[];
  status: CardStatus;
  ankiId?: number;
  /** Last Anki deck this note was placed in, for incremental deck moves. */
  ankiDeck?: string;
  ankiSyncError?: string;
  ankiSyncErrorAt?: string;
  ankiSyncedAt?: string;
  duplicateWarning?: string;
  duplicateOfId?: string;
}

export interface LectureData {
  lectureId: string;
  notes: string;
  slideText?: string;
  /** Extracted locally, one entry per PDF page, for source-aware slide use. */
  slidePages?: string[];
  slideMappings?: Record<string, { page: number; confidence: number }>;
  /** Preserved before an optional terminology review is applied. */
  transcriptOriginal?: TranscriptSegment[];
  audioAssetId?: string;
  audioName?: string;
  /**
   * Known duration in seconds. MediaRecorder WebM blobs do not always expose
   * duration metadata to Chromium, so recordings retain their measured length.
   */
  audioDuration?: number;
  /** Ordered, immutable source recordings for a lecture with breaks. */
  audioParts?: {
    assetId: string;
    name: string;
    duration?: number;
    /** Retained only when the user explicitly keeps the pre-optimised source. */
    originalAssetId?: string;
    /** Stable identity of an imported mobile source, used to avoid duplicates. */
    sourceFingerprint?: string;
  }[];
  slideAssetId?: string;
  slideName?: string;
  ankiLastSyncedAt?: string;
}

export interface ThemePalette {
  id: string;
  name: string;

  // Layout
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceHover: string;

  // Text
  text: string;
  textMuted: string;
  textSubtle: string;

  // Borders
  border: string;
  borderStrong: string;

  // Primary / brand
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  primaryMutedHover: string;
  primaryForeground: string;
  accent: string;
  focusRing: string;

  // Hero sections
  heroBackground: string;
  heroForeground: string;

  // Semantic status colors
  success: string;
  successMuted: string;
  successForeground: string;
  warning: string;
  warningMuted: string;
  warningForeground: string;
  danger: string;
  dangerMuted: string;
  dangerForeground: string;
  info: string;
  infoMuted: string;
  infoForeground: string;
}

export interface AppSettings {
  locale: "sv" | "en";
  onboardingDismissed: boolean;
  librarySidebarCollapsed: boolean;
  selectedPaletteId: string;
  customPalettes: ThemePalette[];
  userContext: string;
  aiMode: "clipboard" | "api";
  aiProvider: "openai" | "anthropic" | "gemini" | "groq" | "custom";
  aiModel: string;
  aiBaseUrl: string;
  transcriptionProvider: "local" | "manual" | "openai" | "groq";
  localTranscriptionModel:
    "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3";
  localTranscriptionAcceleration: "auto" | "cpu" | "nvidia";
  localTranscriptionBenchmarks: Partial<
    Record<"cpu" | "nvidia", LocalTranscriptionBenchmark>
  >;
  transcriptionModel: string;
  transcriptionBaseUrl: string;
  transcriptionPrompt: string;
  ankiUrl: string;
  defaultDeck: string;
  cloudSync: CloudSyncConfiguration;
  /** Number of local metadata snapshots kept before old ones are pruned. */
  backupLimit: number;
}

export interface LocalTranscriptionBenchmark {
  model: AppSettings["localTranscriptionModel"];
  acceleration: "cpu" | "nvidia";
  realtimeFactor: number;
  durationSeconds: number;
  elapsedSeconds: number;
  gpuUsed: boolean;
  gpuUtilizationPercent?: number;
  vramUsedMb?: number;
  vramTotalMb?: number;
  measuredAt: string;
}

/** A provider-neutral direct cloud target. */
export type CloudSyncProvider = "onedrive" | "google-drive" | "dropbox";

export interface CloudSyncConfiguration {
  provider: CloudSyncProvider;
  /** Empty means the root of the chosen service. */
  remotePath: string;
  /** Stored only after the provider's OAuth flow has completed. */
  connectedAt?: string;
  accountLabel?: string;
  lastSyncedAt?: string;
  /** Sync in the background on app start and protect data by syncing before close. */
  autoSyncOnStartAndClose: boolean;
}

export interface LibraryBackup {
  id: string;
  createdAt: string;
  reason: "import" | "deletion" | "manual";
  nodes: LibraryNode[];
  lectures: Record<string, LectureData>;
  segments: TranscriptSegment[];
  markers: Marker[];
  cards: Flashcard[];
  settings: AppSettings;
  assetCount: number;
}

export interface StoredAsset {
  id: string;
  lectureId: string;
  /** Owning library object for reusable course/module/topic context files. */
  nodeId?: string;
  kind: "audio" | "slides" | "file";
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
  /** Text extracted locally from a supported context file. */
  extractedText?: string;
  /** Name, byte size and modification time of an imported source recording. */
  sourceFingerprint?: string;
}

export interface RecordingSession {
  id: string;
  lectureId: string;
  name: string;
  mimeType: string;
  status: "recording" | "paused" | "interrupted";
  duration: number;
  createdAt: string;
}

export interface RecordingChunk {
  id: string;
  sessionId: string;
  sequence: number;
  blob: Blob;
}

export type BackgroundJobKind = "download" | "transcription" | "library";
export type BackgroundJobStatus =
  "queued" | "active" | "complete" | "error" | "cancelled";

export interface BackgroundJob {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  phase: string;
  status: BackgroundJobStatus;
  current: number;
  total?: number;
  detail?: string;
  startedAt: string;
  updatedAt: string;
}

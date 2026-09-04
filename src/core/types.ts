export type NodeType = "workspace" | "course" | "module" | "topic" | "lecture";

export interface LibraryNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  context: string;
  createdAt: string;
  settings: {
    language?: string;
    ankiDeck?: string;
    cardStyle?: string;
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
}

export interface LectureData {
  lectureId: string;
  notes: string;
  slideText?: string;
  audioAssetId?: string;
  audioName?: string;
  /**
   * Known duration in seconds. MediaRecorder WebM blobs do not always expose
   * duration metadata to Chromium, so recordings retain their measured length.
   */
  audioDuration?: number;
  slideAssetId?: string;
  slideName?: string;
}

export interface ThemePalette {
  id: string;
  name: string;
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  primarySoftHover: string;
  primaryText: string;
  accentText: string;
  focusRing: string;
  hero: string;
  heroText: string;
}

export interface AppSettings {
  locale: "sv" | "en";
  onboardingDismissed: boolean;
  librarySidebarCollapsed: boolean;
  selectedPaletteId: string;
  customPalettes: ThemePalette[];
  userContext: string;
  aiMode: "clipboard" | "api";
  aiProvider: "openai" | "anthropic" | "gemini" | "groq";
  aiModel: string;
  aiBaseUrl: string;
  transcriptionProvider: "local" | "manual" | "openai" | "groq";
  localTranscriptionModel:
    "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3";
  localTranscriptionAcceleration: "auto" | "cpu" | "nvidia";
  transcriptionModel: string;
  transcriptionBaseUrl: string;
  transcriptionPrompt: string;
  ankiUrl: string;
  defaultDeck: string;
}

export interface StoredAsset {
  id: string;
  lectureId: string;
  kind: "audio" | "slides" | "file";
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
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

export type BackgroundJobKind = "download" | "transcription";
export type BackgroundJobStatus = "active" | "complete" | "error";

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

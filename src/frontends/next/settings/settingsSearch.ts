import type { SettingsCategoryId } from "./SettingsPanels";

export type SettingsSearchCategoryId = "library" | SettingsCategoryId;

export type SettingsSearchEntry = {
  category: SettingsSearchCategoryId;
  title: string;
  target: string;
  fallbackTarget?: string;
  terms: string;
};

/** Visible settings and common names students may use to look for them. */
export const settingsSearchEntries: SettingsSearchEntry[] = [
  {
    category: "library",
    title: "Importera bibliotek",
    target: "library-import",
    terms: "importera import läs in flytta in zip json bibliotek",
  },
  {
    category: "library",
    title: "Exportera bibliotek",
    target: "library-export",
    terms:
      "exportera export spara ladda ner zip json säkerhetskopia backup data",
  },
  {
    category: "library",
    title: "Spara återställningspunkt",
    target: "backup-create",
    terms: "backup säkerhetskopia återställning historik version kopia",
  },
  {
    category: "library",
    title: "Antal återställningspunkter",
    target: "backup-limit",
    terms: "backup säkerhetskopia behåll antal lagringsutrymme historik",
  },
  {
    category: "general",
    title: "Språk",
    target: "language",
    terms: "språk language svenska english översättning translation gränssnitt",
  },
  {
    category: "appearance",
    title: "Färgtema",
    target: "color-theme",
    terms:
      "tema theme färg färger color palette palett ljus ljust mörk mörkt dark light blue orange blå orange utseende",
  },
  {
    category: "audio",
    title: "Mikrofon",
    target: "microphone",
    terms: "mikrofon mic inspelning ljudenhet recording input windows standard",
  },
  {
    category: "audio",
    title: "Ljudkvalitet",
    target: "recording-quality",
    terms:
      "ljud kvalitet inspelning filstorlek komprimering compact balanced high",
  },
  {
    category: "transcription",
    title: "Transkriptionsmotor",
    target: "transcription-method",
    terms:
      "transkribering transkription transcription transcribe speech to text stt tal text lokal moln api manuellt",
  },
  {
    category: "transcription",
    title: "Whisper-modell",
    target: "whisper-model",
    terms: "whisper tiny base small medium large modell nedladdning",
  },
  {
    category: "transcription",
    title: "Acceleration",
    target: "transcription-acceleration",
    terms: "gpu grafikkort nvidia cuda cpu amd snabbare acceleration hårdvara",
  },
  {
    category: "transcription",
    title: "NVIDIA-runtime",
    target: "nvidia-runtime",
    fallbackTarget: "transcription-acceleration",
    terms: "gpu grafikkort nvidia cuda runtime installera drivrutin",
  },
  {
    category: "transcription",
    title: "Transkriptionsleverantör",
    target: "transcription-provider",
    fallbackTarget: "transcription-method",
    terms: "api moln openai groq leverantör provider speech tal",
  },
  {
    category: "transcription",
    title: "Transkriptionsmodell",
    target: "transcription-model",
    fallbackTarget: "transcription-method",
    terms: "api modell whisper-1 whisper-2 gpt-4o-mini-transcribe groq",
  },
  {
    category: "transcription",
    title: "API-nyckel för transkribering",
    target: "transcription-api-key",
    fallbackTarget: "transcription-method",
    terms: "api key nyckel lösenord credential openai groq",
  },
  {
    category: "transcription",
    title: "Medicinskt fraslexikon",
    target: "phrase-lexicon",
    terms:
      "fraslexikon ordlista medicinska ord terminologi stavning whisper kontext",
  },
  {
    category: "image-analysis",
    title: "OCR och bildanalys",
    target: "visual-method",
    terms:
      "ocr textigenkänning bildanalys bildtext slides bilder lokalt api moln",
  },
  {
    category: "image-analysis",
    title: "PaddleOCR",
    target: "paddle-ocr",
    terms: "ocr paddle text läsa textutklipp lokalt offline",
  },
  {
    category: "image-analysis",
    title: "Bildanalysmodell",
    target: "visual-model",
    fallbackTarget: "visual-method",
    terms: "modell vision bild beskrivning openai gpt-4.1-mini",
  },
  {
    category: "image-analysis",
    title: "API-nyckel för bildanalys",
    target: "visual-api-key",
    fallbackTarget: "visual-method",
    terms: "api key nyckel lösenord credential openai bilder vision",
  },
  {
    category: "ai-anki",
    title: "Arbetssätt för kortgenerering",
    target: "generation-method",
    terms:
      "anki kortgenerering skapa kort ai copy paste klistra chatgpt claude api",
  },
  {
    category: "ai-anki",
    title: "Mängd kort",
    target: "card-density",
    terms: "anki antal mängd få lagom många density kort",
  },
  {
    category: "ai-anki",
    title: "Generella instruktioner",
    target: "generation-context",
    terms:
      "anki context kontext instruktioner prompt medicinsk kurs terminologi",
  },
  {
    category: "ai-anki",
    title: "AI-leverantör",
    target: "ai-provider",
    fallbackTarget: "generation-method",
    terms:
      "ai api openai anthropic claude gemini groq custom leverantör provider",
  },
  {
    category: "ai-anki",
    title: "AI-modell",
    target: "ai-model",
    fallbackTarget: "generation-method",
    terms: "ai modell gpt claude gemini groq namn",
  },
  {
    category: "ai-anki",
    title: "API-basadress",
    target: "ai-base-url",
    fallbackTarget: "generation-method",
    terms: "api endpoint url basadress openai kompatibel lokal",
  },
  {
    category: "ai-anki",
    title: "API-nyckel för AI",
    target: "ai-api-key",
    fallbackTarget: "generation-method",
    terms:
      "api key nyckel lösenord credential openai anthropic claude gemini groq",
  },
  {
    category: "ai-anki",
    title: "AnkiConnect",
    target: "anki-connection",
    terms: "anki sync synka anslutning ankiconnect adress url addon tillägg",
  },
  {
    category: "ai-anki",
    title: "Huvudkortlek",
    target: "anki-deck",
    terms: "anki deck kortlek underkortlek kurs modul föreläsning",
  },
  {
    category: "sync",
    title: "Google Drive-konto",
    target: "drive-account",
    terms: "google drive konto oauth anslut koppla från synka moln",
  },
  {
    category: "sync",
    title: "Mapp i Google Drive",
    target: "drive-folder",
    terms: "google drive mapp folder sökväg root rot inbox lectio lagring",
  },
  {
    category: "sync",
    title: "Synka vid start och stängning",
    target: "auto-sync",
    terms:
      "google drive auto automatisk synk synka uppstart start stängning avsluta",
  },
];

export function normalizeSettingsSearch(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv-SE")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) i++;
    else if (right.length > left.length) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < left.length || j < right.length) edits++;
  return edits <= 1;
}

function tokenMatches(query: string, candidate: string): boolean {
  if (candidate.includes(query)) return true;
  return (
    query.length >= 6 &&
    candidate.length >= 6 &&
    editDistanceAtMostOne(query, candidate)
  );
}

export function searchSettings(query: string): SettingsSearchEntry[] {
  const queryTokens = normalizeSettingsSearch(query);
  if (!queryTokens.length) return [];

  return settingsSearchEntries
    .map((entry) => {
      const title = normalizeSettingsSearch(entry.title);
      const candidates = normalizeSettingsSearch(
        `${entry.title} ${entry.terms}`,
      );
      let score = 0;
      for (const token of queryTokens) {
        if (!candidates.some((candidate) => tokenMatches(token, candidate))) {
          return { entry, score: -1 };
        }
        if (title.some((word) => word === token)) score += 4;
        else if (title.some((word) => word.startsWith(token))) score += 3;
        else score += 1;
      }
      return { entry, score };
    })
    .filter(({ score }) => score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.title.localeCompare(b.entry.title, "sv-SE"),
    )
    .map(({ entry }) => entry);
}

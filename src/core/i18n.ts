const messages = {
  sv: {
    appName: "Lectio",
    library: "Bibliotek",
    search: "Sök i biblioteket…",
    newItem: "Nytt",
    overview: "Översikt",
    lecture: "Föreläsning",
    cards: "Anki-kort",
    settings: "Inställningar",
    context: "Kontext",
    notes: "Anteckningar",
    transcript: "Transkript",
    markers: "Markeringar",
    slides: "Slides",
    recording: "Inspelning",
    save: "Spara",
    cancel: "Avbryt",
    delete: "Ta bort",
  },
  en: {
    appName: "Lectio",
    library: "Library",
    search: "Search library…",
    newItem: "New",
    overview: "Overview",
    lecture: "Lecture",
    cards: "Anki cards",
    settings: "Settings",
    context: "Context",
    notes: "Notes",
    transcript: "Transcript",
    markers: "Markers",
    slides: "Slides",
    recording: "Recording",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
  },
} as const;

export type TranslationKey = keyof typeof messages.sv;
export const translate = (locale: "sv" | "en", key: TranslationKey) =>
  messages[locale][key];

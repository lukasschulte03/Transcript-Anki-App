import type { Flashcard, LibraryNode } from "../core/types";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { netFetch } from "./platform";
import { isTauri } from "./platform";

function validateAnkiEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AnkiConnect-adressen är ogiltig");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("AnkiConnect måste köras lokalt på den här datorn");
  }
  return url.toString();
}

async function invoke(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
) {
  const response = await netFetch(validateAnkiEndpoint(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  if (!response.ok)
    throw new Error(`AnkiConnect svarade med ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}
export const testAnki = (url: string) => invoke(url, "version");
export async function openAnkiDesktop() {
  if (!isTauri()) throw new Error("Öppna Anki Desktop och försök igen.");
  return tauriInvoke<void>("open_anki_desktop");
}
export const getDecks = (url: string) =>
  invoke(url, "deckNames") as Promise<string[]>;

export const deleteNote = (url: string, noteId: number) =>
  invoke(url, "deleteNotes", { notes: [noteId] });

export async function ensureDeck(url: string, deck: string) {
  const name = deck.trim() || "Lectio";
  const decks = await getDecks(url);
  if (!decks.includes(name)) {
    await invoke(url, "createDeck", { deck: name });
  }
  return name;
}

const deckPart = (value: string, fallback: string) =>
  value.trim().replace(/::/g, " – ") || fallback;

const isStructuralTag = (tag: string) =>
  /^#?(course|module|lecture)::/iu.test(tag.trim());

export const withoutStructuralTags = (tags: string[]) =>
  tags.filter((tag) => !isStructuralTag(tag));

export function lectureDeckName(
  nodes: LibraryNode[],
  lectureId: string,
  fallbackDeck = "Lectio",
) {
  const chain: LibraryNode[] = [];
  const visited = new Set<string>();
  let current = nodes.find((node) => node.id === lectureId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentId
      ? nodes.find((node) => node.id === current?.parentId)
      : undefined;
  }

  const course = chain.find((node) => node.type === "course");
  const modules = chain.filter((node) => node.type === "module");
  const lecture = chain.find((node) => node.type === "lecture");
  if (!course || !lecture) return deckPart(fallbackDeck, "Lectio");

  return [
    `${deckPart(course.title, "Namnlös kurs")} - Lectio`,
    ...modules.map((module) => deckPart(module.title, "Namnlös modul")),
    deckPart(lecture.title, "Namnlös föreläsning"),
  ].join("::");
}

export const needsAnkiSync = (card: Flashcard, deck: string) =>
  card.status === "approved" || !card.ankiId || card.ankiDeck !== deck;

/** Anki's Cloze note type only creates cards when Text contains this syntax. */
export const hasClozeMarkup = (value: string) =>
  /\{\{c\d+::[^{}]+(?:::[^{}]*)?\}\}/u.test(value);

function validateCardForAnki(card: Flashcard) {
  if (card.type === "cloze" && !hasClozeMarkup(card.front)) {
    throw new Error(
      "Cloze-kortet saknar Anki-markering. Skriv till exempel {{c1::svaret}} i frågefältet.",
    );
  }
}

type AnkiNoteInfo = { modelName?: string; tags?: string[] };
export type AnkiCardMedia = { filename: string; data: string; caption: string };

async function fieldsForCard(
  url: string,
  modelName: "Basic" | "Cloze",
  card: Flashcard,
  media?: AnkiCardMedia,
) {
  const names = (await invoke(url, "modelFieldNames", {
    modelName,
  })) as string[];
  if (modelName === "Cloze") {
    const text = names.includes("Text") ? "Text" : names[0];
    const extra = names.includes("Extra")
      ? "Extra"
      : names.includes("Back Extra")
        ? "Back Extra"
        : names[1];
    if (!text) throw new Error("Korttypen Cloze saknar fältet Text");
    // Extra is optional in custom Cloze note types. Text is the only required
    // field for Anki to create a cloze card.
    const back = media
      ? `${card.back}<br><img src="${media.filename}"><div><small>${media.caption}</small></div>`
      : card.back;
    return extra
      ? { [text]: card.front, [extra]: back }
      : { [text]: card.front };
  }
  const front = names.includes("Front") ? "Front" : names[0];
  const back = names.includes("Back") ? "Back" : names[1];
  if (!front || !back)
    throw new Error("Korttypen Basic saknar förväntade fält");
  const backValue = media
    ? `${card.back}<br><img src="${media.filename}"><div><small>${media.caption}</small></div>`
    : card.back;
  return { [front]: card.front, [back]: backValue };
}

async function addCardNote(
  url: string,
  deck: string,
  modelName: "Basic" | "Cloze",
  fields: Record<string, string>,
  tags: string[],
  allowDuplicate = false,
) {
  return invoke(url, "addNote", {
    note: {
      deckName: deck,
      modelName,
      fields,
      options: { allowDuplicate },
      tags: ["lectio", ...tags],
    },
  }) as Promise<number>;
}

export async function syncCard(
  url: string,
  deck: string,
  card: Flashcard,
  media?: AnkiCardMedia,
) {
  const modelName = card.type === "cloze" ? "Cloze" : "Basic";
  validateCardForAnki(card);
  if (media)
    await invoke(url, "storeMediaFile", {
      filename: media.filename,
      data: media.data,
    });
  const fields = await fieldsForCard(url, modelName, card, media);
  const tags = withoutStructuralTags(card.tags);
  if (card.ankiId) {
    const notes = (await invoke(url, "notesInfo", {
      notes: [card.ankiId],
    })) as AnkiNoteInfo[];
    const existingNote = notes[0];

    // A note cannot change between Basic and Cloze in-place. Create its
    // replacement first, then remove the old note only after that succeeded.
    if (existingNote?.modelName && existingNote.modelName !== modelName) {
      const replacementId = await addCardNote(
        url,
        deck,
        modelName,
        fields,
        tags,
        true,
      );
      await deleteNote(url, card.ankiId);
      return replacementId;
    }

    await invoke(url, "updateNoteFields", {
      note: { id: card.ankiId, fields },
    });
    const obsoleteTags = (existingNote?.tags ?? []).filter(isStructuralTag);
    if (obsoleteTags.length) {
      await invoke(url, "removeTags", {
        notes: [card.ankiId],
        tags: obsoleteTags.join(" "),
      });
    }
    await invoke(url, "addTags", {
      notes: [card.ankiId],
      tags: ["lectio", ...tags].join(" "),
    });
    const cardIds = (await invoke(url, "findCards", {
      query: `nid:${card.ankiId}`,
    })) as number[];
    if (cardIds.length) {
      await invoke(url, "changeDeck", { cards: cardIds, deck });
    }
    return card.ankiId;
  }
  return addCardNote(url, deck, modelName, fields, tags);
}

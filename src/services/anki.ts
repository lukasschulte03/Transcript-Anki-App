import type { Flashcard, LibraryNode } from "../core/types";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { netFetch } from "./platform";
import { isTauri } from "./platform";

async function invoke(
  url: string,
  action: string,
  params: Record<string, unknown> = {},
) {
  const response = await netFetch(url, {
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

async function fieldsForCard(
  url: string,
  modelName: "Basic" | "Cloze",
  card: Flashcard,
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
    if (!text || !extra)
      throw new Error("Korttypen Cloze saknar förväntade fält");
    return { [text]: card.front, [extra]: card.back };
  }
  const front = names.includes("Front") ? "Front" : names[0];
  const back = names.includes("Back") ? "Back" : names[1];
  if (!front || !back)
    throw new Error("Korttypen Basic saknar förväntade fält");
  return { [front]: card.front, [back]: card.back };
}

export async function syncCard(url: string, deck: string, card: Flashcard) {
  const modelName = card.type === "cloze" ? "Cloze" : "Basic";
  const fields = await fieldsForCard(url, modelName, card);
  const tags = withoutStructuralTags(card.tags);
  if (card.ankiId) {
    await invoke(url, "updateNoteFields", {
      note: { id: card.ankiId, fields },
    });
    const notes = (await invoke(url, "notesInfo", {
      notes: [card.ankiId],
    })) as Array<{ tags?: string[] }>;
    const obsoleteTags = (notes[0]?.tags ?? []).filter(isStructuralTag);
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
  return invoke(url, "addNote", {
    note: {
      deckName: deck,
      modelName,
      fields,
      options: { allowDuplicate: false },
      tags: ["lectio", ...tags],
    },
  }) as Promise<number>;
}

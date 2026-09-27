import type { Flashcard } from "../core/types";

export interface CardReplacementPlan {
  /** Existing cards retained for duplicate checking and prompt context. */
  referenceCards: Flashcard[];
  /** Old cards to remove only after replacement cards have been created. */
  replacedCardIds: string[];
}

export function planCardReplacement(
  existingCards: Flashcard[],
  lectureId: string,
  overwrite: boolean,
): CardReplacementPlan {
  const replacedCardIds = overwrite
    ? existingCards
        .filter((card) => card.lectureId === lectureId)
        .map((card) => card.id)
    : [];
  const replaced = new Set(replacedCardIds);
  return {
    referenceCards: existingCards.filter((card) => !replaced.has(card.id)),
    replacedCardIds,
  };
}

/** Keeps prior content intact when generation fails or returns no usable cards. */
export function commitCardReplacement(
  plan: CardReplacementPlan,
  generatedCards: Array<Omit<Flashcard, "id">>,
  store: Pick<
    {
      addCards: (cards: Array<Omit<Flashcard, "id">>) => string[];
      removeCard: (id: string) => void;
    },
    "addCards" | "removeCard"
  >,
): boolean {
  if (!generatedCards.length) return false;
  store.addCards(generatedCards);
  plan.replacedCardIds.forEach((id) => store.removeCard(id));
  return true;
}

# Anki and card-generation boundaries

## Product contract

- Default generation uses a copy/paste handoff. API and local generation produce the same internal card format.
- Prefer a small number of understandable generation choices over technical token/model controls.
- Generated cards are reviewed before sync. Anki sync is incremental and must handle updates and deletions of already-synced cards.
- Cloze cards require Anki-compatible cloze markup and the correct note type.

## Main paths

- Prompt construction, response parsing and duplicate checks: `src/services/ai.ts` and `src/services/ankiChunking.ts`.
- AnkiConnect deck, note, media and sync operations: `src/services/anki.ts`.
- Card workspace and review UI: `src/features/cards/CardStudio.tsx`.
- Shared statuses and source fields: `src/core/types.ts`.

## Verification focus

Use mocked AnkiConnect for Basic and Cloze cards, deck naming, media attachment, updates and deletions. Never require a real Anki profile in ordinary tests.

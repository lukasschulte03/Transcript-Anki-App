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

## Slidebilder

- Bildindexet består av lokala OCR-/visionsbeskrivningar och stabila
  `visualId`-referenser. Endast den kompakta beskrivningen, aldrig bildbytes,
  går till AI-modellen när den väljer en relevant bild till ett kort.
- När ett godkänt kort synkas till Anki renderar Lectio just det valda
  bildutklippet från den lokala originalsliden, laddar upp det som Anki-media
  och lägger bilden i kortets svarsfält (eller Cloze-fältet `Extra`).
- Biblioteksexport och Google Drive-synk bevarar originalslides/media,
  bildindexet och kortets `visualId`. Lokala thumbnails är bara en
  återbyggbar cache och exporteras eller synkas inte.

### Lokal bildmotor

- Automatisk bildbeskrivning är ett frivilligt Nvidia-läge. Lectio installerar
  en fast version av den lokala bildmotorn i PP-Structure-runtime och håller
  en enda worker i minnet medan bildkön körs.
- Bildutklipp skickas över lokal standard input/output mellan Tauri och
  workern; ingen HTTP-server eller extern AI-tjänst används.
- Första modellstarten kan ta längre tid medan vikter hämtas och cacheas
  lokalt. Därefter körs bilder sekventiellt, med befintlig kö och avbrytning.

## Verification focus

Use mocked AnkiConnect for Basic and Cloze cards, deck naming, media attachment, updates and deletions. Never require a real Anki profile in ordinary tests.

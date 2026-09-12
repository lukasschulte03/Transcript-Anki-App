# Transcription boundaries

## Product contract

- Preserve imported or recorded original audio even when transcription fails, is cancelled or a provider is unavailable.
- Treat transcription as a background job with visible state, cancellation and diagnostic errors.
- Keep provider-specific logic behind `TranscriptionProvider` or local-STT service boundaries; UI code should consume normalized transcript segments.
- Inherited study context is not general transcription input. Only the editable transcription glossary/phrase context is sent to STT prompting.

## Main paths

- Shared provider contracts and parsing: `src/services/transcription.ts`.
- Local Whisper models, NVIDIA runtime, audio preparation and cancellation: `src/services/localStt.ts`.
- Queue and background-job state: `src/services/transcriptionQueue.ts` and `src/core/types.ts`.
- Native executable invocation and progress: `src-tauri/src/lib.rs`.

## Långa lokala inspelningar

- Vanliga inspelningar körs fortfarande i en enda Whisper-process.
- Inspelningar på minst 35 minuter konverteras till en lokal 16 kHz-WAV och
  delas därefter i 20-minutersdelar med fem sekunders överlappning.
- Varje färdig del sparas i en innehållsbaserad, temporär arbetsmapp. Om jobbet
  avbryts fortsätter samma ljud, modell och fraslexikon från första saknade del
  vid nästa försök.
- Endast bokstavligt identiska segment i den avsiktliga överlappningen tas bort;
  övrigt tal bevaras. Originalinspelningen ändras aldrig.
- När hela transkriptet har slagits ihop rensas alla temporära WAV-, del- och
  JSON-filer. Avbrutna eller misslyckade långjobb behåller endast sina lokala
  återupptagningsartefakter.

## Verification focus

For transcription changes, cover success, cancellation, missing executable/model, malformed provider output and preservation of the audio reference. Do not require a real model download or real lecture audio in ordinary automated tests.

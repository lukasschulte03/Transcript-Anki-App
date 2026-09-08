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

## Verification focus

For transcription changes, cover success, cancellation, missing executable/model, malformed provider output and preservation of the audio reference. Do not require a real model download or real lecture audio in ordinary automated tests.

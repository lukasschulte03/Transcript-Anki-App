# Agent context for Lectio

Use this file as a routing index, not as a replacement for the source code. For a non-trivial change, read the smallest relevant document below, then use Graphify to locate the affected code.

| Area | Read first | Primary code entry points |
| --- | --- | --- |
| App shell, navigation, native title bar | [architecture.md](architecture.md) | `src/App.tsx`, `src/components/AppNavigation.tsx`, `src/components/WindowTitleBar.tsx` |
| Library, entities and local persistence | [architecture.md](architecture.md) | `src/core/types.ts`, `src/core/store.ts`, `src/core/database.ts` |
| Transcription and local models | [transcription.md](transcription.md) | `src/services/transcription*.ts`, `src/services/localStt.ts`, `src-tauri/src/lib.rs` |
| Anki generation or syncing | [anki.md](anki.md) | `src/services/ai.ts`, `src/services/anki*.ts`, `src/features/cards/` |
| Google Drive or library merge | [sync.md](sync.md) | `src/services/syncV2.ts`, `src/services/googleDrive*.ts`, `src/services/libraryMerge.ts` |
| Release, installer or Windows validation | [WINDOWS_RELEASE_CHECKLIST.md](WINDOWS_RELEASE_CHECKLIST.md) | `src-tauri/`, `scripts/windows-release-gate.mjs` |
| Bug reports and diagnostics | [feedback-system.md](feedback-system.md) | `src/services/diagnostics.ts`, `src/components/FeedbackDialog.tsx` |

## Stable product decisions

- Windows desktop is the current release target; keep platform-specific details isolated behind services/Tauri commands when practical.
- The library is local-first. Cloud sync is optional and must not be required for normal study workflows.
- Copy/paste AI is the default card-generation path. API and local providers are optional alternatives behind shared interfaces.
- Local transcription must remain available and keep the original audio independently of transcription success.
- Generated Anki cards require review/approval before normal sync.

## Context budget rules

- Prefer a scoped Graphify query, path or explain command before broad `rg`/file reads.
- Read direct imports and callers only after the graph identifies them.
- Run the narrowest relevant verification command. Reserve `pnpm check` and desktop builds for release-risk changes.
- Update this routing file only when an entry point or a stable product decision changes.

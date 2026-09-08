# Sync boundaries

## Product contract

- The local library remains usable offline; Google Drive is optional.
- Sync must make a backup before potentially destructive reconciliation.
- Merge data at the smallest safe entity/asset granularity. Do not replace an entire library merely because another device changed one lecture.
- Keep remote credentials out of exports, diagnostics and ordinary app data.
- Network failures, cancelled authentication and stale remote state must return the UI to a retryable state.

## Main paths

- Versioned operation planning and application: `src/services/syncV2.ts`.
- Google Drive OAuth and remote I/O: `src/services/googleDriveSync.ts` and `src-tauri/src/lib.rs`.
- Legacy-compatible orchestration and merge helpers: `src/services/sync.ts`, `src/services/libraryMerge.ts`, `src/services/libraryBackup.ts`.
- Sync settings and app state: `src/core/types.ts`, `src/core/store.ts`.

## Verification focus

Test with temporary data and mocked Drive responses: unchanged libraries, independent changes on two devices, conflicting edits, newly added assets, deletions, interrupted uploads and restoring a backup. Never use real Drive credentials in automated tests.

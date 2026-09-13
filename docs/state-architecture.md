# State and repository boundary

Lectio keeps four responsibilities distinct:

1. **Domain and application** — framework-independent types, rules, queries and commands.
2. **Durable library state** — nodes, lectures, transcripts, markers, cards and settings.
3. **UI session state** — current selection and active view; currently implemented by the compatibility Zustand store.
4. **Process jobs** — transcription, sync, OCR and download progress in the non-persistent infrastructure `useJobStore`.

New frontends use the framework-independent contract in `src/application/lectioClient.ts` through the React bindings in `src/frontends/shared/`. They must not import `src/core/store.ts`, Dexie tables or concrete Tauri/provider services. The production adapter in `src/infrastructure/lectioClientAdapter.ts` intentionally hides whether durable state currently comes from Zustand, localStorage or Dexie.

`pnpm check:boundaries` enforces that services do not import the concrete store and that future frontend roots do not bypass the application boundary.

## Persistence transition

The current Zustand key remains `lectio-state-v1` for compatibility. Its payload is now an explicit allowlist from `persistedAppState`; actions and jobs cannot be serialized.

On first successful read, the validated localStorage snapshot is transactionally mirrored into Dexie's `libraryStates` table and the untouched original is retained in `stateMigrationBackups`. Subsequent writes synchronously update localStorage as a crash-safe rollback copy and asynchronously update Dexie. On startup:

- a valid local snapshot wins if it is newer than the mirror;
- a valid Dexie snapshot recovers a missing or damaged local snapshot;
- a damaged payload is retained under the existing corrupt-backup key;
- no empty starter state overwrites a valid backup automatically.

The localStorage rollback copy must not be removed until UI Next and the full stability run have verified multiple successful restarts. Diagnostics expose the selected repository source and whether fallback was used.

## Adding UI Next

Use `LectioClient` and the hooks exported from `src/frontends/shared/useLectioClient.ts`. Add missing application operations to the contract and infrastructure adapter rather than reaching through to Zustand. High-frequency progress belongs in the infrastructure job store; binary assets and repository state belong in Dexie. Domain rules such as library movement belong in `src/domain/` and remain independently testable.

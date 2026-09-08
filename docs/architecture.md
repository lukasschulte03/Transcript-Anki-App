# Architecture overview

Lectio is a Windows-first Tauri desktop application. React renders the interface; TypeScript services implement application workflows; Rust/Tauri owns desktop capabilities, credentials and native integrations.

## Boundaries

- `src/core/` contains shared types, Zustand state, Dexie asset storage, translations and theme tokens.
- `src/features/` contains user-facing workflows. A feature composes state and services but should not duplicate provider or storage logic.
- `src/services/` owns integrations and domain workflows: transcription, AI, Anki, assets, sync, import/export and diagnostics.
- `src/components/` contains reusable interface elements and the application shell.
- `src-tauri/` contains native commands, permissions, bundled resources and Windows packaging.

## Data ownership

Structured library data lives in the application state/export format. Larger lecture assets are stored separately and referenced as assets. API credentials belong in OS credential storage, never ordinary application data or exports.

## Change guide

- Change shared data shapes in `src/core/types.ts` first, then update persistence, services and UI consumers.
- Keep a browser fallback only where it is explicitly supported; do not silently emulate privileged desktop behaviour in web mode.
- For native-window, credential, filesystem or opener changes, verify the corresponding Tauri capability/ACL as well as the React caller.
- A UI-only change should not alter services or Rust commands unless the user-visible behaviour genuinely needs it.

# QA för Lectio

QA använder alltid en isolerad browserprofil eller en separat Tauri-process. Den får aldrig använda normal Lectio-data, riktiga Anki-noter, API-nycklar eller Google Drive-token.

## Kommandon

- `pnpm qa:browser` — lint, enhetstester, produktionsbygge och Playwright-flöden.
- `pnpm qa:lighthouse` — Lighthouse för browser-renderern. Rapport sparas i `test-results/lighthouse/`.
- `pnpm qa` — browser-QA plus Lighthouse.
- `pnpm qa:desktop` — bygger en release-binary och kör riktiga Windows/Tauri-tester via WebdriverIO. Första körningen kan installera `tauri-driver` och hämta en matchande Edge WebDriver.

## Artefakter vid fel

Playwright sparar trace, video, skärmbild, HTML-rapport och renderer-fel under `test-results/`. Desktop-QA sparar WebDriverIO- och Tauri-loggar under `test-results/desktop/`.

## Testprinciper

- Browser-E2E sår ett deterministiskt testbibliotek i `localStorage`; varje test får egen context.
- AnkiConnect mockas med lokal route/fetch-mock.
- Synk testas med temporära snapshots och mockade svar, aldrig mot verklig Drive.
- PDF-, ljud- och export/import-test använder små testdata i minnet.
- Visuella screenshots är en avsiktlig regressionssignal. Uppdatera dem endast efter manuell UI-granskning.

## Release

Kör `pnpm qa` före en vanlig ändring som berör UI eller dataflöden. Kör även `pnpm qa:desktop` före en Windows-release när Tauri, fönsterhantering, behörigheter eller native funktioner har ändrats.

# QA för Lectio

QA använder alltid en isolerad browserprofil eller en separat Tauri-process. Den får aldrig använda normal Lectio-data, riktiga Anki-noter, API-nycklar eller Google Drive-token.

## Kommandon

- `pnpm qa:browser` — lint, enhetstester, produktionsbygge och Playwright-flöden.
- `pnpm qa:lighthouse` — Lighthouse för browser-renderern. Rapport sparas i `test-results/lighthouse/`; körningen är tidsbegränsad så att Windows problem med Chromes temporära profil inte kan låsa QA.
- `pnpm qa` — browser-QA plus Lighthouse.
- `pnpm qa:desktop` — bygger en produktionslik Tauri-binary utan installerare och kör riktiga Windows/Tauri-tester via WebdriverIO i en separat appdatamapp. Första körningen kan installera `tauri-driver` och hämta en matchande Edge WebDriver.

## Artefakter vid fel

Playwright sparar trace, video, skärmbild, HTML-rapport och renderer-fel under `test-results/`. Desktop-QA sparar WebDriverIO- och Tauri-loggar under `test-results/desktop/`.

## Testprinciper

- Browser-E2E sår ett deterministiskt testbibliotek i `localStorage`; varje test får egen context.
- AnkiConnect mockas med lokal route/fetch-mock.
- Synk testas med temporära snapshots och mockade svar, aldrig mot verklig Drive.
- PDF-, ljud- och export/import-test använder små testdata i minnet.
- UI-regressioner täcker samtliga huvudvyer med granskade snapshots i desktopbredd, samt tomma/valda och dialogbaserade kritiska tillstånd.
- Navigationsstress växlar vy, sidofält och viewport femton gånger och stoppar vid renderer-fel, horisontell scroll eller en root-yta som inte längre fyller WebView:n.
- PDF-regression: öppna minst tio olika föreläsningar med PDF-slides i följd och kontrollera att varje byte visar rätt dokument utan frusen panel eller kvarvarande laddare.
- Visuella screenshots är en avsiktlig regressionssignal. Uppdatera dem endast efter manuell UI-granskning.

## Release

Kör `pnpm qa` före en vanlig ändring som berör UI eller dataflöden. Kör även `pnpm qa:desktop` före en Windows-release när Tauri, fönsterhantering, behörigheter eller native funktioner har ändrats. Desktopsviten verifierar vybyte, resize, maximera/återställ och minimera/återställ i ett riktigt Tauri-fönster; stängning och externa länkar kontrolleras fortfarande manuellt enligt Windows-checklistan, eftersom de medvetet avslutar eller lämnar testprocessen.

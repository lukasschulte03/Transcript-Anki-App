# Lokal stability-QA

Kör `pnpm qa:stability` från projektroten inför större ändringar och när en sammanhängande implementation är klar. Körningen är avsiktligt grundligare än `pnpm check` och fortsätter genom oberoende faser för att samla flera fel i samma rapport.

## Isolering

Varje körning får en unik rot under `%TEMP%/lectio-stability/<run-id>/`. Stability-profilen använder en separat IndexedDB-databas och separat Windows `APPDATA`, blockerar externa nätverksanrop och läser eller skriver inte Windows Credential Manager. Google Drive, AnkiConnect och AI-provideranrop ska därför inte kunna nå riktiga konton under testen.

Ett inbyggt säkerhetstest stoppar körningen om testroten överlappar projektet, hemkatalogen, vanlig appdata eller en katalog utanför stability-roten.

## Faser

Körningen omfattar isoleringsskydd, lint, Vitest, TypeScript/Vite-build, Rust-format, Cargo check/test, Playwright, Lighthouse och Windows desktop-E2E. En fas kan misslyckas utan att säkra och oberoende efterföljande faser försvinner ur rapporten.

## Resultat och städning

Den senaste sammanfattningen finns i `test-results/stability/latest-summary.md` och `.json`.

- `READY`: alla faser godkända. Stora artefakter och den temporära testroten tas bort.
- `WARNINGS`: en plattformsberoende fas hoppades över.
- `BLOCKED`: minst en fas misslyckades. En begränsad bundle behålls under `test-results/stability/<run-id>/` med fasloggar, Playwright-artefakter och Lighthouse-rapport.

Högst två äldre felbundles behålls utöver den aktuella. Bundles äldre än 14 dagar eller ett sammanlagt tak på 500 MB rensas automatiskt. Processer som startats av testkörningen avslutas i cleanup även vid avbrott.

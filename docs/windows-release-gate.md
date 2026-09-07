# Windows release-gate

Kör den här checklistan före varje publik Windows-release. Den kompletterar
`pnpm check` och `pnpm desktop:build`; den ersätter inte en faktisk test av den
installerade appen.

## Automatisk kontroll

- [ ] `pnpm check` passerar.
- [ ] `pnpm desktop:build` skapar både NSIS-installatör och MSI.
- [ ] Versionsnumret är samma i `package.json`, `Cargo.toml` och `tauri.conf.json`.
- [ ] Git-status är ren och releasetaggen pekar på den byggda committen.

## Installerad Windows-app

Testa helst på en ren Windows-profil, eller en dator som inte tidigare haft
Lectio installerat.

- [ ] Installera NSIS-paketet och öppna appen.
- [ ] Skapa kurs → modul → föreläsning och starta/stoppa en kort inspelning.
- [ ] Importera en M4A eller MP3, kontrollera uppspelning och lokal Whisper.
- [ ] Skapa kort, testa copy/paste och synka ett Basic- och ett Cloze-kort till AnkiConnect.
- [ ] Exportera och importera ett litet testbibliotek.
- [ ] Testa Google Drive-synk med ett separat testbibliotek; kontrollera en vanlig ändring och en konflikt.
- [ ] Uppdatera från föregående release utan avinstallation och kontrollera att bibliotek, modeller och inställningar finns kvar.
- [ ] Kontrollera fönsterkontroller, filväljare och Windows Credential Manager för API-/Drive-inloggning.

## Återställning och kända begränsningar

- Ta en biblioteksexport innan en extern beta eller en större synkändring.
- Vid ett fel: använd **Rapportera problem** och bifoga anonymiserad diagnostik; ljud,
  slides, transkript och hemligheter inkluderas inte.
- Avinstallera inte appen som felsökningsförsta steg. Uppdatera först ovanpå den
  befintliga installationen för att behålla lokal appdata.
- Google Drive-synk är testbar men ska alltid kontrolleras med ett testbibliotek
  efter en större synkändring. Orelaterade ändringar kan slås ihop; verkliga
  fältkonflikter kräver ett användarval.

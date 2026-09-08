# Windows release-gate

Kör alltid `pnpm desktop:release` från en ren arbetskopia före en extern Windows-release. Kommandot stoppar om versioner, resurser, Tauri-behörigheter, lint, tester eller webbbygge inte är godkända.

Gör sedan denna manuella kontroll på en Windows-profil som inte har använt Lectio tidigare:

- Installera `.exe` eller `.msi`, öppna appen och kontrollera att titelfönster, externa länkar och dialoger fungerar.
- Skapa kurs → modul → ämne → föreläsning; importera en m4a eller mp3 och spela upp den.
- Kör en kort lokal transkribering, skapa ett kort och testa AnkiConnect med Anki Desktop öppet.
- Exportera biblioteket, importera det i en tom Lectio-installation och kontrollera ljud, slides, transkript, kort och context.
- Logga in på Google Drive, synka en liten ändring och kontrollera samma bibliotek på en andra ren installation.
- Uppgradera en tidigare Lectio-installation med ett befintligt bibliotek. Avinstallera inte den gamla versionen före kontrollen.
- Kontrollera Windows Credential Manager: API- och Drive-uppgifter ska finnas där, aldrig i exporter eller vanlig appdata.

## Återställning vid problem

Biblioteket är local-first. Exportera biblioteket före större test eller release. Om en synk/import går fel: stäng appen, öppna Inställningar → Backup och återställ senaste metadata-backupen, eller importera den exporterade biblioteksfilen i en tom installation. Bifoga diagnostikrapporten via Feedback om felet kvarstår.

## Kända begränsningar

- OCR för bildbaserade PDF-sidor kräver nedladdning av språkdata första gången det används.
- Mobil Companion är ännu inte en native app; import via Google Drive-inbox är det rekommenderade mobilflödet.
- Anki-synk kräver Anki Desktop och AnkiConnect på samma dator.

# Utbytbara frontends

Lectio har en gemensam headless kärna och två compile-time-valda React-entrypoints. Frontendvalet sker i Vite innan någon UI-modul importeras; den oanvända frontenden inkluderas därför inte i bundlen eller startupgrafen.

## Lager

```text
domain/             rena regler och invariants
application/        ramverksoberoende LectioClient-kontrakt och DTO:er
infrastructure/     Zustand/Dexie, jobs, Tauri och serviceadaptern
frontends/legacy/   nuvarande produktions-UI, tillfällig fallback
frontends/next/     ren frontend som endast använder LectioClient
frontends/shared/   React-bindningar till kontraktets subscriptions
```

`src/application/lectioClient.ts` är den enda produktgräns som en ny frontend behöver. Den innehåller queries/subscriptions, kommandon, workflows, capabilities, events samt stabila `LectioResult`/`LectioError`-DTO:er. Råa provider-, Dexie- eller Tauri-fel får inte bli ett frontendprotokoll.

`src/infrastructure/lectioClientAdapter.ts` är produktionsadaptern. `src/application/testing/inMemoryLectioClient.ts` är en helt minnesbaserad fake för kontraktstester och UI-utveckling.

## Starta varianterna

```powershell
pnpm desktop:dev:legacy
pnpm desktop:dev:next

pnpm dev:legacy
pnpm dev:next

pnpm build:legacy
pnpm build:next
```

Legacy är fortsatt release-default. Next använder den isolerade dataprofilen `next` som standard och kan därför inte skriva över användarens riktiga bibliotek. Frontendvariant och dataprofil är separata byggval; explicit delad profil är möjlig för kontrollerade kompatibilitetstester, men profilens Web Lock stoppar två samtidiga skrivande processer.

Frontendvalet i `vite.config.ts` mappar aliaset `@lectio-frontend` till exakt en entrypoint. `pnpm check:frontends` bygger båda varianterna i temporära mappar och verifierar att deras UI-kod inte läcker in i varandras bundle. `pnpm test:e2e:next` verifierar Next-slicen, separat persistens och processlåset.

## Lägg till en tredje frontend

1. Skapa `src/frontends/<namn>/entry.tsx` med en default-exporterad komponent som tar `{ client: LectioClient }`.
2. Bygg all dataåtkomst genom `LectioClient` och `frontends/shared/useLectioClient.ts`. Lägg en saknad operation i kontraktet och produktionsadaptern; importera aldrig implementationen i frontenden.
3. Lägg varianten i `FrontendVariant`, `vite.config.ts` och scripts. Ge experimentet en separat dataprofil tills kompatibilitet och backup är verifierade.
4. Lägg kontraktstest, startup-E2E och en bundlemarkör i `check-frontend-builds.mjs`.
5. Kör `pnpm check`, `pnpm qa:frontends` och därefter `pnpm qa:stability` innan varianten får öppna riktig data.

## Next: föreläsningsvy

`NextApp` laddar `lecture/LectureView.tsx` först när en föreläsning väljs. Den nya vyn använder egna komponenter för PDF, ljud och text, inte legacy-panelerna. Slides och transkript är oberoende; inga transkript–slidekopplingar läses eller skapas. Smal arbetsyta visar slides eller textpanelen i taget. Anki-dialogen granskar/godkänner befintliga kort; full kortgenerering och synk i den nya UI:n är inte implementerade där ännu.

`LectioClient.assets.read` läser media. PDF.js renderar bara aktuell sida, med pixelbudget, avbrytbara renderingar och städning av dokument/worker. Sidans inbyggda text finns som skärmläsaralternativ; bildbaserade PDF:er får ingen automatisk OCR vid import. `extractPdfPages(..., {ocr:false})` extraherar text sekventiellt i next-importen. Legacy kan fortfarande begära OCR via standardalternativet.

`LectioClient.recordings` kapslar in start, beständiga ljuddelar, avslut och återställning via `services/lectureRecording.ts`. MediaRecorder sparar var tredje sekund; endast aktuell ljuddel har en objekt-URL. Navigation låses under inspelning och filimport. Transkript redigeras med begränsat antal synliga rader, sökningen behåller träffar under redigering, och anteckningar sparas debouncat samt vid lämnad vy. Transkribering köas med befintliga sparade inställningar.

Det riktade Playwright-flödet i `frontend-entrypoints.spec.ts` använder syntetisk PDF, WAV, biblioteksexport och simulerad mikrofon. Det verifierar import, sidbyte, uppspelning, inspelning, redigering, kortgodkännande, smal layout och omladdning, inklusive konsolfel. Vite förladdar React/Radix Tabs och deduplicerar React för att undvika nya React-instanser när den lazy-laddade vyn öppnas i utvecklingsläge.

## Next: bibliotek och data

`StudySettings.tsx` samlar färdiga kategorier för bibliotek/data, utseende, inspelning, transkribering, AI/Anki och Google Drive. De enkla värdena går genom `LectioClient.settings`; API-nycklar, lokal Whisper/NVIDIA, AnkiConnect och Google OAuth går genom separata kontraktsoperationer så Next aldrig importerar providers, Tauri eller Zustand direkt. Dataprofilen visas uttryckligen; import ersätter endast den aktiva profilens bibliotek, aldrig inställningar eller synkidentitet.

Utseendet har fyra inbyggda paletter: blå och orange i ljus respektive mörk variant. Tidigare standardpaletter migreras till närmaste ljus/mörk blå variant och egna gamla paletter tas inte med i det förenklade systemet. Valet sparas i `AppSettings.selectedPaletteId`; `frontends/next/themes.ts` översätter paletten till både innehållsytor, sidebartext och Grainient-färger.

Filoperationerna går via `LectioClient.workflows` till den lazy-laddade `services/libraryTransfer.ts`. Import validerar före mutation och skapar en återställningspunkt; överlappande media behålls i denna punkt. Vanliga punkter innehåller endast mediareferenser. Återställning vägrar om nödvändiga media saknas. Export innehåller bibliotek och tillhörande media, inte kontoinställningar. Överföringar har progress, storleksgräns 1,5 GB och pausad navigation/redigering; arkiven bearbetas asynkront men fortfarande i minnet. En strömmande export för större bibliotek är framtida arbete.

## Importregler

- Frontends får importera application-/domain-typer, sitt eget UI och delade kontrakthooks.
- Frontends får inte importera Zustand-store, Dexie, `services/`, `infrastructure/`, `src-tauri` eller `@tauri-apps`.
- Application får inte importera React, Zustand, Radix, CSS eller Tauri.
- Infrastructure får inte importera en frontend.
- Legacy-entrypointen är en tidsbegränsad kompatibilitetsbrygga till befintliga `App.tsx`; ny funktionalitet ska inte öka dess koppling.

Reglerna körs av `pnpm check:boundaries`.

## Vägen till Next som standard

Next byggs nu om en yta i taget. Första delen är ett nytt appskal och sidofält i `src/frontends/next/StudySidebar.tsx`, med egen CSS och samlad svensk copy. Det tidigare experimentets material-/transkriptvy har tagits bort; arbetsytan visar tills vidare bara vald destination eller objekttitel och en neutral bakgrund.

Sidofältet läser och ändrar bibliotek via `LectioClient`: skapa kurs/modul/ämne/föreläsning, namnbyte, sökning, scopeval, omordning före ett syskon och flytt till en annan förälder. Drop-feedback använder domänens validering. Trädets öppna grenar och kollaps sparas separat som UI-preferenser under `lectio-next-sidebar-*`; bibliotekets scrollposition bevaras mellan rail/flyout. Navigationens knappar ändrar sessionens vy, men övriga vyer byggs i senare steg.

Sidofältets visuella riktning dokumenteras i `src/frontends/next/DESIGN.md`. `pnpm test:e2e:next` kontrollerar isolerad persistens, profillås och sidofältets huvudflöden. Standard byts först när feature-parity-matrisen och hela `qa:stability` är gröna mot en kopia av ett realistiskt bibliotek. Ett frontendbyte får aldrig i sig trigga datamigrering.

# Lectio

Lectio är en local-first Windows-app för att samla föreläsningar, spela in ljud, arbeta med tidsstämplade transkript och skapa granskade Anki-kort. Gränssnittet är på svenska och byggt för att kräva så lite interaktion som möjligt under en föreläsning.

## Funktioner i version 0.4.8

- Tydlig akademisk struktur: kurs → modul → ämne eller föreläsning.
- Ärftlig context från studieprofil till kurs, modul och föreläsning.
- Mikrofoninspelning med paus, uppspelning, hastighet och import av ljudfiler.
- Inspelningen sparas stegvis i beständiga segment och kan återställas efter ett avbrott.
- PDF- och bildvisning direkt i föreläsningsytan.
- Tidsstämplade, redigerbara transkript med synkroniserad ljudnavigation.
- Anteckningar och snabba tidsmarkeringar.
- Global lokal sökning i titlar, context, anteckningar, transkript, markeringar och kort.
- Valbara AI-källor, kvalitetsregler, slide-text och ärvd kortstil per studieobjekt.
- Kortgenerering via copy/paste eller egna API-nycklar för OpenAI, Anthropic, Gemini, Groq och OpenAI-kompatibla endpoints.
- Kostnadsfri lokal transkribering med whisper.cpp och valbara Tiny-, Base- och Small-modeller.
- Transkribering via OpenAI-kompatibla speech-to-text-API:er som alternativ.
- Validering och granskning av AI-genererade kort innan Anki-synk.
- AnkiConnect-integration med hämtning av lekar, status, sparat Anki-ID och uppdatering av synkade kort.
- ZIP-export och import av bibliotekets strukturerade data, ljud, PDF:er och bilder.
- Direkt Google Drive-synk utan separat Drive-app. Standardplatsen är `Lectio` i Drive-roten och kan ändras till en egen mappsökväg.
- Konfliktsäker Google Drive-synk som förenar orelaterade ändringar från olika datorer och låter dig välja version vid verkliga fältkonflikter.
- Byt namn på kurser, moduler, ämnen och föreläsningar direkt från biblioteksträdets meny.
- API-modellförslag och stöd för egna OpenAI-kompatibla endpoints.
- Google Drive-inkorg för mobilinspelningar: lägg ljudfiler i `Lectio/Inbox`, välj en eller flera i Lectio och importera dem till en befintlig eller ny föreläsning. Filer som importerats flyttas till `Inbox/Importerade` så att de inte dubblas.
- Förbättrade Windows-fönsterkontroller och korrekt inbäddade Tauri-behörigheter i nya desktopbyggen.
- Stabil transkriptsökning: träffar markeras och ligger kvar medan ett segment redigeras.
- Kortare, konsekvent Anki-prompt med valda korttyper och utan prefixet `Terminologi:` på nya kort.
- Anki-generering beskriver källtäckning så att kompletta slides, anteckningar och context används även om transkriptet bara täcker delar av föreläsningen.
- Uppskattad API-kostnad och ljudlängd före OpenAI- eller Groq-transkribering; lokal Whisper visar att ingen API-kostnad uppstår.
- Säker återställningsmerge för igenkända Google Drive-bibliotek när en dator saknar lokal synkhistorik.

API-nycklar sparas inte. De används bara i minnet för det aktuella anropet.

Whisper-modeller ingår inte i installationen. De laddas ned på begäran under **Inställningar → AI och transkribering** och sparas lokalt på datorn. Tiny är snabbast, Base rekommenderas för de flesta datorer och Small ger högre kvalitet med större prestandakrav.

## Köra i utvecklingsläge

Krav: Node.js/pnpm, Rust och Microsoft C++ Build Tools.

På den Windows-dator där projektet skapades kan den medföljande startfilen
använda Codex utvecklingsverktyg utan en global pnpm-installation:

```powershell
.\start-dev.cmd
```

Kontrollera miljön utan att starta appen med `.\start-dev.cmd --check`.

Med en vanlig global utvecklingsmiljö kan appen även startas direkt:

```powershell
pnpm install
pnpm desktop:dev
```

`pnpm desktop:dev` återanvänder automatiskt en redan körande Lectio-Vite-server
på port 1420. Det går därför bra att först köra `pnpm dev` i en separat terminal
och sedan starta Tauri utan att få ett portfel.

En snabb webbversion kan köras med `pnpm dev`. Den använder samma gränssnitt och lokala browserlagring, men Tauri-versionen behövs för extern nätverksåtkomst utan CORS-problem.

## Bygga Windows-installation

```powershell
pnpm check
pnpm desktop:build
```

Installationsfiler skapas under `src-tauri/target/release/bundle`.

## Anki

Installera AnkiConnect i Anki och låt Anki vara öppet. Standardadressen är `http://127.0.0.1:8765`. Använd **Inställningar → Anki → Testa anslutningen** innan synk.

## Lagring

Metadata lagras lokalt i appens WebView-lagring. Ljud, slides och beständiga inspelningssegment lagras som blobbar i IndexedDB. En Lectio-export är en vanlig ZIP-fil med JSON-data och originalfiler i en öppen mappstruktur.

# Lectio — projekthandoff

> Ögonblicksbild: **2026-09-28**. Använd detta som orientering, inte som permanent
> sanning. Om filen är mer än några veckor gammal ska all status verifieras mot
> Git, GitHub-issues och aktuell kod.

## Vad Lectio är

Lectio är en svensk, local-first Windows-app som samlar föreläsningsmaterial i
ett sammanhängande studieflöde: kurser och moduler, slides, ljudinspelning och
import, transkribering, anteckningar, context, granskade Anki-kort och valfri
Google Drive-synk.

Stabila produktprinciper finns i [`docs/agent-context.md`](docs/agent-context.md).
Kortfattat: Windows först, användaren äger sin lokala data, AI är valfri och
provider-oberoende, originalljud sparas oberoende av transkribering och Anki-kort
granskas före normal synk.

## Nuläge

- Kodbasen är React + TypeScript/Vite i Tauri 2; Rust hanterar native-funktioner.
- `legacy` är fortfarande release-default och fungerar som fallback.
- `next` är en separat Arc-inspirerad frontend som byggs mot den gemensamma
  `LectioClient`-gränsen. Den använder normalt en isolerad `next`-dataprofil.
- Next har appskal/sidebar, inställningar och en föreläsningsyta under utveckling.
  Utgå inte från full feature parity ännu.
- Paketversionen är nu `0.4.13`. Next-UI:n är fortsatt under aktiv utveckling,
  och den fulla 30-minuters lokala stability-QA:n passerade på Windows.
  GitHub-issue #142 är fortfarande öppen; kör därför slutlig V1-validering igen
  när den UI-reworken är färdig.

Visuell riktning finns i
[`src/frontends/next/DESIGN.md`](src/frontends/next/DESIGN.md). Arkitektur och
frontendgränser finns i
[`docs/frontend-architecture.md`](docs/frontend-architecture.md).

## Källor i prioritetsordning

1. Aktuell kod, tester och `git status`.
2. Öppna GitHub-issues och labels: `gh issue list --state open`.
3. [`docs/agent-context.md`](docs/agent-context.md), som pekar varje subsystem
   till minsta relevanta dokument och entrypoints.
4. Fokuserade dokument i `docs/`.
5. Den här handoffen, endast som daterad överblick.

Anta inte att en öppen issue är ogjord eller att befintlig kod betyder att den är
färdig. Reproducera eller inspektera först och uppdatera därefter issuen.

Vid denna ögonblicksbild är huvudriktningen inför V1 att färdigställa Next-UI:n
och därefter köra den breda stabilitets- och releasevalideringen. Aktuella högt
prioriterade områden inkluderar UI-rework, lång startup, drag/drop i biblioteket
och stabilitetsvalidering. GitHub-labels avgör vad som faktiskt är nästa uppgift.

## Initial setup

Krav på Windows:

- Node.js och pnpm
- Rust (craten anger för närvarande Rust `1.77.2` eller nyare)
- Microsoft C++ Build Tools
- WebView2, normalt redan installerat på stödda Windows-versioner
- GitHub CLI (`gh`) endast för hantering av issues och releases från terminalen

Från projektroten:

```powershell
pnpm install
./start-dev.cmd --check
```

Vanliga kommandon:

```powershell
pnpm desktop:dev:legacy   # nuvarande release-UI och main-profil
pnpm desktop:dev:next     # nya UI:n och isolerad next-profil
pnpm dev:next             # snabb browserbaserad Next-iteration
pnpm check                # lint, boundaries, enhetstester och bygge
pnpm qa:frontends         # frontendseparation och Next-E2E
pnpm qa:stability         # bredare och långsammare stabilitetspass
pnpm desktop:release      # release gate och Windows-bygge
```

Koppla inte en experimentell frontend till riktig användardata bara för enklare
testning. Behåll isolerad profil tills kompatibilitet, backup och QA är verifierade.

## Arkitekturkarta

```text
src/domain/          ramverksoberoende regler
src/application/     LectioClient-kontrakt, DTO:er och test-fake
src/infrastructure/  persistens, jobs, Tauri och serviceadapter
src/frontends/       compile-time-valda legacy/next-frontends
src/services/        transkribering, AI, Anki, synk, assets och diagnostik
src/core/            delade typer och legacy-kompatibel state/persistens
src-tauri/           Rust-kommandon, rättigheter, resurser och paketering
```

Ny Next-UI ska använda `LectioClient`, inte importera Zustand, Dexie, services
eller Tauri direkt. Om kontraktet saknar en operation ska kontraktet samt dess
produktions- och minnesimplementation utökas.

## Agent- och contextflöde

1. Läs `AGENTS.md`.
2. Börja icke-triviala kodfrågor med en avgränsad grafquery:

   ```powershell
   graphify query "precise question" --budget 1200
   ```

3. Läs endast relevant dokument från `docs/agent-context.md` och de källfiler
   som grafen pekar ut.
4. Kör smalast meningsfulla test under iteration. Spara full QA och desktopbyggen
   till sammanhängande eller releasekritiska ändringar.
5. Kör `pnpm graph:refresh` en gång efter en sammanhängande kodändring.

Den repo-lokala Graphify-skillen finns i `.codex/skills/graphify/` och behöver
ingen extern AI-tjänst för vanlig indexering. Ingen annan skill eller plugin krävs
för att köra Lectio. Om en designskill som Impeccable finns kan den hjälpa vid
UI-granskning, men `DESIGN.md`, tillgänglighet och faktisk browser-/desktopkontroll
har företräde.

## Data- och säkerhetsregler

- Committa aldrig API-nycklar, OAuth-hemligheter, credentials, lokala bibliotek
  eller exporterad studentdata.
- Credentials hör hemma i operativsystemets credential store.
- Bevara originalljud och användarfiler vid migreringar och synkändringar.
- Behandla synk, import/export och profilbyten som datarisk: verifiera backup och
  testa först mot kopierad eller syntetisk data.
- Webbbygget är bra för UI-arbete men ersätter inte Tauri-rättigheter, filsystem,
  credentials eller native nätverksbeteende.

## Innan arbetet fortsätter

Kör dessa read-only-kontroller och sammanfatta vad som ändrats sedan datumet ovan:

```powershell
git status --short
git log -5 --oneline
gh issue list --state open --limit 30
```

Välj sedan en avgränsad issue, läs dess subsystemdokument och verifiera befintligt
beteende före redigering. Bevara orelaterade ändringar i den dirty arbetskopian.

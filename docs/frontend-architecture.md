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

## Importregler

- Frontends får importera application-/domain-typer, sitt eget UI och delade kontrakthooks.
- Frontends får inte importera Zustand-store, Dexie, `services/`, `infrastructure/`, `src-tauri` eller `@tauri-apps`.
- Application får inte importera React, Zustand, Radix, CSS eller Tauri.
- Infrastructure får inte importera en frontend.
- Legacy-entrypointen är en tidsbegränsad kompatibilitetsbrygga till befintliga `App.tsx`; ny funktionalitet ska inte öka dess koppling.

Reglerna körs av `pnpm check:boundaries`.

## Vägen till Next som standard

Next-slicen kan nu läsa biblioteksträdet, välja scope, skapa/namnge hierarki och visa föreläsningens slides, ljud, transkript, markeringar och kort genom kontraktet. Den fullständiga redesignen fortsätter bakom den isolerade profilen. Standard byts först när feature-parity-matrisen och hela `qa:stability` är gröna mot en kopia av ett realistiskt bibliotek. Ett frontendbyte får aldrig i sig trigga datamigrering.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Studenter som vill fokusera på föreläsningen i stället för att skriva omfattande anteckningar i realtid.

## Product Purpose

Lectio fångar en föreläsning lokalt, organiserar ljud, slides, transkript och anteckningar per kurs, och hjälper studenten att skapa granskningsbara Anki-kort efteråt.

## Positioning

En local-first desktoparbetsyta som kopplar samman inspelning, transkribering, föreläsningsmaterial och Anki utan krav på ett centralt konto eller en egen backend.

## Operating Context

Används före, under och efter universitetsföreläsningar. Windows är första målplattformen; appen körs i en Tauri-wrapper och kan senare portas. Användaren kan importera mobilinspelningar, spela in från datorn, transkribera lokalt eller via eget API, och synka godkända kort via AnkiConnect.

## Capabilities and Constraints

- Material, metadata och stora mediefiler lagras lokalt först.
- AI är valfri och provider-agnostisk; copy/paste är standardflödet, API och lokal AI är alternativ.
- Svenska är standard för gränssnitt och arbetsflöden.
- Tillgänglighet, tydlig fokusmarkering och läsbarhet i både ljusa och mörka paletter ska bevaras.
- Inga nya färgtoken eller ändringar av ThemePalette ingår i den aktuella visuella konsekvenspassningen.

## Brand Commitments

Produktnamnet är Lectio. Gränssnittet ska vara lugnt, funktionellt, svenskspråkigt och konsekvent med shadcn/Radix-baserade komponenter och användarvalda färgpaletter.

## Evidence on Hand

Produktfunktionalitet och svenskspråkig copy finns i `src/`. Inga externa kundcase eller marknadsföringspåståenden ska skapas.

## Product Principles

- Minimal interaktion under föreläsningen.
- Användaren äger och kan exportera sin data.
- Förklara när data lämnar datorn.
- Genererade Anki-kort granskas innan synkning.


# Felrapporter i Lectio

Lectio har ett frivilligt feedbackflöde som aldrig inkluderar föreläsningsmaterial.

## Aktivera direkt rapportering

1. Skapa ett gratis projekt för **React** i Sentry.
2. Kopiera projektets DSN till `VITE_SENTRY_DSN` i en lokal `.env`-fil eller i byggmiljön.
3. Bygg appen. Knappen **Rapportera problem** skickar då användarens text och valfri, anonymiserad diagnostik direkt till Sentry.

Utan DSN fungerar samma flöde lokalt: användaren kan granska och spara en JSON-rapport. Det är avsiktligt, så att ingen data lämnar datorn förrän Sentry-konfigurationen finns på plats.

## Data som kan ingå

- appversion och operativsystem/arkitektur
- antal CPU-trådar och status för NVIDIA, Whisper och FFmpeg
- högst 30 senaste, rensade tekniska fel
- högst 200 maskade loggrader vardera för app, transkribering, bildanalys, synk och native-flöden
- användarens frivilliga beskrivning

## Data som aldrig ska skickas

- ljud, PDF:er, slides, anteckningar, transkript eller Anki-kort
- API-nycklar, tokens, e-postadresser eller riktiga användarsökvägar

## Lokala felsökningsloggar

Lectio behåller en liten ringbuffert i lokal appstorage per subsystem: `app`,
`transcription`, `vision`, `sync` och `native`. Äldre rader ersätts automatiskt
och loggningen får aldrig avbryta ett studieflöde. Loggarna är endast tekniska
statusar och fel; föreläsningsinnehåll, filnamn och sökvägar maskas innan de kan
exporteras eller bifogas en rapport.

Sentry ska konfigureras med en rimlig retention och ett volymlarm inför ett bredare betatest.

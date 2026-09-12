# Wispr Flow som transkriptionsprovider

Senast utvärderad: 2026-09-11.

## Beslut

Integrera **inte** Wispr Flow i Lectio nu. Behåll lokal Whisper som
standard och OpenAI/Groq som valfria API-alternativ. Wispr Flow kan
återvärderas när dess API är allmänt tillgängligt med transparenta priser
och självbetjänad åtkomst för enskilda användare.

## Vad API:t erbjuder

Wispr har både WebSocket- och REST-API för tal-till-text. Det är byggt för
snabb diktering: resultatet kan auto-redigeras, ta bort utfyllnadsord och
anpassas till texten runt markören. REST-API:t är uttryckligen långsammare
än WebSocket och begränsar en ljudbegäran till högst 25 MB och sex minuter.
Ljud ska vara 16 kHz PCM WAV och base64-kodas.

Det matchar därför inte en hel föreläsning särskilt väl utan ljudkonvertering
och chunkning. Dess auto-redigering är dessutom mindre lämplig för Lectios
krav på ett källtrogen, tidsstämplat föreläsningstranskript.

## Åtkomst, kostnad och integritet

- API-nycklar skapas i Wisprs Developer Platform, men API:t är enligt
  quickstarten endast tillgängligt för godkända organisationer/exklusiv
  åtkomst.
- API-användning faktureras per usage-token. Det finns ingen självpålagd
  API-gräns i deras dashboard, vilket gör kostnadsskydd svårare att ge en
  student.
- Wispr rekommenderar client tokens för direktanslutning eller att en vanlig
  API-nyckel hålls på en egen backend. Lectio har medvetet ingen central
  backend, så en direkt BYO-key-lösning vore möjlig först efter uttrycklig
  användaraccept och skulle fortfarande vara en avancerad integration.
- Flow-klientens gratisplan är inte samma sak som gratis API-användning.
  Den ska inte marknadsföras som en fri transkriptionsprovider i Lectio.

## Om förutsättningarna ändras

En framtida integration ska vara helt valfri och byggas bakom Lectios
`TranscriptionProvider`-gränssnitt. Den behöver minst:

1. en tydlig markering om exklusiv åtkomst och extern databehandling,
2. lokal lagring av användarens egen nyckel i Windows Credential Manager,
3. WAV-konvertering, sekventiell chunkning och normalisering till Lectios
   timestampade segment,
4. kostnadsestimat och en hård användarvald sessionsgräns före varje körning,
5. ett läge utan auto-redigering när ordagrannhet är viktig.

## Källor

- [Wispr Flow API Quickstart](https://api-docs.wisprflow.ai/quickstart)
- [Wispr Flow REST API](https://api-docs.wisprflow.ai/rest_api)
- [Wispr Flow Usage & Billing](https://api-docs.wisprflow.ai/usage_billing)
- [Wispr Flow Voice Interface API](https://api-docs.wisprflow.ai/introduction)
- [Wispr Flow Pricing](https://wisprflow.ai/pricing)

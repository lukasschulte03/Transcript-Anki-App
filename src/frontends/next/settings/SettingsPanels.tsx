/* oxlint-disable react/set-state-in-effect -- panels synchronize native device, credential and engine status. */
import {
  AudioLines,
  Check,
  Cloud,
  Cpu,
  Gauge,
  HardDrive,
  KeyRound,
  Languages,
  LoaderCircle,
  Mic,
  Moon,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  SwatchBook,
  Sun,
  Trash2,
  Unplug,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  AppSettings,
  LectioClient,
  LocalTranscriptionSetup,
} from "../../../application/lectioClient";
import {
  NextButton,
  NextSection,
  NextSettingRow,
  NextSurface,
} from "../ui/NextPrimitives";
import { nextThemePresets } from "../themes";

export type SettingsCategoryId =
  "appearance" | "audio" | "transcription" | "ai-anki" | "sync";

type Notice = (text: string, error?: boolean) => void;

const aiDefaults = {
  openai: { model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
  anthropic: {
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com/v1",
  },
  gemini: {
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  groq: {
    model: "openai/gpt-oss-120b",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  custom: { model: "", baseUrl: "" },
} satisfies Record<
  AppSettings["aiProvider"],
  { model: string; baseUrl: string }
>;

const aiModels: Record<AppSettings["aiProvider"], string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  custom: [],
};

function SelectControl({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      className="study-control study-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function TextControl({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  type?: "text" | "password" | "url";
}) {
  return (
    <input
      className="study-control study-input"
      aria-label={label}
      value={value}
      type={type}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="study-toggle"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function PanelIntro({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <NextSurface className="study-settings-intro" tone="subtle">
      <div className="study-settings-emblem" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </NextSurface>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div className="study-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CredentialControl({
  client,
  credentialKey,
  label,
  onNotice,
}: {
  client: LectioClient;
  credentialKey: string;
  label: string;
  onNotice: Notice;
}) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    void client.credentials.read(credentialKey).then((result) => {
      if (!active) return;
      setSaved(result.ok && result.value);
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [client, credentialKey]);
  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    const result = await client.credentials.write(credentialKey, value.trim());
    setBusy(false);
    if (!result.ok) return onNotice(result.error.message, true);
    setSaved(true);
    setValue("");
    onNotice(`${label} sparades säkert.`);
  };
  const remove = async () => {
    setBusy(true);
    const result = await client.credentials.remove(credentialKey);
    setBusy(false);
    if (!result.ok) return onNotice(result.error.message, true);
    setSaved(false);
    setValue("");
    onNotice(`${label} togs bort.`);
  };
  return (
    <div className="study-credential">
      <TextControl
        label={label}
        value={value}
        type="password"
        placeholder={
          saved ? "Sparad i Windows · ersätt nyckel" : "Klistra in nyckel"
        }
        onChange={setValue}
      />
      {saved && (
        <span className="study-status-dot" title="Nyckel sparad">
          <Check />
        </span>
      )}
      <NextButton disabled={busy || !value.trim()} onClick={() => void save()}>
        {busy ? <LoaderCircle className="study-spin" /> : <Save />}
        Spara
      </NextButton>
      {saved && (
        <NextButton
          tone="quiet"
          aria-label={`Ta bort ${label}`}
          disabled={busy}
          onClick={() => void remove()}
        >
          <Trash2 />
        </NextButton>
      )}
    </div>
  );
}

function AppearancePanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <PanelIntro
        icon={<SwatchBook />}
        title="Utseende"
        description="Ett lugnt gränssnitt som håller fokus på materialet."
      />
      <NextSection className="study-settings-group" title="Gränssnitt">
        <NextSettingRow
          icon={<Languages />}
          title="Språk"
          description="Svenska är komplett. Engelska sparas som förhandsval medan översättningen färdigställs."
        >
          <SelectControl
            label="Språk i appen"
            value={settings.locale}
            onChange={(locale) =>
              update({ locale: locale as AppSettings["locale"] })
            }
          >
            <option value="sv">Svenska</option>
            <option value="en">English · preview</option>
          </SelectControl>
        </NextSettingRow>
        <NextSettingRow
          icon={<SwatchBook />}
          title="Färgtema"
          description="Välj mellan blå eller orange ton, anpassad för ljus eller mörk omgivning."
          stacked
        >
          <div
            className="study-theme-grid"
            role="radiogroup"
            aria-label="Färgtema"
          >
            {nextThemePresets.map(({ palette, tone, chrome }) => {
              const selected = settings.selectedPaletteId === palette.id;
              return (
                <button
                  key={palette.id}
                  className="study-theme-option"
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update({ selectedPaletteId: palette.id })}
                >
                  <span
                    className="study-theme-preview"
                    style={{
                      background: `linear-gradient(145deg, ${chrome[0]}, ${chrome[1]} 52%, ${chrome[2]})`,
                    }}
                    aria-hidden="true"
                  >
                    <span style={{ background: palette.surface }} />
                  </span>
                  <span className="study-theme-option-copy">
                    <strong>{palette.name}</strong>
                    <small>{tone === "dark" ? "Mörkt" : "Ljust"}</small>
                  </span>
                  <span className="study-theme-tone" aria-hidden="true">
                    {tone === "dark" ? <Moon /> : <Sun />}
                  </span>
                </button>
              );
            })}
          </div>
        </NextSettingRow>
      </NextSection>
    </>
  );
}

function AudioPanel({
  settings,
  update,
  onNotice,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onNotice: Notice;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async (requestPermission = false) => {
    setLoading(true);
    try {
      let stream: MediaStream | undefined;
      if (requestPermission)
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const all = await navigator.mediaDevices.enumerateDevices();
      stream?.getTracks().forEach((track) => track.stop());
      setDevices(all.filter((device) => device.kind === "audioinput"));
    } catch {
      onNotice(
        "Mikrofonerna kunde inte läsas. Kontrollera Windows behörigheter.",
        true,
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh(false);
    // Device enumeration is intentionally performed once when this panel opens.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <PanelIntro
        icon={<AudioLines />}
        title="Ljud och inspelning"
        description="Välj en stabil standard en gång; varje ny föreläsning använder den automatiskt."
      />
      <NextSection className="study-settings-group" title="Inspelning">
        <NextSettingRow
          icon={<Mic />}
          title="Mikrofon"
          description="Standard följer Windows. Ge behörighet för att visa enheternas riktiga namn."
        >
          <div className="study-inline-control">
            <SelectControl
              label="Mikrofon"
              value={settings.recordingDeviceId}
              onChange={(recordingDeviceId) => update({ recordingDeviceId })}
            >
              <option value="">Windows standard</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Mikrofon ${index + 1}`}
                </option>
              ))}
            </SelectControl>
            <NextButton
              tone="quiet"
              disabled={loading}
              onClick={() => void refresh(true)}
            >
              {loading ? (
                <LoaderCircle className="study-spin" />
              ) : (
                <RefreshCw />
              )}
              Uppdatera
            </NextButton>
          </div>
        </NextSettingRow>
        <NextSettingRow
          icon={<Gauge />}
          title="Ljudkvalitet"
          description="Balanserad rekommenderas för tydligt tal utan onödigt stora filer."
        >
          <Segmented
            label="Ljudkvalitet"
            value={settings.recordingQuality}
            onChange={(recordingQuality) => update({ recordingQuality })}
            options={[
              { value: "compact", label: "Kompakt" },
              { value: "balanced", label: "Balanserad" },
              { value: "high", label: "Hög" },
            ]}
          />
        </NextSettingRow>
      </NextSection>
    </>
  );
}

function TranscriptionPanel({
  client,
  settings,
  update,
  onNotice,
}: PanelProps) {
  const [setup, setSetup] = useState<LocalTranscriptionSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const model = settings.localTranscriptionModel;
  const refresh = useCallback(async () => {
    const result = await client.localTranscription.status(model);
    if (result.ok) setSetup(result.value);
  }, [client, model]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const runLocal = async (action: "download" | "remove" | "nvidia") => {
    setBusy(true);
    if (action === "remove") {
      const result = await client.localTranscription.remove(model);
      setBusy(false);
      if (!result.ok) return onNotice(result.error.message, true);
      await refresh();
      onNotice("Whisper-modellen togs bort.");
      return;
    }
    const result =
      action === "download"
        ? await client.localTranscription.download(model)
        : await client.localTranscription.installNvidia();
    setBusy(false);
    if (!result.ok) return onNotice(result.error.message, true);
    setSetup(result.value);
    onNotice(
      action === "nvidia"
        ? "NVIDIA-stödet är klart."
        : "Whisper-modellen är klar.",
    );
  };
  const cloud =
    settings.transcriptionProvider === "openai" ||
    settings.transcriptionProvider === "groq";
  const transcriptionKey = `transcription:${settings.transcriptionProvider === "groq" ? "groq" : "openai"}`;
  return (
    <>
      <PanelIntro
        icon={<WandSparkles />}
        title="Transkribering"
        description="Lokalt är privat och gratis. Moln-API är valfritt och använder din egen nyckel."
      />
      <NextSection className="study-settings-group" title="Metod">
        <NextSettingRow
          icon={<AudioLines />}
          title="Transkriptionsmotor"
          description="Valet används av både enskilda föreläsningar och Super Actions."
        >
          <Segmented
            label="Transkriptionsmotor"
            value={
              cloud
                ? "api"
                : settings.transcriptionProvider === "manual"
                  ? "manual"
                  : "local"
            }
            onChange={(value) =>
              update({
                transcriptionProvider: value === "api" ? "openai" : value,
              })
            }
            options={[
              { value: "local", label: "Lokalt" },
              { value: "api", label: "API" },
              { value: "manual", label: "Manuellt" },
            ]}
          />
        </NextSettingRow>
      </NextSection>
      {settings.transcriptionProvider === "local" && (
        <NextSection className="study-settings-group" title="Lokal Whisper">
          <NextSettingRow
            icon={<HardDrive />}
            title="Whisper-modell"
            description={
              setup?.installed
                ? "Installerad och redo på den här datorn."
                : "Laddas ned en gång och ligger kvar lokalt."
            }
          >
            <div className="study-inline-control">
              <SelectControl
                label="Whisper-modell"
                value={model}
                onChange={(localTranscriptionModel) =>
                  update({
                    localTranscriptionModel:
                      localTranscriptionModel as AppSettings["localTranscriptionModel"],
                  })
                }
              >
                <option value="tiny">Tiny · snabbast</option>
                <option value="base">Base</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large-v3-turbo">
                  Large v3 Turbo · rekommenderad
                </option>
                <option value="large-v3">Large v3 · noggrannast</option>
              </SelectControl>
              <NextButton
                disabled={busy}
                tone={setup?.installed ? "quiet" : "primary"}
                onClick={() =>
                  void runLocal(setup?.installed ? "remove" : "download")
                }
              >
                {busy ? (
                  <LoaderCircle className="study-spin" />
                ) : setup?.installed ? (
                  <Trash2 />
                ) : (
                  <HardDrive />
                )}
                {setup?.installed ? "Ta bort" : "Ladda ned"}
              </NextButton>
            </div>
          </NextSettingRow>
          <NextSettingRow
            icon={<Cpu />}
            title="Acceleration"
            description={
              setup?.nvidiaDetected
                ? `${setup.nvidiaName || "NVIDIA GPU"} hittades.`
                : "Automatiskt använder GPU när den är redo och faller annars tillbaka på CPU."
            }
          >
            <Segmented
              label="Acceleration"
              value={settings.localTranscriptionAcceleration}
              onChange={(localTranscriptionAcceleration) =>
                update({ localTranscriptionAcceleration })
              }
              options={[
                { value: "auto", label: "Auto" },
                { value: "nvidia", label: "NVIDIA" },
                { value: "cpu", label: "CPU" },
              ]}
            />
          </NextSettingRow>
          {setup?.nvidiaDetected && !setup.nvidiaRuntimeReady && (
            <NextSettingRow
              icon={<Zap />}
              title="NVIDIA-runtime"
              description="Krävs för att Whisper faktiskt ska kunna använda grafikkortet."
            >
              <NextButton
                disabled={busy}
                onClick={() => void runLocal("nvidia")}
              >
                <Zap />
                Installera
              </NextButton>
            </NextSettingRow>
          )}
        </NextSection>
      )}
      {cloud && (
        <NextSection className="study-settings-group" title="Moln-API">
          <NextSettingRow
            icon={<Cloud />}
            title="Leverantör"
            description="Ljud skickas bara till den leverantör du väljer."
          >
            <SelectControl
              label="Transkriptionsleverantör"
              value={settings.transcriptionProvider}
              onChange={(provider) =>
                update({
                  transcriptionProvider: provider as "openai" | "groq",
                  transcriptionModel:
                    provider === "groq"
                      ? "whisper-large-v3-turbo"
                      : "whisper-1",
                  transcriptionBaseUrl:
                    provider === "groq"
                      ? "https://api.groq.com/openai/v1"
                      : "https://api.openai.com/v1",
                })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
            </SelectControl>
          </NextSettingRow>
          <NextSettingRow
            icon={<Sparkles />}
            title="Modell"
            description="Det rekommenderade standardnamnet fungerar utan extra konfiguration."
          >
            <TextControl
              label="Transkriptionsmodell"
              value={settings.transcriptionModel}
              onChange={(transcriptionModel) => update({ transcriptionModel })}
            />
          </NextSettingRow>
          <NextSettingRow
            icon={<KeyRound />}
            title="API-nyckel"
            description="Sparas i Windows Credential Manager och visas aldrig igen."
          >
            <CredentialControl
              client={client}
              credentialKey={transcriptionKey}
              label="API-nyckel för transkribering"
              onNotice={onNotice}
            />
          </NextSettingRow>
        </NextSection>
      )}
      <NextSection
        className="study-settings-group"
        title="Medicinskt fraslexikon"
      >
        <label className="study-textarea-field">
          <span>Ord och fraser som Whisper ska känna igen</span>
          <textarea
            value={settings.transcriptionPrompt}
            onChange={(event) =>
              update({ transcriptionPrompt: event.target.value })
            }
            placeholder="Exempel: ileus, ureter, pyelonefrit"
          />
          <small>
            Ett ord eller en kort fras per rad. Kursers egna fraslexikon ärvs
            automatiskt.
          </small>
        </label>
      </NextSection>
    </>
  );
}

type PanelProps = {
  client: LectioClient;
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onNotice: Notice;
};

function AiAnkiPanel({ client, settings, update, onNotice }: PanelProps) {
  const [ankiBusy, setAnkiBusy] = useState(false);
  const [decks, setDecks] = useState<string[]>([]);
  const providerModels = aiModels[settings.aiProvider];
  const aiKey = `ai:${settings.aiProvider}`;
  const test = async () => {
    setAnkiBusy(true);
    const result = await client.workflows.testAnki();
    setAnkiBusy(false);
    if (!result.ok) return onNotice(result.error.message, true);
    setDecks(result.value.decks);
    if (
      !result.value.decks.includes(settings.defaultDeck) &&
      result.value.decks[0]
    )
      update({ defaultDeck: result.value.decks[0] });
    onNotice(`AnkiConnect svarar · version ${result.value.version}.`);
  };
  return (
    <>
      <PanelIntro
        icon={<Sparkles />}
        title="AI och Anki"
        description="Välj standarder här. När du skapar kort behöver du bara starta flödet."
      />
      <NextSection className="study-settings-group" title="Kortgenerering">
        <NextSettingRow
          icon={<WandSparkles />}
          title="Arbetssätt"
          description="Copy/paste använder din befintliga AI-prenumeration. API kör direkt i Lectio."
        >
          <Segmented
            label="AI-arbetssätt"
            value={settings.aiMode}
            onChange={(aiMode) => update({ aiMode })}
            options={[
              { value: "clipboard", label: "Copy/paste" },
              { value: "api", label: "API" },
            ]}
          />
        </NextSettingRow>
        <NextSettingRow
          icon={<Gauge />}
          title="Mängd kort"
          description="AI:n anpassar det exakta antalet efter föreläsningens innehåll."
        >
          <Segmented
            label="Mängd kort"
            value={settings.cardGeneration.density}
            onChange={(density) =>
              update({
                cardGeneration: { ...settings.cardGeneration, density },
              })
            }
            options={[
              { value: "few", label: "Få" },
              { value: "balanced", label: "Lagom" },
              { value: "many", label: "Många" },
            ]}
          />
        </NextSettingRow>
        <NextSettingRow
          icon={<Languages />}
          title="Generella instruktioner"
          description="Gäller alla kurser; mer specifik kontext kan fortfarande läggas i biblioteket."
        >
          <textarea
            className="study-control study-compact-textarea"
            aria-label="Instruktioner för Anki-kort"
            value={settings.userContext}
            onChange={(event) => update({ userContext: event.target.value })}
          />
        </NextSettingRow>
      </NextSection>
      {settings.aiMode === "api" && (
        <NextSection className="study-settings-group" title="AI-API">
          <NextSettingRow
            icon={<Cloud />}
            title="Leverantör"
            description="Material skickas endast när du aktivt startar en generering."
          >
            <SelectControl
              label="AI-leverantör"
              value={settings.aiProvider}
              onChange={(value) => {
                const aiProvider = value as AppSettings["aiProvider"];
                update({
                  aiProvider,
                  aiModel: aiDefaults[aiProvider].model,
                  aiBaseUrl: aiDefaults[aiProvider].baseUrl,
                });
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="groq">Groq</option>
              <option value="custom">OpenAI-kompatibel</option>
            </SelectControl>
          </NextSettingRow>
          <NextSettingRow
            icon={<Sparkles />}
            title="Modell"
            description="Välj ett förslag eller skriv modellnamnet exakt som providern anger."
          >
            {providerModels.length ? (
              <SelectControl
                label="AI-modell"
                value={settings.aiModel}
                onChange={(aiModel) => update({ aiModel })}
              >
                {providerModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </SelectControl>
            ) : (
              <TextControl
                label="AI-modell"
                value={settings.aiModel}
                onChange={(aiModel) => update({ aiModel })}
                placeholder="modellnamn"
              />
            )}
          </NextSettingRow>
          {settings.aiProvider === "custom" && (
            <NextSettingRow
              icon={<PlugZap />}
              title="Basadress"
              description="Adressen till din OpenAI-kompatibla endpoint."
            >
              <TextControl
                label="API-basadress"
                type="url"
                value={settings.aiBaseUrl}
                onChange={(aiBaseUrl) => update({ aiBaseUrl })}
                placeholder="https://…/v1"
              />
            </NextSettingRow>
          )}
          <NextSettingRow
            icon={<KeyRound />}
            title="API-nyckel"
            description="Sparas i Windows Credential Manager, aldrig i biblioteket eller exporten."
          >
            <CredentialControl
              client={client}
              credentialKey={aiKey}
              label={`API-nyckel för ${settings.aiProvider}`}
              onNotice={onNotice}
            />
          </NextSettingRow>
        </NextSection>
      )}
      <NextSection className="study-settings-group" title="AnkiConnect">
        <NextSettingRow
          icon={<PlugZap />}
          title="Anslutning"
          description="Anki måste vara öppet och tillägget AnkiConnect installerat."
        >
          <div className="study-inline-control">
            <TextControl
              label="AnkiConnect-adress"
              type="url"
              value={settings.ankiUrl}
              onChange={(ankiUrl) => update({ ankiUrl })}
            />
            <NextButton disabled={ankiBusy} onClick={() => void test()}>
              {ankiBusy ? <LoaderCircle className="study-spin" /> : <PlugZap />}
              Testa
            </NextButton>
          </div>
        </NextSettingRow>
        <NextSettingRow
          icon={<HardDrive />}
          title="Huvudkortlek"
          description="Lectio skapar kurs, modul och föreläsning som underkortlekar."
        >
          {decks.length ? (
            <SelectControl
              label="Huvudkortlek"
              value={settings.defaultDeck}
              onChange={(defaultDeck) => update({ defaultDeck })}
            >
              {decks.map((deck) => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </SelectControl>
          ) : (
            <TextControl
              label="Huvudkortlek"
              value={settings.defaultDeck}
              onChange={(defaultDeck) => update({ defaultDeck })}
            />
          )}
        </NextSettingRow>
      </NextSection>
    </>
  );
}

function SyncPanel({ client, settings, update, onNotice }: PanelProps) {
  const [busy, setBusy] = useState(false);
  const connected = Boolean(settings.cloudSync.connectedAt);
  const run = async (action: "connect" | "disconnect" | "sync" | "cancel") => {
    setBusy(true);
    const result =
      action === "connect"
        ? await client.workflows.connectGoogleDrive()
        : action === "disconnect"
          ? await client.workflows.disconnectGoogleDrive()
          : action === "cancel"
            ? await client.workflows.cancelGoogleDriveConnection()
            : await client.workflows.syncLibrary();
    setBusy(false);
    if (!result.ok) return onNotice(result.error.message, true);
    onNotice(
      action === "connect"
        ? "Google Drive är anslutet."
        : action === "disconnect"
          ? "Google Drive kopplades bort."
          : action === "cancel"
            ? "Google-inloggningen avbröts."
            : "Biblioteket är synkat.",
    );
  };
  return (
    <>
      <PanelIntro
        icon={<Cloud />}
        title="Synk och anslutningar"
        description="Google Drive håller samma Lectio-bibliotek tillgängligt på dina datorer."
      />
      <NextSection className="study-settings-group" title="Google Drive">
        <NextSettingRow
          icon={<Cloud />}
          title="Konto"
          description={
            connected
              ? `Ansluten${settings.cloudSync.accountLabel ? ` som ${settings.cloudSync.accountLabel}` : ""}.`
              : "OAuth-token sparas säkert i Windows Credential Manager."
          }
        >
          <div className="study-inline-control">
            {connected ? (
              <>
                <span className="study-value-chip study-value-success">
                  <Check />
                  Ansluten
                </span>
                <NextButton disabled={busy} onClick={() => void run("sync")}>
                  <RefreshCw />
                  Synka nu
                </NextButton>
                <NextButton
                  tone="quiet"
                  disabled={busy}
                  onClick={() => void run("disconnect")}
                >
                  <Unplug />
                  Koppla bort
                </NextButton>
              </>
            ) : (
              <>
                <NextButton
                  tone="primary"
                  disabled={busy}
                  onClick={() => void run("connect")}
                >
                  {busy ? <LoaderCircle className="study-spin" /> : <Cloud />}
                  {busy ? "Väntar på Google…" : "Koppla Google Drive"}
                </NextButton>
                {busy && (
                  <NextButton tone="quiet" onClick={() => void run("cancel")}>
                    Avbryt
                  </NextButton>
                )}
              </>
            )}
          </div>
        </NextSettingRow>
        <NextSettingRow
          icon={<HardDrive />}
          title="Mapp i Drive"
          description="Tomt värde använder Lectio i roten. Inbox skapas automatiskt inuti mappen."
        >
          <TextControl
            label="Mapp i Google Drive"
            value={settings.cloudSync.remotePath}
            onChange={(remotePath) =>
              update({ cloudSync: { ...settings.cloudSync, remotePath } })
            }
            placeholder="Lectio"
          />
        </NextSettingRow>
        <NextSettingRow
          icon={<RefreshCw />}
          title="Synka vid start och stängning"
          description="Lectio väntar tills synken är klar innan appen stängs."
        >
          <Toggle
            label="Synka vid start och stängning"
            checked={settings.cloudSync.autoSyncOnStartAndClose}
            onChange={(autoSyncOnStartAndClose) =>
              update({
                cloudSync: { ...settings.cloudSync, autoSyncOnStartAndClose },
              })
            }
          />
        </NextSettingRow>
        {settings.cloudSync.lastSyncedAt && (
          <p className="study-settings-footnote">
            Senast synkad{" "}
            {new Intl.DateTimeFormat("sv-SE", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(settings.cloudSync.lastSyncedAt))}
          </p>
        )}
      </NextSection>
      <NextSurface className="study-privacy-note" tone="subtle">
        <ShieldCheck />
        <p>
          <strong>Local-first</strong>Biblioteket fungerar även utan molnet.
          Synk skickar bara Lectios bibliotek till ditt eget Drive-konto.
        </p>
      </NextSurface>
    </>
  );
}

export function SettingsPanel({
  category,
  ...props
}: PanelProps & { category: SettingsCategoryId }) {
  if (category === "appearance")
    return <AppearancePanel settings={props.settings} update={props.update} />;
  if (category === "audio")
    return (
      <AudioPanel
        settings={props.settings}
        update={props.update}
        onNotice={props.onNotice}
      />
    );
  if (category === "transcription") return <TranscriptionPanel {...props} />;
  if (category === "ai-anki") return <AiAnkiPanel {...props} />;
  return <SyncPanel {...props} />;
}

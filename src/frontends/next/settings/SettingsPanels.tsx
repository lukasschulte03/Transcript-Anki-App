/* oxlint-disable react/set-state-in-effect -- panels synchronize native device, credential and engine status. */
import {
  AudioLines,
  Check,
  Cloud,
  Cpu,
  Gauge,
  HardDrive,
  Image as ImageIcon,
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
import * as Dialog from "@radix-ui/react-dialog";
import { Children, isValidElement, useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  AppSettings,
  LectioClient,
  LectioResult,
  LocalVisionSetup,
  LocalTranscriptionSetup,
  ModelCatalogTask,
} from "../../../application/lectioClient";
import {
  NextButton,
  NextIconButton,
  NextSelect,
  type NextSelectOption,
  NextSection,
  NextSettingRow,
  NextSurface,
} from "../ui/NextPrimitives";
import { nextThemePresets } from "../themes";

export type SettingsCategoryId =
  | "general"
  | "appearance"
  | "audio"
  | "transcription"
  | "image-analysis"
  | "ai-anki"
  | "sync";

type Notice = (text: string, error?: boolean) => void;

const aiDefaults = {
  openai: { model: "gpt-5.4-mini", baseUrl: "https://api.openai.com/v1" },
  anthropic: {
    model: "claude-sonnet-5",
    baseUrl: "https://api.anthropic.com/v1",
  },
  gemini: {
    model: "gemini-3.8-flash",
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
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children?: ReactNode }>(child) || child.type !== "option") return [];
    return [{
      value: child.props.value ?? "",
      label: typeof child.props.children === "string" ? child.props.children : String(child.props.value ?? ""),
      disabled: child.props.disabled,
    }];
  });
  return (
    <NextSelect
      className="study-select"
      label={label}
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={options}
    />
  );
}

function ApiModelControl({
  client,
  task,
  providerKey,
  value,
  label,
  onChange,
}: {
  client: LectioClient;
  task: ModelCatalogTask;
  providerKey: string;
  value: string;
  label: string;
  onChange(value: string): void;
}) {
  const [options, setOptions] = useState<NextSelectOption[]>([]);
  const [source, setSource] = useState<"fallback" | "provider">("fallback");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await client.modelCatalog.list(task);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOptions(result.value.models.map(({ id, label: modelLabel, tier, description }) => ({
      value: id,
      label: `${modelLabel}${tier === "recommended" ? " · Rekommenderad" : tier === "budget" ? " · Prisvärd" : tier === "powerful" ? " · Hög kvalitet" : ""}`,
      description,
    })));
    setSource(result.value.source);
    setError(result.value.error);
  }, [client, task]);
  useEffect(() => { void refresh(); }, [refresh, providerKey]);
  const known = options.some((option) => option.value === value);
  const selection = known && !editingCustom ? value : "__custom_model__";
  const selectOptions = [
    ...(known && !editingCustom ? [] : [{ value: "__custom_model__", label: "Ange modell-ID…" }]),
    ...options,
  ];
  return (
    <div className="study-model-control">
      <NextSelect
        label={label}
        value={selection}
        options={selectOptions}
        onChange={(next) => {
          if (next === "__custom_model__") setEditingCustom(true);
          else { setEditingCustom(false); onChange(next); }
        }}
      />
      {(!known || editingCustom) && (
        <TextControl label={`${label} · Anpassat ID`} value={value} onChange={onChange} placeholder="modell-id" />
      )}
      <NextIconButton
        aria-label={`Uppdatera ${label.toLocaleLowerCase("sv-SE")}`}
        title="Hämta modellista från vald leverantör"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <RefreshCw className={loading ? "study-spin" : undefined} />
      </NextIconButton>
      <span className="study-model-source" role="status">
        {error ? "Reservlista" : source === "provider" ? "Ditt konto" : "Förslag"}
      </span>
    </div>
  );
}

function TextControl({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  suggestions,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  type?: "text" | "password" | "url";
  suggestions?: string[];
}) {
  const listId = suggestions?.length
    ? `suggest-${label.toLocaleLowerCase("sv-SE").replace(/[^a-z0-9]+/g, "-")}`
    : undefined;
  return (
    <>
      <input
        className="study-control study-input"
        aria-label={label}
        name={label.toLocaleLowerCase("sv-SE").replace(/[^a-z0-9]+/g, "-")}
        autoComplete="off"
        value={value}
        type={type}
        placeholder={placeholder}
        list={listId}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions?.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </>
  );
}

function ConfirmAction({
  title,
  description,
  confirmLabel,
  triggerLabel,
  busy,
  icon,
  showLabel = true,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  triggerLabel: string;
  busy?: boolean;
  icon: ReactNode;
  showLabel?: boolean;
  onConfirm(): void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <NextButton tone="quiet" aria-label={triggerLabel} disabled={busy}>
          {icon}
          {showLabel && (
            <span className="study-confirm-trigger-label">{triggerLabel}</span>
          )}
        </NextButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="study-settings-overlay" />
        <Dialog.Content className="study-settings-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <footer>
            <Dialog.Close asChild>
              <NextButton>Avbryt</NextButton>
            </Dialog.Close>
            <NextButton
              tone="primary"
              onClick={() => {
                setOpen(false);
                void onConfirm();
              }}
            >
              {confirmLabel}
            </NextButton>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
        <span
          className="study-status-dot"
          title="Nyckel sparad"
          role="status"
          aria-label="Nyckel sparad säkert"
        >
          <Check />
        </span>
      )}
      <NextButton disabled={busy || !value.trim()} onClick={() => void save()}>
        {busy ? <LoaderCircle className="study-spin" /> : <Save />}
        Spara
      </NextButton>
      {saved && (
        <ConfirmAction
          title="Ta bort den sparade nyckeln?"
          description={`${label} tas bort från Windows Credential Manager. Du måste ange den igen för att använda tjänsten.`}
          confirmLabel="Ta bort nyckeln"
          triggerLabel={`Ta bort ${label}`}
          busy={busy}
          icon={<Trash2 />}
          showLabel={false}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function GeneralPanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <PanelIntro
        icon={<Languages />}
        title="Allmänt"
        description="Språk och grundläggande val för appen."
      />
      <NextSection className="study-settings-group" title="Språk">
        <NextSettingRow
          id="language"
          icon={<Languages />}
          title="Språk"
          description="Svenska är appens aktiva språk. Engelsk översättning är inte färdig ännu."
        >
          <SelectControl
            label="Språk i appen"
            value={settings.locale}
            onChange={(locale) =>
              update({ locale: locale as AppSettings["locale"] })
            }
          >
            <option value="sv">Svenska</option>
            <option value="en" disabled>
              English · kommer senare
            </option>
          </SelectControl>
        </NextSettingRow>
      </NextSection>
    </>
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
        description="Välj appens färger för både ljust och mörkt läge."
      />
      <NextSection className="study-settings-group" title="Färgtema">
        <NextSettingRow
          id="color-theme"
          icon={<SwatchBook />}
          title="Färgtema"
          description="Välj en blå eller orange palett, anpassad för ljus eller mörk omgivning."
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
          id="microphone"
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
          id="recording-quality"
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
    try {
      const result =
        action === "remove"
          ? await client.localTranscription.remove(model)
          : action === "download"
            ? await client.localTranscription.download(model)
            : await client.localTranscription.installNvidia();
      if (!result.ok) return onNotice(result.error.message, true);
      if (action === "remove") {
        await refresh();
        onNotice("Whisper-modellen togs bort.");
      } else {
        if (result.value) setSetup(result.value);
        onNotice(
          action === "nvidia"
            ? "NVIDIA-stödet är klart."
            : "Whisper-modellen är klar.",
        );
      }
    } catch {
      onNotice("Åtgärden kunde inte slutföras. Försök igen.", true);
    } finally {
      setBusy(false);
    }
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
          id="transcription-method"
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
              ...(value === "api" && settings.transcriptionProvider === "local"
                ? { transcriptionModel: "gpt-transcribe" }
                : {}),
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
            id="whisper-model"
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
              {setup?.installed ? (
                <ConfirmAction
                  title="Ta bort Whisper-modellen?"
                  description={`${model} tas bort från den här datorn. Modellen kan laddas ned igen senare.`}
                  confirmLabel="Ta bort modellen"
                  triggerLabel="Ta bort"
                  busy={busy}
                  icon={<Trash2 />}
                  onConfirm={() => runLocal("remove")}
                />
              ) : (
                <NextButton
                  disabled={busy}
                  tone="primary"
                  onClick={() => void runLocal("download")}
                >
                  {busy ? (
                    <LoaderCircle className="study-spin" />
                  ) : (
                    <HardDrive />
                  )}
                  Ladda ned
                </NextButton>
              )}
            </div>
          </NextSettingRow>
          <NextSettingRow
            id="transcription-acceleration"
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
              id="nvidia-runtime"
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
            id="transcription-provider"
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
                      : "gpt-transcribe",
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
            id="transcription-model"
            icon={<Sparkles />}
            title="Modell"
            description="Hämta aktuella modeller från leverantören. Nyare GPT-transkribering ger text utan tidsstämplar; Whisper ger segment med tider."
          >
            <ApiModelControl
              client={client}
              task="transcription"
              providerKey={settings.transcriptionProvider}
              label="Transkriptionsmodell"
              value={settings.transcriptionModel}
              onChange={(transcriptionModel) => update({ transcriptionModel })}
            />
          </NextSettingRow>
          <NextSettingRow
            id="transcription-api-key"
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
        <label id="phrase-lexicon" className="study-textarea-field">
          <span>Ord och fraser som Whisper ska känna igen</span>
          <textarea
            name="transcription-phrase-lexicon"
            autoComplete="off"
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

function ImageAnalysisPanel({
  client,
  settings,
  update,
  onNotice,
}: PanelProps) {
  const [localVision, setLocalVision] = useState<LocalVisionSetup>();
  const [visionBusy, setVisionBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void client.visuals.localStatus().then((result) => {
      if (current && result.ok) setLocalVision(result.value);
    });
    return () => {
      current = false;
    };
  }, [client]);

  const repairLocalVision = async () => {
    setVisionBusy(true);
    const result = await client.visuals.installLocalVision();
    setVisionBusy(false);
    if (result.ok) {
      setLocalVision(result.value);
      onNotice("Den lokala Nvidia-bildmotorn är redo.");
    } else {
      onNotice(result.error.message, true);
    }
  };

  return (
    <>
      <PanelIntro
        icon={<ImageIcon />}
        title="OCR och bildanalys"
        description="Slidebilder hittas och beskärs lokalt. PaddleOCR läser text på datorn; OpenAI kan komplettera med mer bildtext och en kort beskrivning."
      />
      <NextSection className="study-settings-group" title="Metod">
        <NextSettingRow
          id="visual-method"
          icon={
            settings.visualAnalysisProvider === "api" ? (
              <Cloud />
            ) : (
              <HardDrive />
            )
          }
          title="Kompletterande analys"
          description={
            settings.visualAnalysisProvider === "api"
              ? "Lokal OCR fortsätter. OpenAI får bara beskurna bilder när du väljer Analysera med API; användning kan kosta."
              : "PaddleOCR läser text lokalt under bildextraheringen. Inget lämnar datorn."
          }
        >
          <Segmented
            label="Metod för OCR och bildanalys"
            value={settings.visualAnalysisProvider}
            onChange={(visualAnalysisProvider) =>
              update({
                visualAnalysisProvider: visualAnalysisProvider as
                  "local" | "api",
              })
            }
            options={[
              { value: "local", label: "Lokalt" },
              { value: "api", label: "API" },
            ]}
          />
        </NextSettingRow>
      </NextSection>
      {settings.visualAnalysisProvider === "local" ? (
        <NextSection className="study-settings-group" title="Lokal analys">
          <NextSettingRow
            id="paddle-ocr"
            icon={<ShieldCheck />}
            title="PaddleOCR"
            description="Känner igen text i beskurna slidebilder på datorn. Kör bildextraheringen i föreläsningen för att uppdatera OCR-texten."
          >
            <span className="study-value-chip">Körs lokalt</span>
          </NextSettingRow>
          <NextSettingRow
            id="local-vision"
            icon={<Sparkles />}
            title="AI-bildbeskrivningar"
            description={
              localVision?.ready
                ? `${localVision.nvidiaName ?? "Nvidia-GPU"} är redo. Beskrivningar körs lokalt och bilderna lämnar inte datorn.`
                : localVision?.nvidiaDetected && localVision.modelInstalled && !localVision.nvidiaRuntimeReady
                  ? "Nvidia hittades, men CUDA-stödet saknas i Python-miljön. Reparera det här för att kunna beskriva bilder lokalt."
                  : localVision?.nvidiaDetected && localVision.nvidiaRuntimeReady && !localVision.modelWeightsReady
                    ? "Hämta bildmodellen här först. Den är cirka 10,5 GB och nedladdningen visas med verklig progress i hörnet."
                  : localVision?.nvidiaDetected
                    ? "Installera den lokala bildmotorn för att skapa korta AI-beskrivningar utan att skicka bilder till en tjänst."
                    : "Kräver en Nvidia-GPU. Textigenkänning med PaddleOCR fungerar ändå lokalt utan den."
            }
          >
            {localVision?.ready ? (
              <span className="study-value-chip study-value-success">
                <Check /> Redo
              </span>
            ) : (
              <NextButton
                disabled={visionBusy || !localVision?.nvidiaDetected}
                onClick={() => void repairLocalVision()}
              >
                {visionBusy ? <LoaderCircle className="study-spin" /> : <ImageIcon />}
                {visionBusy
                  ? "Installerar…"
                  : localVision?.modelInstalled && localVision.nvidiaDetected
                    ? !localVision.nvidiaRuntimeReady
                      ? "Reparera Nvidia-stöd"
                      : "Hämta bildmodell · 10,5 GB"
                    : localVision?.nvidiaDetected
                      ? "Installera lokal motor"
                      : "Nvidia-GPU krävs"}
              </NextButton>
            )}
          </NextSettingRow>
        </NextSection>
      ) : (
        <NextSection className="study-settings-group" title="OpenAI API">
          <NextSettingRow
            id="visual-model"
            icon={<Sparkles />}
            title="Modell"
            description="Välj en bildkapabel modell. Du kan också skriva ett annat modell-ID från ditt konto."
          >
            <ApiModelControl
              client={client}
              task="vision"
              providerKey={settings.visualAnalysisProvider}
              label="Modell för OCR och bildbeskrivning"
              value={settings.visualAnalysisModel}
              onChange={(visualAnalysisModel) =>
                update({ visualAnalysisModel })
              }
            />
          </NextSettingRow>
          <NextSettingRow
            id="visual-api-key"
            icon={<KeyRound />}
            title="API-nyckel"
            description="Sparas en gång i Windows Credential Manager. Används bara när du väljer att analysera bilder."
          >
            <CredentialControl
              client={client}
              credentialKey="visual:openai"
              label="OpenAI-nyckel för bildanalys"
              onNotice={onNotice}
            />
          </NextSettingRow>
        </NextSection>
      )}
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
  const aiKey = `ai:${settings.aiProvider}`;
  const test = async () => {
    setAnkiBusy(true);
    try {
      const result = await client.workflows.testAnki();
      if (!result.ok) return onNotice(result.error.message, true);
      setDecks(result.value.decks);
      if (
        !result.value.decks.includes(settings.defaultDeck) &&
        result.value.decks[0]
      )
        update({ defaultDeck: result.value.decks[0] });
      onNotice(`AnkiConnect svarar · version ${result.value.version}.`);
    } catch {
      onNotice(
        "AnkiConnect kunde inte testas. Kontrollera att Anki är öppet.",
        true,
      );
    } finally {
      setAnkiBusy(false);
    }
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
          id="generation-method"
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
          id="card-density"
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
          id="generation-context"
          icon={<Languages />}
          title="Generella instruktioner"
          description="Gäller alla kurser; mer specifik kontext kan fortfarande läggas i biblioteket."
        >
          <textarea
            className="study-control study-compact-textarea"
            aria-label="Instruktioner för Anki-kort"
            name="anki-generation-instructions"
            autoComplete="off"
            value={settings.userContext}
            onChange={(event) => update({ userContext: event.target.value })}
          />
        </NextSettingRow>
      </NextSection>
      {settings.aiMode === "api" && (
        <NextSection className="study-settings-group" title="AI-API">
          <NextSettingRow
            id="ai-provider"
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
            id="ai-model"
            icon={<Sparkles />}
            title="Modell"
            description="Välj ett förslag eller skriv modellnamnet exakt som providern anger."
          >
            {settings.aiProvider !== "custom" ? (
              <ApiModelControl
                client={client}
                task="cards"
                providerKey={settings.aiProvider}
                label="AI-modell"
                value={settings.aiModel}
                onChange={(aiModel) => update({ aiModel })}
              />
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
              id="ai-base-url"
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
            id="ai-api-key"
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
          id="anki-connection"
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
          id="anki-deck"
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
    let result: LectioResult<unknown>;
    try {
      result =
        action === "connect"
          ? await client.workflows.connectGoogleDrive()
          : action === "disconnect"
            ? await client.workflows.disconnectGoogleDrive()
            : action === "cancel"
              ? await client.workflows.cancelGoogleDriveConnection()
              : await client.workflows.syncLibrary();
    } catch {
      return onNotice("Google Drive-åtgärden misslyckades. Försök igen.", true);
    } finally {
      setBusy(false);
    }
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
          id="drive-account"
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
                <ConfirmAction
                  title="Koppla bort Google Drive?"
                  description="Den lokala datan finns kvar, men Lectio slutar synka tills du ansluter kontot igen."
                  confirmLabel="Koppla bort"
                  triggerLabel="Koppla bort"
                  busy={busy}
                  icon={<Unplug />}
                  onConfirm={() => run("disconnect")}
                />
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
          id="drive-folder"
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
          id="auto-sync"
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
  if (category === "general")
    return <GeneralPanel settings={props.settings} update={props.update} />;
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
  if (category === "image-analysis") return <ImageAnalysisPanel {...props} />;
  if (category === "ai-anki") return <AiAnkiPanel {...props} />;
  return <SyncPanel {...props} />;
}

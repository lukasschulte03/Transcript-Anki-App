import type { LocalEngineStatus, LocalModel } from "./localStt";
import type { LocalTranscriptionBenchmark } from "../core/types";

type ModelProfile = {
  download: string;
  ram: string;
  vram?: string;
  cpuMinutesPerAudioMinute: number;
  gpuMinutesPerAudioMinute: number;
};

const profiles: Record<LocalModel, ModelProfile> = {
  tiny: { download: "75 MB", ram: "~1 GB RAM", vram: "~1 GB VRAM", cpuMinutesPerAudioMinute: 0.25, gpuMinutesPerAudioMinute: 0.04 },
  base: { download: "142 MB", ram: "~1,5 GB RAM", vram: "~1 GB VRAM", cpuMinutesPerAudioMinute: 0.55, gpuMinutesPerAudioMinute: 0.08 },
  small: { download: "466 MB", ram: "~2 GB RAM", vram: "~2 GB VRAM", cpuMinutesPerAudioMinute: 1.5, gpuMinutesPerAudioMinute: 0.16 },
  medium: { download: "1,5 GB", ram: "~4 GB RAM", vram: "~4 GB VRAM", cpuMinutesPerAudioMinute: 3, gpuMinutesPerAudioMinute: 0.35 },
  "large-v3-turbo": { download: "1,5 GB", ram: "~4 GB RAM", vram: "~5 GB VRAM", cpuMinutesPerAudioMinute: 2.2, gpuMinutesPerAudioMinute: 0.22 },
  "large-v3": { download: "2,9 GB", ram: "~6 GB RAM", vram: "~8 GB VRAM", cpuMinutesPerAudioMinute: 4.2, gpuMinutesPerAudioMinute: 0.5 },
};

export type TranscriptionRecommendation = {
  model: LocalModel;
  reason: string;
  estimate: string;
  resources: string;
  warning?: string;
};

function estimateRange(minutes: number) {
  const lower = Math.max(1, Math.round(minutes * 0.75));
  const upper = Math.max(lower + 1, Math.round(minutes * 1.35));
  return `ca ${lower}–${upper} min`;
}

/** A deliberately conservative local estimate. It is not a benchmark. */
export function recommendLocalTranscription({
  durationSeconds,
  engine,
  benchmarks = {},
}: {
  durationSeconds: number;
  engine: LocalEngineStatus | null;
  benchmarks?: Partial<Record<"cpu" | "nvidia", LocalTranscriptionBenchmark>>;
}): TranscriptionRecommendation {
  const hasReadyNvidia = Boolean(engine?.nvidiaDetected && engine.nvidiaRuntimeReady);
  const cpuThreads = engine?.cpuThreads ?? 0;
  const durationMinutes = Math.max(1, durationSeconds / 60);
  const model: LocalModel = hasReadyNvidia
    ? "large-v3-turbo"
    : durationMinutes > 120
      ? "base"
      : cpuThreads >= 12
        ? "small"
        : "base";
  const profile = profiles[model];
  const benchmark = benchmarks[hasReadyNvidia ? "nvidia" : "cpu"];
  const estimatedMinutes = durationMinutes * (benchmark?.model === model
    ? benchmark.realtimeFactor
    : (
    hasReadyNvidia ? profile.gpuMinutesPerAudioMinute : profile.cpuMinutesPerAudioMinute
      ));
  const gpuName = engine?.nvidiaName ? ` på ${engine.nvidiaName}` : " med NVIDIA";

  return {
    model,
    reason: hasReadyNvidia
      ? `NVIDIA är redo${gpuName}; Large v3 Turbo ger hög kvalitet utan Large v3:s tyngsta körning.`
      : model === "small"
        ? "Datorn har många CPU-trådar, så Small ger en bra kvalitetsnivå utan grafikkort."
        : "Base är det säkraste och snabbaste standardvalet på CPU för längre ljudfiler.",
    estimate: `${estimateRange(estimatedMinutes)} ${hasReadyNvidia ? "med NVIDIA" : "på CPU"}${benchmark?.model === model ? " · baserat på ditt test" : ""}`,
    resources: [profile.download, profile.ram, hasReadyNvidia && profile.vram].filter(Boolean).join(" · "),
    warning: engine?.nvidiaDetected && !engine.nvidiaRuntimeReady
      ? "NVIDIA hittades, men CUDA-motorn är inte redo. Den här körningen använder CPU."
      : !hasReadyNvidia && model !== "base"
        ? "Medium och Large på CPU kan bli betydligt långsammare än uppskattningen."
        : undefined,
  };
}

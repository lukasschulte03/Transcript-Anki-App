/** Mobile recordings frequently arrive without a useful MIME type on Windows.
 * Keep acceptance based on both MIME and file extension, while retaining the
 * untouched original blob in IndexedDB. */
const audioExtensions = new Set([
  "m4a",
  "aac",
  "mp3",
  "wav",
  "mp4",
  "mpeg",
  "webm",
  "ogg",
  "opus",
  "flac",
]);

function extension(name: string) {
  return name.split(".").pop()?.toLocaleLowerCase("sv") ?? "";
}

export function isSupportedAudioFile(file: Pick<File, "name" | "type">) {
  return (
    file.type.startsWith("audio/") ||
    file.type === "video/mp4" ||
    audioExtensions.has(extension(file.name))
  );
}

export function validateAudioFile(file: Pick<File, "name" | "type" | "size">) {
  if (!isSupportedAudioFile(file))
    return `${file.name}: formatet stöds inte. Välj m4a/AAC, mp3, wav eller mp4-ljud.`;
  if (!file.size) return `${file.name}: filen är tom.`;
  return undefined;
}

export function audioFormat(file: Pick<File, "name" | "type">) {
  const value = extension(file.name);
  if (value) return value.toUpperCase();
  return (
    file.type.replace("audio/", "").replace("video/", "").toUpperCase() ||
    "LJUD"
  );
}

export function audioMimeType(file: Pick<File, "name" | "type">) {
  if (file.type) return file.type;
  const byExtension: Record<string, string> = {
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    mpeg: "audio/mpeg",
    webm: "audio/webm",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    flac: "audio/flac",
  };
  return byExtension[extension(file.name)] ?? "application/octet-stream";
}

export function audioFingerprint(
  file: Pick<File, "name" | "size" | "lastModified">,
) {
  return `${file.name.trim().toLocaleLowerCase("sv")}::${file.size}::${file.lastModified}`;
}

export function sortAudioFiles(files: File[]) {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, "sv", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function numberedAudioWarnings(files: File[]) {
  const numbers = files
    .map((file) => {
      const match = file.name
        .replace(/\.[^.]+$/, "")
        .match(/(?:^|[ _-])(\d{1,4})$/);
      return match ? Number(match[1]) : undefined;
    })
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (numbers.length < 2) return [];
  const warnings: string[] = [];
  if (new Set(numbers).size !== numbers.length)
    warnings.push(
      "Minst två ljuddelar har samma slutnummer. Kontrollera ordningen.",
    );
  const missing = numbers
    .slice(1)
    .find((value, index) => value > numbers[index] + 1);
  if (missing)
    warnings.push(
      `Numreringen hoppar från ${missing - 1} till ${missing}. En ljuddel kan saknas.`,
    );
  return warnings;
}

export function formatAudioBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export async function measureAudioDuration(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve) => {
      const audio = new Audio();
      const finish = (value: number) => {
        audio.removeAttribute("src");
        audio.load();
        resolve(Number.isFinite(value) && value > 0 ? value : 0);
      };
      audio.preload = "metadata";
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(0);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

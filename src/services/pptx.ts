import { unzipSync } from "fflate";

const imageMimeType = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    }[extension ?? ""] ?? "application/octet-stream"
  );
};

export type ExtractedPptxImage = {
  name: string;
  blob: Blob;
  /** The slide that references the image, when the PowerPoint relationship is intact. */
  slidePage?: number;
  /** Nearby, locally extracted slide text. This describes context, never pixels. */
  nearbyText?: string;
};

const decodeXml = (bytes: Uint8Array | undefined) =>
  bytes ? new TextDecoder().decode(bytes) : "";

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const archivePath = (base: string, target: string) => {
  const parts: string[] = [];
  for (const part of `${base}/${target}`.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
};

const xmlAttribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1];

/**
 * Extracts raster media and maps each one back to its slide through the PPTX
 * relationship graph. The original PPTX remains untouched; metadata is local.
 */
export function extractPptxImages(file: Blob) {
  return file.arrayBuffer().then((buffer) => {
    const archive = unzipSync(new Uint8Array(buffer));
    const metadataByPath = new Map<string, { slidePage: number; nearbyText?: string }>();

    for (const [path, bytes] of Object.entries(archive)) {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(path);
      if (!match) continue;
      const slidePage = Number(match[1]);
      const slideXml = decodeXml(bytes);
      const nearbyText = [...slideXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
        .map((item) => decodeEntities(item[1].replace(/<[^>]+>/g, "")).trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 420);
      const relationXml = decodeXml(
        archive[`ppt/slides/_rels/slide${slidePage}.xml.rels`],
      );
      const targets = new Map<string, string>();
      for (const relation of relationXml.match(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/gi) ?? []) {
        const id = xmlAttribute(relation, "Id");
        const target = xmlAttribute(relation, "Target");
        if (id && target) targets.set(id, archivePath("ppt/slides", target));
      }
      for (const embedded of slideXml.matchAll(/(?:r:embed|embed)="([^"]+)"/gi)) {
        const mediaPath = targets.get(embedded[1]);
        if (mediaPath && /\.(png|jpe?g|webp|gif)$/i.test(mediaPath) && !metadataByPath.has(mediaPath)) {
          metadataByPath.set(mediaPath, { slidePage, nearbyText: nearbyText || undefined });
        }
      }
    }

    return Object.entries(archive)
      .filter(([path]) => /(^|\/)ppt\/media\/.+\.(png|jpe?g|webp|gif)$/i.test(path))
      .map(([path, bytes]) => {
        const name = path.split("/").pop() ?? "slidebild";
        const metadata = metadataByPath.get(path);
        return {
          name,
          blob: new Blob([bytes.buffer as ArrayBuffer], {
            type: imageMimeType(name),
          }),
          ...metadata,
        };
      });
  });
}

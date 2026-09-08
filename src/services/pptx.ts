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

/** Extracts only embedded raster media; the original PPTX remains untouched. */
export function extractPptxImages(file: Blob) {
  return file.arrayBuffer().then((buffer) => {
    const archive = unzipSync(new Uint8Array(buffer));
    return Object.entries(archive)
      .filter(([path]) => /(^|\/)ppt\/media\/.+\.(png|jpe?g|webp|gif)$/i.test(path))
      .map(([path, bytes]) => {
        const name = path.split("/").pop() ?? "slidebild";
        return {
          name,
          blob: new Blob([bytes.buffer as ArrayBuffer], {
            type: imageMimeType(name),
          }),
        };
      });
  });
}

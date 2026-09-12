import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, remove, writeFile } from "@tauri-apps/plugin-fs";
import { uid } from "../lib/utils";
import { logDiagnostic } from "./diagnosticLog";
import { isTauri } from "./platform";

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

type LayoutBox = {
  label: "image" | "chart";
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type OcrBox = {
  text: string;
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type SlideLayoutResult = {
  boxes: LayoutBox[];
  textBoxes?: OcrBox[];
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const cropText = (crop: Omit<NormalizedCrop, "text">, textBoxes: OcrBox[] = []) =>
  textBoxes
    .filter((box) => {
      if (box.score < 0.45 || !box.text.trim()) return false;
      const centerX = (box.left + box.right) / 2;
      const centerY = (box.top + box.bottom) / 2;
      return (
        centerX >= crop.x &&
        centerX <= crop.x + crop.width &&
        centerY >= crop.y &&
        centerY <= crop.y + crop.height
      );
    })
    .map((box) => box.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);

async function imageSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * PP-StructureV3 detects slide layout in a persistent native worker. Unlike the
 * former OCR/pixel heuristic it only returns regions explicitly classified as
 * an image or chart, so text rules and decorative lines cannot become cards.
 */
export async function findSlideCrops(blob: Blob): Promise<NormalizedCrop[]> {
  if (!isTauri()) {
    throw new Error("Automatisk bildanalys kräver desktopappen.");
  }
  const started = performance.now();
  const [size, directory] = await Promise.all([
    imageSize(blob),
    join(await appDataDir(), "slide-layout-input"),
  ]);
  await mkdir(directory, { recursive: true });
  const inputPath = await join(directory, `${uid()}.png`);
  try {
    // Streaming avoids making another full ArrayBuffer copy of high-resolution
    // PDF pages in the WebView process.
    await writeFile(inputPath, blob.stream());
    logDiagnostic(
      "vision",
      "Analyserar slidebild med PP-DocLayout_plus-L-layoutdetektion.",
    );
    const result = await invoke<SlideLayoutResult>("detect_slide_layout", {
      inputPath,
    });
    const crops = result.boxes
      .filter((box) => box.score >= 0.55)
      .map((box) => ({
        x: clamp(box.left / size.width),
        y: clamp(box.top / size.height),
        width: clamp((box.right - box.left) / size.width),
        height: clamp((box.bottom - box.top) / size.height),
      }))
      .filter((crop) => {
        const area = crop.width * crop.height;
        const ratio = crop.width / Math.max(crop.height, 0.0001);
        // A box covering almost the entire slide is a layout failure, not a
        // reusable visual. It previously created blurry slide-sized cards.
        const isNearlyWholeSlide =
          area >= 0.68 || (crop.width >= 0.9 && crop.height >= 0.72);
        return (
          crop.width >= 0.05 &&
          crop.height >= 0.05 &&
          area >= 0.008 &&
          !isNearlyWholeSlide &&
          ratio >= 0.18 &&
          ratio <= 5.8
        );
      })
      .map((crop) => ({ ...crop, text: cropText(crop, result.textBoxes) || undefined }))
      .sort(
        (left, right) => right.width * right.height - left.width * left.height,
      )
      .slice(0, 8);
    logDiagnostic(
      "vision",
      `PP-StructureV3 analyserade slidebilden: ${crops.length} bildutklipp på ${Math.round(performance.now() - started)} ms.`,
    );
    return crops;
  } catch (error) {
    logDiagnostic("vision", error, {
      level: "error",
      context: "PP-StructureV3-layoutanalys",
    });
    throw error;
  } finally {
    await remove(inputPath).catch(() => undefined);
  }
}

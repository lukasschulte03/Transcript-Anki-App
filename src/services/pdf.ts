import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorker;

export function formatSlideText(pages: string[]) {
  return pages
    .map((text, index) =>
      text.trim() ? `Slide ${index + 1}\n${text.trim()}` : "",
    )
    .filter(Boolean)
    .join("\n\n");
}

export async function extractPdfPages(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({ data: bytes });
  try {
    const document = await task.promise;
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }),
    );
    return pages;
  } finally {
    await task.destroy();
  }
}

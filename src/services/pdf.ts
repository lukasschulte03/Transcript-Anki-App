let pdfRuntime: Promise<typeof import("pdfjs-dist")> | undefined;

async function ocrPdfPage(page: any) {
  // Lazy-loaded and only called for image-only pages; ordinary PDFs never pay
  // the OCR download or CPU cost. Failure remains non-destructive: the page is
  // simply returned as textless and can still be viewed/imported normally.
  try {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return "";
    await page.render({ canvasContext: context, viewport }).promise;
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("swe+eng");
    try {
      const result = await worker.recognize(canvas);
      return result.data.text.replace(/\s+/g, " ").trim();
    } finally {
      await worker.terminate();
    }
  } catch {
    return "";
  }
}

async function loadPdfRuntime() {
  pdfRuntime ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdf, worker]) => {
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    return pdf;
  });
  return pdfRuntime;
}

export function formatSlideText(pages: string[]) {
  return pages
    .map((text, index) =>
      text.trim() ? `Slide ${index + 1}\n${text.trim()}` : "",
    )
    .filter(Boolean)
    .join("\n\n");
}

export async function extractPdfPages(blob: Blob): Promise<string[]> {
  const { getDocument } = await loadPdfRuntime();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({ data: bytes });
  try {
    const document = await task.promise;
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return text || ocrPdfPage(page);
      }),
    );
    return pages;
  } finally {
    await task.destroy();
  }
}

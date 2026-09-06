let pdfRuntime: Promise<typeof import("pdfjs-dist")> | undefined;

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

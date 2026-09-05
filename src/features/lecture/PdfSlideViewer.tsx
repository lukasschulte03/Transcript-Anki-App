import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
} from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../../components/ui/Button";

GlobalWorkerOptions.workerSrc = pdfWorker;

export function PdfSlideViewer({ blob, name }: { blob: Blob; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const previousPage = useCallback(
    () => setPage((value) => Math.max(1, value - 1)),
    [],
  );
  const nextPage = useCallback(
    () => setPage((value) => Math.min(pageCount ?? value + 1, value + 1)),
    [pageCount],
  );

  useEffect(() => {
    let cancelled = false;
    let documentTask: ReturnType<typeof getDocument> | undefined;
    const render = async () => {
      setLoading(true);
      setError("");
      try {
        documentTask = getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
        });
        const document = await documentTask.promise;
        if (cancelled) return;
        setPageCount(document.numPages);
        const safePage = Math.min(page, document.numPages);
        if (safePage !== page) setPage(safePage);
        const pdfPage = await document.getPage(safePage);
        const viewport = pdfPage.getViewport({ scale: 1.6 });
        const target = canvas.current;
        if (!target || cancelled) return;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        const context = target.getContext("2d");
        if (!context) throw new Error("Kunde inte skapa slideyta");
        await pdfPage.render({
          canvas: target,
          canvasContext: context,
          viewport,
        }).promise;
        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setError("PDF:en kunde inte visas. Prova att importera filen igen.");
          setLoading(false);
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
      void documentTask?.destroy();
    };
  }, [blob, page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        document.querySelector("[role='dialog']") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (event.key === "PageUp" || event.key === "[") {
        event.preventDefault();
        previousPage();
      } else if (event.key === "PageDown" || event.key === "]") {
        event.preventDefault();
        nextPage();
      } else if (event.key === "Home") {
        event.preventDefault();
        setPage(1);
      } else if (event.key === "End" && pageCount) {
        event.preventDefault();
        setPage(pageCount);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextPage, pageCount, previousPage]);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col"
      aria-label={`Slides: ${name}`}
    >
      <div className="flex h-9 shrink-0 items-center justify-end px-1 text-xs text-[var(--palette-text-muted)]">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={previousPage}
            disabled={page <= 1}
            aria-label="Föregående slide"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-14 text-center tabular-nums">
            {pageCount ? `${page} / ${pageCount}` : "…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={nextPage}
            disabled={!pageCount || page >= pageCount}
            aria-label="Nästa slide"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-auto bg-[var(--palette-surface-muted)]">
        {loading && (
          <LoaderCircle
            className="absolute size-5 animate-spin text-[var(--palette-text-subtle)]"
            aria-label="Laddar slide"
          />
        )}
        {error ? (
          <div className="max-w-64 text-center text-xs leading-5 text-[var(--palette-text-muted)]">
            <FileWarning className="mx-auto mb-2 size-6 text-[var(--palette-warning)]" />
            {error}
          </div>
        ) : (
          <canvas ref={canvas} className="max-h-full max-w-full bg-white" />
        )}
      </div>
    </div>
  );
}

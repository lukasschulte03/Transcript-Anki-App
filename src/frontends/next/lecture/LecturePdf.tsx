import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Maximize2,
  Plus,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import type { LectioClient } from "../../../application/lectioClient";
import { NextButton, NextIconButton } from "../ui/NextPrimitives";
import { lectureCopy as c } from "./lectureCopy";

export function LecturePdf({
  client,
  assetId,
  name,
  busy,
  onImport,
}: {
  client: LectioClient;
  assetId?: string;
  name?: string;
  busy: boolean;
  onImport(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [retry, setRetry] = useState(0);
  const [accessibleText, setAccessibleText] = useState("");

  useEffect(() => {
    let disposed = false;
    if (!document) return;
    void document
      .getPage(page)
      .then((current) => current.getTextContent())
      .then((content) => {
        if (!disposed)
          setAccessibleText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
      })
      .catch(() => {
        if (!disposed) setAccessibleText("");
      });
    return () => {
      disposed = true;
    };
  }, [document, page]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => setWidth(Math.floor(entry.contentRect.width)),
        100,
      );
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(undefined);
    setPage(1);
    setZoom(1);
    setError("");
    setRendering(true);
    if (!assetId) return;
    void (async () => {
      try {
        const [result, pdf, worker] = await Promise.all([
          client.assets.read(assetId),
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        if (disposed) return;
        if (!result.ok) throw new Error(result.error.message);
        const bytes = await result.value.arrayBuffer();
        if (disposed) return;
        pdf.GlobalWorkerOptions.workerSrc = worker.default;
        task = pdf.getDocument({ data: new Uint8Array(bytes) });
        const loaded = await task.promise;
        if (!disposed) setDocument(loaded);
      } catch {
        if (!disposed) {
          setError(c.pdfError);
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      void task?.destroy().catch(() => {});
    };
  }, [client, assetId, retry]);

  useEffect(() => {
    if (!document || !width || !canvas.current) return;
    let disposed = false;
    let render: RenderTask | undefined;
    const target = canvas.current;
    setRendering(true);
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (disposed) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(0.1, (width - 48) / original.width) * zoom;
        const view = pdfPage.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(8_000_000 / (view.width * view.height)),
        );
        // Separate offscreen canvas per render: rapid resize/page changes cannot race over one canvas.
        const buffer = window.document.createElement("canvas");
        buffer.width = Math.ceil(view.width * ratio);
        buffer.height = Math.ceil(view.height * ratio);
        render = pdfPage.render({
          canvas: buffer,
          viewport: view,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (!disposed) {
          target.width = buffer.width;
          target.height = buffer.height;
          target.style.width = `${view.width}px`;
          target.style.height = `${view.height}px`;
          target.getContext("2d")?.drawImage(buffer, 0, 0);
          setRendering(false);
        }
        buffer.width = 0;
        buffer.height = 0;
        pdfPage.cleanup();
      } catch (reason) {
        if (
          !disposed &&
          !(
            reason instanceof Error &&
            reason.name === "RenderingCancelledException"
          )
        ) {
          setError(c.pdfError);
          setRendering(false);
        }
      }
    })();
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [document, page, width, zoom]);

  return (
    <section className="lecture-material" aria-label={c.slides}>
      <header className="lecture-pane-header">
        <span className="lecture-filename">
          <FileText />
          <span title={name}>{name || c.slides}</span>
        </span>
        {assetId && (
          <NextIconButton
            className="lecture-icon"
            title={c.replacePdf}
            aria-label={c.replacePdf}
            disabled={busy}
            onClick={onImport}
          >
            <RefreshCw />
          </NextIconButton>
        )}
      </header>
      <div className="lecture-pdf-stage" ref={host}>
        {!assetId ? (
          <div className="lecture-empty lecture-empty-pdf">
            <div className="lecture-paper-glyph" aria-hidden="true">
              <FileText />
            </div>
            <h2>{c.pdfEmpty}</h2>
            <p>{c.pdfHint}</p>
            <NextButton
              className="lecture-action"
              disabled={busy}
              onClick={onImport}
            >
              <Plus />
              {c.importPdf}
            </NextButton>
          </div>
        ) : error ? (
          <div className="lecture-empty" role="alert">
            <FileText />
            <p>{error}</p>
            <NextButton
              className="lecture-action"
              onClick={() => setRetry((value) => value + 1)}
            >
              {c.retry}
            </NextButton>
          </div>
        ) : (
          <>
            <canvas
              ref={canvas}
              className="lecture-pdf-page"
              aria-label={`${c.slides}, sida ${page}`}
              aria-hidden="true"
              style={{ visibility: document ? "visible" : "hidden" }}
            />
            <section
              className="lecture-screenreader-text"
              aria-label={`Text på PDF-sida ${page}`}
            >
              {accessibleText ||
                "Den här sidan saknar tillgänglig text och kan innehålla bilder."}
            </section>
            {rendering && (
              <div className="lecture-pdf-loading" role="status">
                <LoaderCircle className="lecture-spin" />
                {c.loadingPdf}
              </div>
            )}
          </>
        )}
      </div>
      {assetId && !error && (
        <footer className="lecture-pdf-tools">
          <div>
            <NextIconButton
              className="lecture-icon"
              aria-label={c.previous}
              disabled={!document || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft />
            </NextIconButton>
            <span aria-live="polite">
              {page}{" "}
              <span className="lecture-muted">
                / {document?.numPages ?? "—"}
              </span>
            </span>
            <NextIconButton
              className="lecture-icon"
              aria-label={c.next}
              disabled={!document || page >= document.numPages}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight />
            </NextIconButton>
          </div>
          <div>
            <NextIconButton
              className="lecture-icon"
              aria-label={c.zoomOut}
              disabled={zoom <= 0.75}
              onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            >
              <ZoomOut />
            </NextIconButton>
            <NextIconButton
              className="lecture-icon"
              aria-label={c.zoomIn}
              disabled={zoom >= 2}
              onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
            >
              <ZoomIn />
            </NextIconButton>
            <button
              className="lecture-icon"
              aria-label={c.fit}
              onClick={() => setZoom(1)}
            >
              <Maximize2 />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

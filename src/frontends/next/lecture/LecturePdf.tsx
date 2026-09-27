/* oxlint-disable react/set-state-in-effect -- effects synchronize the PDF document lifecycle. */
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  LoaderCircle,
  PanelsTopLeft,
  Maximize2,
  Plus,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Images,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import type { LectioClient } from "../../../application/lectioClient";
import { NextButton, NextIconButton } from "../ui/NextPrimitives";
import { lectureCopy as c } from "./lectureCopy";
import { isKeyboardShortcutBlocked } from "../keyboardShortcuts";
import {
  detectSlideGrid,
  makeSlideGrid,
  trimSlideGrid,
  type SlideGrid,
  type SlideRegion,
} from "./slideGrid";

type VisiblePage = { sourcePage: number; region?: SlideRegion };

const splitLayouts = [
  [1, 2],
  [2, 1],
  [2, 2],
  [3, 2],
  [2, 3],
] as const;
const splitLayoutKey = (rows: number, columns: number) => `${rows}x${columns}`;
const sameGridGeometry = (left: SlideGrid, right: SlideGrid) =>
  left.regions.length === right.regions.length &&
  left.regions.every((region, index) => {
    const other = right.regions[index];
    return (
      Math.abs(region.x - other.x) < 0.001 &&
      Math.abs(region.y - other.y) < 0.001 &&
      Math.abs(region.width - other.width) < 0.001 &&
      Math.abs(region.height - other.height) < 0.001
    );
  });

export function LecturePdf({
  client,
  assetId,
  name,
  slidePageSplits,
  busy,
  onImport,
  onSplitPagesChange,
  onImages,
  imageCount,
}: {
  client: LectioClient;
  assetId?: string;
  name?: string;
  slidePageSplits?: Record<number, SlideRegion[]>;
  busy: boolean;
  onImport(): void;
  onSplitPagesChange(
    sourcePages: number[],
    regions: SlideRegion[] | null,
  ): boolean;
  onImages(): void;
  imageCount: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [pageAspectRatio, setPageAspectRatio] = useState(1.414);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [retry, setRetry] = useState(0);
  const [accessibleText, setAccessibleText] = useState("");
  const [suggestion, setSuggestion] = useState<{
    sourcePage: number;
    grid: SlideGrid;
  }>();
  const [splitEditor, setSplitEditor] = useState<{
    sourcePage: number;
    grid: SlideGrid;
    presetGrids: Record<string, SlideGrid>;
    fittedGrids: Record<string, SlideGrid>;
    cropMode: "standard" | "fitted";
    manualChoiceRequired: boolean;
    excludedRegions: number[];
  }>();
  const [splitPreview, setSplitPreview] = useState("");
  const previewUrl = useRef("");
  const detectedPages = useRef(new Set<number>());

  const sharedSplitRegions = useMemo(() => {
    const validRegions = Object.values(slidePageSplits ?? {}).find(
      (regions) =>
        regions.length >= 2 &&
        regions.every(
          (region) =>
            Number.isFinite(region.x) &&
            Number.isFinite(region.y) &&
            Number.isFinite(region.width) &&
            Number.isFinite(region.height) &&
            region.x >= 0 &&
            region.y >= 0 &&
            region.width > 0 &&
            region.height > 0 &&
            region.x + region.width <= 1.001 &&
            region.y + region.height <= 1.001,
        ),
    );
    return validRegions;
  }, [slidePageSplits]);

  const visiblePages = useMemo<VisiblePage[]>(() => {
    if (!document) return [];
    return Array.from(
      { length: document.numPages },
      (_, index) => index + 1,
    ).flatMap((sourcePage) => {
      return sharedSplitRegions
        ? sharedSplitRegions.map((region) => ({ sourcePage, region }))
        : [{ sourcePage }];
    });
  }, [document, sharedSplitRegions]);
  const activePage = visiblePages[page - 1];
  const activeSourcePage = activePage?.sourcePage ?? 1;
  const activeIsSplit = Boolean(activePage?.region);

  useEffect(() => {
    if (!document || error) return;
    const handle = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isKeyboardShortcutBlocked(event)
      ) return;

      if (event.key === "PageUp") {
        event.preventDefault();
        setPage((current) => Math.max(1, current - 1));
      } else if (event.key === "PageDown") {
        event.preventDefault();
        setPage((current) => Math.min(visiblePages.length, current + 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setPage(1);
      } else if (event.key === "End") {
        event.preventDefault();
        setPage(visiblePages.length);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [document, error, visiblePages.length]);

  useEffect(() => {
    if (!splitEditor) return;
    const currentCanvas = canvas.current;
    if (!currentCanvas) return;
    let cancelled = false;
    currentCanvas.toBlob(
      (blob) => {
        if (!blob || cancelled) return;
        const url = URL.createObjectURL(blob);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setSplitPreview(url);
      },
      "image/jpeg",
      0.78,
    );
    return () => {
      cancelled = true;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = "";
    };
  }, [splitEditor]);

  useEffect(() => {
    let disposed = false;
    if (!document) return;
    void document
      .getPage(activeSourcePage)
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
  }, [document, activeSourcePage]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setWidth(Math.floor(entry.contentRect.width));
        setHeight(Math.floor(entry.contentRect.height));
      }, 100);
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
    detectedPages.current.clear();
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
    if (!document || !width || !height || !canvas.current || !activePage)
      return;
    let disposed = false;
    let render: RenderTask | undefined;
    const target = canvas.current;
    setRendering(true);
    void (async () => {
      try {
        const pdfPage = await document.getPage(activeSourcePage);
        if (disposed) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const region = activePage.region ?? {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        };
        const scale =
          Math.max(
            0.1,
            Math.min(
              (width - 48) / (original.width * region.width),
              (height - 48) / (original.height * region.height),
            ),
          ) * zoom;
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
          const sourceX = Math.floor(buffer.width * region.x);
          const sourceY = Math.floor(buffer.height * region.y);
          const sourceWidth = Math.max(
            1,
            Math.ceil(buffer.width * region.width),
          );
          const sourceHeight = Math.max(
            1,
            Math.ceil(buffer.height * region.height),
          );
          target.width = sourceWidth;
          target.height = sourceHeight;
          target.style.width = `${(view.width * region.width).toFixed(1)}px`;
          target.style.height = `${(view.height * region.height).toFixed(1)}px`;
          setPageAspectRatio(
            (view.width * region.width) / (view.height * region.height),
          );
          target
            .getContext("2d")
            ?.drawImage(
              buffer,
              sourceX,
              sourceY,
              sourceWidth,
              sourceHeight,
              0,
              0,
              sourceWidth,
              sourceHeight,
            );
          setRendering(false);
          if (
            !activePage.region &&
            !sharedSplitRegions &&
            !detectedPages.current.has(activeSourcePage)
          ) {
            detectedPages.current.add(activeSourcePage);
            const grid = detectSlideGrid(target);
            if (grid) setSuggestion({ sourcePage: activeSourcePage, grid });
          }
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
  }, [
    document,
    activeSourcePage,
    activePage,
    width,
    height,
    zoom,
    sharedSplitRegions,
  ]);

  const openSplitEditor = (grid?: SlideGrid) => {
    if (!activePage || activeIsSplit || !canvas.current) return;
    const detected = grid ?? detectSlideGrid(canvas.current);
    const presetGrids: Record<string, SlideGrid> = {};
    const fittedGrids: Record<string, SlideGrid> = {};
    for (const [rows, columns] of splitLayouts) {
      const key = splitLayoutKey(rows, columns);
      const standard = makeSlideGrid(rows, columns);
      presetGrids[key] = standard;
      fittedGrids[key] = trimSlideGrid(canvas.current, standard);
    }
    // Keep detected geometry separately: selecting the same layout must
    // restore the exact equal-cell grid, while "Anpassa innehåll" can bring
    // the detected crop back on demand.
    if (detected) {
      const key = splitLayoutKey(detected.rows, detected.columns);
      if (presetGrids[key]) fittedGrids[key] = detected;
    }
    const detectedKey = detected
      ? splitLayoutKey(detected.rows, detected.columns)
      : "";
    const initialCropMode =
      detected &&
      fittedGrids[detectedKey] &&
      !sameGridGeometry(presetGrids[detectedKey], fittedGrids[detectedKey])
        ? "fitted"
        : "standard";
    setSplitEditor({
      sourcePage: activeSourcePage,
      grid: detected ?? presetGrids[splitLayoutKey(1, 2)],
      presetGrids,
      fittedGrids,
      cropMode: initialCropMode,
      manualChoiceRequired: !detected,
      excludedRegions: [],
    });
  };
  const currentSuggestion =
    suggestion?.sourcePage === activeSourcePage && !activeIsSplit
      ? suggestion
      : undefined;

  const saveSplit = () => {
    if (!splitEditor || splitEditor.manualChoiceRequired) return;
    const regions = splitEditor.grid.regions.filter(
      (_, index) => !splitEditor.excludedRegions.includes(index),
    );
    if (regions.length < 2) return;
    const sourcePages = Array.from(
      { length: document?.numPages ?? 1 },
      (_, index) => index + 1,
    );
    if (onSplitPagesChange(sourcePages, regions)) {
      setSuggestion(undefined);
      setSplitEditor(undefined);
      setSplitPreview("");
    }
  };

  const restoreSplit = (sourcePage: number) => {
    const sourcePages = Array.from(
      { length: document?.numPages ?? 1 },
      (_, index) => index + 1,
    );
    if (onSplitPagesChange(sourcePages, null)) {
      setPage(Math.max(1, sourcePage));
      setSplitEditor(undefined);
      setSplitPreview("");
      setSuggestion(undefined);
      detectedPages.current.clear();
    }
  };

  return (
    <section className="lecture-material" aria-label={c.slides}>
      <header className="lecture-pane-header">
        <span className="lecture-filename">
          <FileText />
          <span title={name}>{name || c.slides}</span>
        </span>
        {assetId && (
          <div className="lecture-pane-actions">
            <NextButton className="lecture-action" onClick={onImages}>
              <Images /> Bilder{imageCount ? ` (${imageCount})` : ""}
            </NextButton>
            {activeIsSplit ? (
              <NextButton
                className="lecture-action"
                title="Återställ uppdelningen på alla sidor"
                onClick={() => restoreSplit(activeSourcePage)}
              >
                <Undo2 /> Återställ alla
              </NextButton>
            ) : (
              <NextIconButton
                className="lecture-icon"
                title="Dela sammansatta slides"
                aria-label="Dela sammansatta slides"
                disabled={!document || busy}
                onClick={() => openSplitEditor(currentSuggestion?.grid)}
              >
                <PanelsTopLeft />
              </NextIconButton>
            )}
            <NextIconButton
              className="lecture-icon"
              title={c.replacePdf}
              aria-label={c.replacePdf}
              disabled={busy}
              onClick={onImport}
            >
              <RefreshCw />
            </NextIconButton>
          </div>
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
              aria-label={`${c.slides}, sida ${page} av ${visiblePages.length}`}
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
            {currentSuggestion && (
              <div className="lecture-split-suggestion" role="status">
                <span>
                  Flera slides på samma PDF-sida ·{" "}
                  {currentSuggestion.grid.regions.length} delar
                </span>
                <button onClick={() => openSplitEditor(currentSuggestion.grid)}>
                  Granska delning
                </button>
                <button
                  aria-label="Ignorera förslag"
                  onClick={() => setSuggestion(undefined)}
                >
                  <X />
                </button>
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
                / {visiblePages.length || "—"}
              </span>
            </span>
            <NextIconButton
              className="lecture-icon"
              aria-label={c.next}
              disabled={!document || page >= visiblePages.length}
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
      <Dialog.Root
        open={Boolean(splitEditor)}
        onOpenChange={(open) => {
          if (open) return;
          setSplitEditor(undefined);
          setSplitPreview("");
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="lecture-dialog-overlay" />
          <Dialog.Content className="lecture-dialog lecture-split-dialog">
            <header>
              <div>
                <Dialog.Title>Dela sammansatta slides</Dialog.Title>
                <Dialog.Description>
                  {splitEditor?.manualChoiceRequired
                    ? "Vi hittade inget säkert rutnät. Välj en layout och kontrollera förhandsvisningen. Samma uppdelning används på alla PDF-sidor. Originalfilen ändras inte."
                    : "Granska rutorna och välj en layout. Samma uppdelning används på alla PDF-sidor. Originalfilen ändras inte."}
                </Dialog.Description>
              </div>
              <Dialog.Close className="lecture-icon" aria-label={c.close}>
                <X />
              </Dialog.Close>
            </header>
            <div
              className="lecture-split-preview"
              style={{ aspectRatio: pageAspectRatio }}
            >
              {splitPreview && (
                <img
                  src={splitPreview}
                  alt={`Förhandsvisning av PDF-sida ${splitEditor?.sourcePage}`}
                />
              )}
              {!splitEditor?.manualChoiceRequired && (
                <div className="lecture-split-regions">
                  {splitEditor?.grid.regions.map((region, index) => (
                    <button
                      key={`${region.x}-${region.y}`}
                      type="button"
                      aria-label={`${splitEditor.excludedRegions.includes(index) ? "Ta med" : "Ta bort"} del ${index + 1}`}
                      aria-pressed={
                        !splitEditor.excludedRegions.includes(index)
                      }
                      style={{
                        left: `${region.x * 100}%`,
                        top: `${region.y * 100}%`,
                        width: `${region.width * 100}%`,
                        height: `${region.height * 100}%`,
                      }}
                      onClick={() =>
                        setSplitEditor((current) => {
                          if (!current) return current;
                          const excluded = new Set(current.excludedRegions);
                          if (excluded.has(index)) excluded.delete(index);
                          else excluded.add(index);
                          return { ...current, excludedRegions: [...excluded] };
                        })
                      }
                    >
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
              )}
              {splitEditor?.manualChoiceRequired && (
                <span className="lecture-split-manual-hint">
                  Välj rutnät för att visa beskärningen
                </span>
              )}
            </div>
            <div
              className="lecture-split-layouts"
              role="group"
              aria-label="Välj rutnät"
            >
              {splitLayouts.map(([rows, columns]) => (
                <button
                  key={`${rows}-${columns}`}
                  className="lecture-action"
                  aria-label={`${rows} rader, ${columns} kolumner`}
                  aria-pressed={Boolean(
                    splitEditor &&
                    !splitEditor.manualChoiceRequired &&
                    splitEditor.grid.rows === rows &&
                    splitEditor.grid.columns === columns,
                  )}
                  onClick={() =>
                    setSplitEditor((current) =>
                      current
                        ? {
                            ...current,
                            grid: current.presetGrids[
                              splitLayoutKey(rows, columns)
                            ] ?? makeSlideGrid(rows, columns),
                            cropMode: "standard",
                            manualChoiceRequired: false,
                            excludedRegions: [],
                          }
                        : current,
                    )
                  }
                >
                  {rows} rad{rows === 1 ? "" : "er"} · {columns} kol.
                </button>
              ))}
            </div>
            {splitEditor && !splitEditor.manualChoiceRequired && (
              <div
                className="lecture-split-crop-modes"
                role="group"
                aria-label="Beskärning av rutorna"
              >
                <button
                  className="lecture-action"
                  aria-label="Standardbeskärning"
                  aria-pressed={splitEditor.cropMode === "standard"}
                  onClick={() =>
                    setSplitEditor((current) => {
                      if (!current) return current;
                      const key = splitLayoutKey(
                        current.grid.rows,
                        current.grid.columns,
                      );
                      return {
                        ...current,
                        grid: current.presetGrids[key] ?? current.grid,
                        cropMode: "standard",
                        excludedRegions: [],
                      };
                    })
                  }
                >
                  Standard
                </button>
                <button
                  className="lecture-action"
                  aria-label="Anpassa till innehåll"
                  aria-pressed={splitEditor.cropMode === "fitted"}
                  disabled={sameGridGeometry(
                    splitEditor.presetGrids[
                      splitLayoutKey(
                        splitEditor.grid.rows,
                        splitEditor.grid.columns,
                      )
                    ] ?? splitEditor.grid,
                    splitEditor.fittedGrids[
                      splitLayoutKey(
                        splitEditor.grid.rows,
                        splitEditor.grid.columns,
                      )
                    ] ?? splitEditor.grid,
                  )}
                  title="Beskär jämnt efter innehållets tomma marginaler"
                  onClick={() =>
                    setSplitEditor((current) => {
                      if (!current) return current;
                      const key = splitLayoutKey(
                        current.grid.rows,
                        current.grid.columns,
                      );
                      return {
                        ...current,
                        grid: current.fittedGrids[key] ?? current.grid,
                        cropMode: "fitted",
                        excludedRegions: [],
                      };
                    })
                  }
                >
                  Anpassa innehåll
                </button>
              </div>
            )}
            <footer>
              <span>
                {splitEditor?.manualChoiceRequired
                  ? "Välj en layout för att fortsätta"
                  : `Alla PDF-sidor delas i ${Math.max(0, (splitEditor?.grid.regions.length ?? 0) - (splitEditor?.excludedRegions.length ?? 0))} delar · klicka på rutor som inte ska med`}
              </span>
              <button
                className="lecture-action"
                onClick={() => {
                  setSplitEditor(undefined);
                  setSplitPreview("");
                }}
              >
                {c.cancel}
              </button>
              <button
                className="lecture-action lecture-primary-action"
                disabled={
                  splitEditor?.manualChoiceRequired ||
                  (splitEditor?.grid.regions.length ?? 0) -
                    (splitEditor?.excludedRegions.length ?? 0) <
                    2
                }
                onClick={saveSplit}
              >
                <Check /> Dela alla sidor
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

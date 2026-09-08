import { useEffect, useState } from "react";
import { FileWarning, LoaderCircle } from "lucide-react";

/**
 * Uses WebView2's native PDF renderer inside the slide panel instead of
 * retaining PDF.js canvases, workers and render tasks between lecture changes.
 * The parent owns and revokes `source`, so one Blob URL exists per active slide.
 */
export function PdfSlideViewer({ source, name }: { source: string; name: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [activeSource, setActiveSource] = useState(source);

  useEffect(() => {
    setState("loading");

    // WebView2's built-in PDF extension can retain native document memory for
    // a while after src changes. Explicitly navigating the *same* iframe to
    // about:blank for one frame releases the previous document before a new,
    // potentially hundreds-of-megabytes PDF is attached.
    setActiveSource("about:blank");
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setActiveSource(source));
    });

    // WebView2's PDF extension does not consistently emit iframe load events.
    // The native viewer has its own loading UI, so remove Lectio's overlay after
    // a short grace period rather than leaving a false infinite spinner on top.
    const fallback = window.setTimeout(() => setState("ready"), 1_500);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
    };
  }, [source]);

  if (state === "failed") {
    return (
      <div className="grid h-full min-h-0 w-full place-items-center bg-[var(--palette-surface-muted)] px-6 text-center text-xs leading-5 text-[var(--palette-text-muted)]">
        <span>
          <FileWarning className="mx-auto mb-2 size-6 text-[var(--palette-warning)]" />
          PDF:en kunde inte visas.
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--palette-surface-muted)]" aria-label={`Slides: ${name}`}>
      <iframe
        key={activeSource}
        title={`PDF: ${name}`}
        src={activeSource}
        className="h-full w-full border-0 bg-white"
        onLoad={() => {
          if (activeSource === source) setState("ready");
        }}
        onError={() => setState("failed")}
      />
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--palette-surface-muted)]">
          <LoaderCircle className="size-5 animate-spin text-[var(--palette-text-subtle)]" aria-label="Laddar PDF" />
        </div>
      )}
    </div>
  );
}

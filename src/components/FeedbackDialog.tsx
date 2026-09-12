/* oxlint-disable react/set-state-in-effect -- dialog state is synchronized from a newly supplied error. */
import { useEffect, useMemo, useState } from "react";
import { Bug, Download, LoaderCircle, Send, ShieldCheck } from "lucide-react";
import { toast } from "../services/feedbackToast";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Label, Select, Textarea } from "./ui/Form";
import {
  createDiagnosticSnapshot,
  exportDiagnosticSnapshot,
  reportingEnabled,
  sendFeedback,
} from "../services/diagnostics";

export function FeedbackDialog({
  open,
  onOpenChange,
  initialError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialError?: string;
}) {
  const [category, setCategory] = useState<"fel" | "förslag" | "annat">("fel");
  const [message, setMessage] = useState(initialError ?? "");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<string>("");
  useEffect(() => {
    if (open && initialError) setMessage(initialError);
  }, [initialError, open]);
  const canSend = useMemo(() => message.trim().length > 2, [message]);

  const previewDiagnostics = async () => {
    const snapshot = await createDiagnosticSnapshot();
    setPreview(JSON.stringify(snapshot, null, 2));
    setPreviewOpen(true);
  };
  const submit = async () => {
    setSending(true);
    try {
      const result = await sendFeedback({ category, message, includeDiagnostics });
      if (!result.delivered) {
        await exportDiagnosticSnapshot();
        toast.message("Diagnostik sparades lokalt. Direkt rapportering aktiveras innan betatestet delas.");
      } else {
        toast.success("Tack — rapporten skickades.");
      }
      onOpenChange(false);
      setMessage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rapporten kunde inte skickas.");
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rapportera problem"
      description="Hjälp oss förbättra Lectio utan att dela ditt studiematerial."
    >
      <div className="mt-5 space-y-5">
        <div className="flex gap-3 rounded-lg border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--palette-success)]" />
          <p className="text-xs leading-5 text-[var(--palette-text-muted)]">
            Vi skickar aldrig ljud, slides, transkript, API-nycklar eller riktiga filvägar. Du väljer själv om teknisk diagnostik ska inkluderas.
          </p>
        </div>
        <div>
          <Label>Typ av feedback</Label>
          <Select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
            <option value="fel">Något fungerar inte</option>
            <option value="förslag">Förslag eller förbättring</option>
            <option value="annat">Annat</option>
          </Select>
        </div>
        <div>
          <Label>Vad hände?</Label>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            placeholder="Till exempel: Jag tryckte på Transkribera med NVIDIA och fick ett fel efter några sekunder."
          />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--palette-border)] p-3 hover:bg-[var(--palette-surface-hover)]">
          <input
            type="checkbox"
            checked={includeDiagnostics}
            onChange={(event) => setIncludeDiagnostics(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--palette-primary)]"
          />
            <span>
              <span className="block text-sm font-medium text-[var(--palette-text)]">Bifoga teknisk diagnostik</span>
            <span className="mt-0.5 block text-xs leading-5 text-[var(--palette-text-muted)]">Appversion, Windows, GPU/Whisper-status, säkra jobbstatusar och de senaste maskade systemloggarna. Ljud, slides och transkript ingår aldrig.</span>
            </span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => void previewDiagnostics()}>
            <Bug /> Förhandsvisa data
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportDiagnosticSnapshot()}>
              <Download /> Spara rapport
            </Button>
            <Button size="sm" disabled={!canSend || sending} onClick={() => void submit()}>
              {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
              {reportingEnabled() ? "Skicka rapport" : "Spara rapport"}
            </Button>
          </div>
        </div>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen} title="Diagnostik som delas" description="Granska den lokala, anonymiserade rapporten innan du skickar den.">
        <pre className="mt-4 max-h-80 overflow-auto rounded-md bg-[var(--palette-surface-muted)] p-3 text-xs leading-5 text-[var(--palette-text-muted)]">{preview}</pre>
      </Dialog>
    </Dialog>
  );
}

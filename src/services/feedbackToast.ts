import { toast as sonnerToast, type ExternalToast } from "sonner";
import { recordDiagnostic } from "./diagnostics";

function reportError(message: string | number, options?: ExternalToast) {
  const text = String(message);
  recordDiagnostic("app", text);
  return sonnerToast.error(text, {
    ...options,
    action: options?.action ?? {
      label: "Rapportera",
      onClick: () =>
        window.dispatchEvent(
          new CustomEvent("lectio:report-problem", { detail: text }),
        ),
    },
  });
}

/** A single error path: visible feedback, safe diagnostics, and a report action. */
export const toast = {
  success: sonnerToast.success,
  message: sonnerToast.message,
  warning: sonnerToast.warning,
  error: reportError,
};

import { toast as sonnerToast, type ExternalToast } from "sonner";

type NotificationLevel = "info" | "success" | "warning" | "error";

function notifyApp(level: NotificationLevel, title: string) {
  if (
    typeof window === "undefined" ||
    !["legacy", "next"].includes(
      document.documentElement.dataset.lectioFrontend ?? "",
    )
  )
    return false;
  window.dispatchEvent(
    new CustomEvent("lectio:notification", {
      detail: { level, title },
    }),
  );
  return true;
}

function reportError(message: string | number, options?: ExternalToast) {
  const text = String(message);
  void import("./diagnostics").then(({ recordDiagnostic }) =>
    recordDiagnostic("app", text),
  );
  if (notifyApp("error", text)) return;
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
  success: (message: string | number, options?: ExternalToast) => {
    if (notifyApp("success", String(message))) return;
    return sonnerToast.success(message, options);
  },
  message: (message: string | number, options?: ExternalToast) => {
    if (notifyApp("info", String(message))) return;
    return sonnerToast.message(message, options);
  },
  warning: (message: string | number, options?: ExternalToast) => {
    if (notifyApp("warning", String(message))) return;
    return sonnerToast.warning(message, options);
  },
  error: reportError,
};

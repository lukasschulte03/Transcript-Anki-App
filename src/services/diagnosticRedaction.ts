// Do not allow a path, token, email address, or pasted content to leave the app.
export function redactDiagnosticText(value: unknown) {
  return String(value ?? "")
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(
      /(?:api[_ -]?key|client[_ -]?secret|refresh[_ -]?token|access[_ -]?token|token|authorization|bearer|password|secret)["']?\s*[:=]\s*["']?[^\s,;}"']+/gi,
      "$1=[redacted]",
    )
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .slice(0, 800);
}

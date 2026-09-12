import type { ReactNode } from "react";

/** Test-only render fault used to prove that the global recovery UI works. */
export function StabilityErrorProbe({ children }: { children: ReactNode }) {
  if (
    import.meta.env.VITE_STABILITY_TEST === "true" &&
    sessionStorage.getItem("lectio-stability-force-render-error") === "1"
  ) {
    throw new Error("Avsiktligt stability-testfel");
  }
  return children;
}

import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { LectioClient } from "../application/lectioClient";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { StabilityErrorProbe } from "../components/StabilityErrorProbe";

export type LectioFrontend = ComponentType<{ client: LectioClient }>;

export function mountReactFrontend(
  root: HTMLElement,
  Frontend: LectioFrontend,
  client: LectioClient,
) {
  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <StabilityErrorProbe>
          <Frontend client={client} />
        </StabilityErrorProbe>
      </AppErrorBoundary>
    </StrictMode>,
  );
}

import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";

const FeedbackDialog = lazy(() =>
  import("./FeedbackDialog").then((module) => ({
    default: module.FeedbackDialog,
  })),
);

type State = { error: Error | null; feedbackOpen: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, feedbackOpen: false };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void import("../services/diagnostics").then(({ recordDiagnostic }) =>
      recordDiagnostic("React", `${error.message}\n${info.componentStack ?? ""}`),
    );
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        className="grid h-screen place-items-center p-6"
        style={{ backgroundColor: "#f8fafc", color: "#14283b" }}
      >
        <section
          className="w-full max-w-md rounded-xl border p-6 shadow-lg"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#d8e0e8",
            color: "#14283b",
          }}
        >
          <AlertTriangle className="size-6 text-[var(--palette-warning)]" />
          <h1 className="mt-4 text-lg font-semibold">Lectio stötte på ett problem</h1>
          <p
            className="mt-2 text-sm leading-6"
            style={{ color: "#526b80" }}
          >
            Ditt bibliotek ligger kvar lokalt. Ladda om appen eller skicka en
            anonymiserad felrapport så kan vi lösa problemet.
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => window.location.reload()}><RotateCcw /> Ladda om</Button>
            <Button variant="outline" onClick={() => this.setState({ feedbackOpen: true })}>Rapportera problem</Button>
          </div>
        </section>
        <Suspense fallback={null}>
          <FeedbackDialog open={this.state.feedbackOpen} onOpenChange={(feedbackOpen) => this.setState({ feedbackOpen })} initialError={this.state.error.message} />
        </Suspense>
      </main>
    );
  }
}

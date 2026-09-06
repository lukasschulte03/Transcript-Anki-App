import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { recordDiagnostic } from "../services/diagnostics";
import { Button } from "./ui/Button";
import { FeedbackDialog } from "./FeedbackDialog";

type State = { error: Error | null; feedbackOpen: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, feedbackOpen: false };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic("React", `${error.message}\n${info.componentStack ?? ""}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="ui-app-bg grid h-screen place-items-center p-6 text-[var(--palette-text)]">
        <section className="w-full max-w-md rounded-xl border border-[var(--palette-border)] bg-[var(--palette-surface)] p-6 shadow-lg">
          <AlertTriangle className="size-6 text-[var(--palette-warning)]" />
          <h1 className="mt-4 text-lg font-semibold">Lectio stötte på ett problem</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--palette-text-muted)]">Ditt bibliotek ligger kvar lokalt. Ladda om appen eller skicka en anonymiserad felrapport så kan vi lösa problemet.</p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => window.location.reload()}><RotateCcw /> Ladda om</Button>
            <Button variant="outline" onClick={() => this.setState({ feedbackOpen: true })}>Rapportera problem</Button>
          </div>
        </section>
        <FeedbackDialog open={this.state.feedbackOpen} onOpenChange={(feedbackOpen) => this.setState({ feedbackOpen })} initialError={this.state.error.message} />
      </main>
    );
  }
}

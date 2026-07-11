import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppException } from "../lib/crashReporting";
import { reportMonitoringEvent } from "../lib/monitoring";

type Props = {
  children: ReactNode;
  /** Short label for support, e.g. "Receipts" */
  scope?: string;
};

type State = { error: Error | null };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    captureAppException(error, { scope: this.props.scope ?? "route" });
    reportMonitoringEvent({
      category: "app",
      code: "route_error_boundary",
      meta: { scope: this.props.scope ?? "route" },
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <p className="text-lg font-black text-foreground">Something went wrong</p>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {this.props.scope ? `${this.props.scope} could not load.` : "This page could not load."} Try going back or
              restarting the app.
            </p>
            {this.state.error?.message ? (
              <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-left font-mono text-xs text-rose-800">
                {this.state.error.message}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-4 rounded-2xl bg-foreground px-5 py-2.5 text-sm font-black text-background"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

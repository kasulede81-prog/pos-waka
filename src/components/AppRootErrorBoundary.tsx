import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAppException } from "../lib/crashReporting";
import { resetWakaSiteDataAndReload } from "../lib/siteDataRecovery";

type Props = { children: ReactNode };
type State = { error: Error | null; resetting: boolean };

function siteHostLabel(): string {
  if (typeof window === "undefined") return "this site";
  return window.location.hostname || "this site";
}

/** Last-resort catch so a render crash never leaves a blank white screen on mobile web. */
export class AppRootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetting: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, resetting: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[waka] root render error", error, info.componentStack);
    captureAppException(error, {
      kind: "root_error_boundary",
      componentStack: info.componentStack?.slice(0, 500) ?? "",
    });
  }

  private handleReset = (): void => {
    this.setState({ resetting: true });
    void resetWakaSiteDataAndReload();
  };

  render(): ReactNode {
    if (this.state.error) {
      const host = siteHostLabel();
      const detail =
        import.meta.env.DEV && this.state.error.message
          ? this.state.error.message.slice(0, 160)
          : null;

      return (
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
            background: "#fffaf5",
            color: "#1c1917",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Waka POS could not load</p>
          <p style={{ marginTop: 12, fontSize: "0.9rem", color: "#57534e", maxWidth: 340 }}>
            Try refreshing the page. If this keeps happening, reset app data for <strong>{host}</strong> or open a
            private tab.
          </p>
          {detail ? (
            <p style={{ marginTop: 10, fontSize: "0.75rem", color: "#a8a29e", maxWidth: 340, wordBreak: "break-word" }}>
              {detail}
            </p>
          ) : null}
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10, width: "min(100%, 280px)" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: 48,
                padding: "12px 24px",
                borderRadius: 12,
                border: "none",
                background: "#ea580c",
                color: "#fff",
                fontWeight: 700,
                fontSize: "1rem",
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={this.state.resetting}
              onClick={this.handleReset}
              style={{
                minHeight: 48,
                padding: "12px 24px",
                borderRadius: 12,
                border: "1px solid #d6d3d1",
                background: "#fff",
                color: "#44403c",
                fontWeight: 700,
                fontSize: "0.95rem",
              }}
            >
              {this.state.resetting ? "Resetting…" : "Reset app data"}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

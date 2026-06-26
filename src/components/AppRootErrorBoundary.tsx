import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Last-resort catch so a render crash never leaves a blank white screen on mobile web. */
export class AppRootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[waka] root render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
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
          <p style={{ marginTop: 12, fontSize: "0.9rem", color: "#57534e", maxWidth: 320 }}>
            Try refreshing the page. If this keeps happening, clear site data for pos.waka.ug or use a private tab.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
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
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { failed: boolean };

/** Prevents a single Lottie accent from taking down the home dashboard. */
export class HomeTileLottieBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Illustrations + CSS motion remain visible without Lottie accents.
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; label: string; resetKey?: string };
type State = { error: Error | null };

/** Contains a render failure to the section it happened in instead of blanking the whole app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[CoroVision] ${this.props.label} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="cv-error-boundary" role="alert">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h2>{this.props.label} could not be displayed</h2>
      <p className="muted">Your data has not been changed. Try again, or open another section from the sidebar.</p>
      <details><summary>Technical details</summary><code>{this.state.error.message}</code></details>
      <div className="cv-error-actions">
        <button type="button" className="primary" onClick={() => this.setState({ error: null })}>Try again</button>
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    </div>;
  }
}

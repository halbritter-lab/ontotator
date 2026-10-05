import React from "react";

export interface CaseErrorBoundaryProps {
  children: React.ReactNode;
  onBackToDashboard: () => void;
  onReload?: () => void;
}

interface State {
  error: Error | null;
}

/** Keeps a rendering error in the case screen from blanking the whole application. */
export class CaseErrorBoundary extends React.Component<CaseErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Case screen crashed", error, info.componentStack);
  }

  private reset = (next: () => void) => {
    this.setState({ error: null });
    next();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 32, maxWidth: 640, margin: "40px auto" }}>
        <h2>Something went wrong while displaying this case.</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Changes that were already saved are kept on the server. Details: {this.state.error.message}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {this.props.onReload && (
            <button type="button" className="btn btn-primary" onClick={() => this.reset(this.props.onReload!)}>
              Reload case
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => this.reset(this.props.onBackToDashboard)}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}

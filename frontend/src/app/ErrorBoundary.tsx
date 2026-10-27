import React from "react";
import { Button } from "../ui/Button";

export interface CaseErrorBoundaryProps {
  children: React.ReactNode;
  onBackToDashboard: () => void;
  onReload?: () => void;
  backLabel?: string;
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
      <div role="alert" className="case-error">
        <h1>Something went wrong while displaying this text.</h1>
        <p className="case-error__detail">
          Changes that were already saved are kept on the server. Details: {this.state.error.message}
        </p>
        <div className="case-error__actions">
          {this.props.onReload && (
            <Button variant="primary" onClick={() => this.reset(this.props.onReload!)}>
              Reload case
            </Button>
          )}
          <Button onClick={() => this.reset(this.props.onBackToDashboard)}>
            {this.props.backLabel ?? "Back to dashboard"}
          </Button>
        </div>
      </div>
    );
  }
}

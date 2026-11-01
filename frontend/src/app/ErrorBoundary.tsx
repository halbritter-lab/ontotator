import React from "react";
import { Button } from "../ui/Button";
import { TechnicalReportDialog } from "../reports/TechnicalReportDialog";
import { REPORT_ENTRY_LABEL } from "../reports/technicalReport";

export interface CaseErrorBoundaryProps {
  children: React.ReactNode;
  onBackToDashboard: () => void;
  onReload?: () => void;
  backLabel?: string;
}

interface State {
  error: Error | null;
  /** The technical report dialog is open, with the error message as context. */
  reporting: boolean;
}

/** The error as the report carries it: its kind and message, never the component stack. */
export function crashMessage(error: Error): string {
  try {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${String(error.message ?? "")}`;
  } catch {
    return "Unknown error";
  }
}

/** Keeps a rendering error in the case screen from blanking the whole application. */
export class CaseErrorBoundary extends React.Component<CaseErrorBoundaryProps, State> {
  state: State = { error: null, reporting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Case screen crashed", error, info.componentStack);
  }

  private reset = (next: () => void) => {
    this.setState({ error: null, reporting: false });
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
          {/* Rendered here, not through the app's report host: it must work while the app is broken. */}
          <Button onClick={() => this.setState({ reporting: true })}>{REPORT_ENTRY_LABEL}</Button>
        </div>
        {this.state.reporting && <TechnicalReportDialog crashMessage={crashMessage(this.state.error)}
          onClose={() => this.setState({ reporting: false })} />}
      </div>
    );
  }
}

export interface ScreenErrorBoundaryProps {
  children: React.ReactNode;
  /** Leaves the broken screen; without it, the start page of the app (`#/`). */
  onHome?: () => void;
  /** A change (another screen) clears the crash, so the next screen renders again. */
  resetKey?: string;
}

const goHome = () => { window.location.hash = "#/"; };
const reloadPage = () => { window.location.reload(); };

/**
 * Catches a rendering error on any screen (My tasks, Documents, Administration…), so the app is never left
 * blank (issue 273). The editor keeps its own crash screen with "Reload case" inside this one.
 */
export class ScreenErrorBoundary extends React.Component<ScreenErrorBoundaryProps, State> {
  state: State = { error: null, reporting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Screen crashed", error, info.componentStack);
  }

  componentDidUpdate(previous: ScreenErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null, reporting: false });
  }

  private home = () => {
    this.setState({ error: null, reporting: false });
    (this.props.onHome ?? goHome)();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="case-error">
        <h1>Something went wrong while displaying this page.</h1>
        <p className="case-error__detail">
          Work that was already saved is kept on the server. Go to My tasks or reload the page.
          Details: {this.state.error.message}
        </p>
        <div className="case-error__actions">
          <Button variant="primary" onClick={reloadPage}>Reload page</Button>
          <Button onClick={this.home}>Go to My tasks</Button>
          {/* Rendered here, not through the app's report host: it must work while the app is broken. */}
          <Button onClick={() => this.setState({ reporting: true })}>{REPORT_ENTRY_LABEL}</Button>
        </div>
        {this.state.reporting && <TechnicalReportDialog crashMessage={crashMessage(this.state.error)}
          onClose={() => this.setState({ reporting: false })} />}
      </div>
    );
  }
}

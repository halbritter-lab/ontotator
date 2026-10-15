import React, { useEffect, useState } from "react";
import { App } from "../App";
import { api, AuthError, onSessionExpired, type CurrentUser } from "../api/client";
import { LoginScreen } from "./LoginScreen";

type GateState =
  | { kind: "checking" }
  | { kind: "anonymous"; notice?: string }
  | { kind: "ready"; user: CurrentUser };

const SESSION_ENDED = "Your session has ended. Please log in again.";

/**
 * The login gate: the editor is shown only with a session. `api.me()` decides
 * at start; an ended session (any 401 outside `/api/v1/auth/`) returns to the login.
 */
export const AuthGate: React.FC = () => {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let active = true;
    api.me().then(
      (user) => {
        if (active) setState({ kind: "ready", user });
      },
      (err: unknown) => {
        if (!active) return;
        // Without a session the login simply shows; anything else is worth saying.
        const notice = err instanceof AuthError || !(err instanceof Error)
          ? undefined
          : `Ontocurator could not check your session: ${err.message}`;
        setState({ kind: "anonymous", notice });
      },
    );
    const unsubscribe = onSessionExpired(() => {
      api.setCsrfToken(null);
      // Late answers after a logout are no news.
      setState((current) => (current.kind === "ready" ? { kind: "anonymous", notice: SESSION_ENDED } : current));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const logout = async () => {
    let notice: string | undefined;
    try {
      await api.logout();
    } catch (err: unknown) {
      // 401: the session had already ended. Otherwise it may still be open.
      if (!(err instanceof AuthError && err.status === 401)) {
        notice = `Logging out failed (${err instanceof Error ? err.message : String(err)}). Your session may still be open.`;
      }
    }
    setState({ kind: "anonymous", notice });
  };

  if (state.kind === "checking") {
    return (
      <main className="session-lost" aria-busy="true" aria-label="Checking your session">
        <div className="session-lost-card">
          <p className="session-lost-muted">Checking your session...</p>
        </div>
      </main>
    );
  }
  if (state.kind === "anonymous") {
    return <LoginScreen notice={state.notice} onLoggedIn={(user) => setState({ kind: "ready", user })} />;
  }
  return <App user={state.user} onLogout={() => { void logout(); }} />;
};

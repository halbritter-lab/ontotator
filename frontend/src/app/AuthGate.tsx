import React, { useEffect, useRef, useState } from "react";
import { App } from "../App";
import {
  api,
  AuthError,
  notifySessionRestored,
  onCsrfRejected,
  onSessionExpired,
  type CurrentUser,
} from "../api/client";
import { LoginScreen } from "./LoginScreen";

type GateState =
  | { kind: "checking" }
  | { kind: "anonymous"; notice?: string }
  | { kind: "ready"; user: CurrentUser; notice?: string }
  // The session ended while the editor was open: it stays mounted under a login dialog.
  | { kind: "expired"; user: CurrentUser };

const SESSION_ENDED = "Your session has ended. Please log in again.";

/**
 * The login gate: the editor is shown only with a session. `api.me()` decides at
 * start. An ended session (a 401 outside `/api/v1/auth/`) opens a login dialog over
 * the editor, so an open case and its unsaved edits survive: logging in again as the
 * same user saves them; another user gets a fresh editor. A stale CSRF token (another
 * tab logged in again) makes the gate ask the server who is logged in now.
 */
export const AuthGate: React.FC = () => {
  const [state, setStateValue] = useState<GateState>({ kind: "checking" });
  // Listeners and late answers must see the current state, not a stale closure.
  const stateRef = useRef<GateState>(state);
  const setState = (next: GateState) => {
    stateRef.current = next;
    setStateValue(next);
  };
  const recheckingRef = useRef(false);

  /** Take over a user with a valid session; the same user keeps the editor and retries its saves. */
  const adopt = (user: CurrentUser, previous: CurrentUser | null, noticeForAnother?: string) => {
    if (previous && user.username === previous.username) {
      setState({ kind: "ready", user });
      notifySessionRestored();
    } else {
      setState({ kind: "ready", user, notice: previous ? noticeForAnother : undefined });
    }
  };

  /** A write was refused for a stale CSRF token: ask who the browser's cookie belongs to now. */
  const recheck = async () => {
    const before = stateRef.current;
    if (before.kind !== "ready" || recheckingRef.current) return;
    recheckingRef.current = true;
    try {
      const user = await api.me();
      if (stateRef.current !== before) return;
      adopt(user, before.user, `You are now logged in as ${user.display_name} (from another tab).`);
    } catch (err: unknown) {
      if (stateRef.current === before && err instanceof AuthError && err.status === 401) {
        api.setCsrfToken(null);
        setState({ kind: "expired", user: before.user });
      }
    } finally {
      recheckingRef.current = false;
    }
  };
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;

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
    const stopExpired = onSessionExpired(() => {
      const current = stateRef.current;
      // Late answers after a logout or during the login dialog are no news.
      if (current.kind !== "ready") return;
      api.setCsrfToken(null);
      setState({ kind: "expired", user: current.user });
    });
    const stopCsrf = onCsrfRejected(() => {
      void recheckRef.current();
    });
    return () => {
      active = false;
      stopExpired();
      stopCsrf();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return <LoginScreen notice={state.notice} onLoggedIn={(user) => adopt(user, null)} />;
  }
  const { user } = state;
  return (
    <>
      <App
        key={user.username}
        user={user}
        onLogout={() => { void logout(); }}
        sessionNotice={state.kind === "ready" ? state.notice : undefined}
      />
      {state.kind === "expired" && (
        <LoginScreen overlay notice={SESSION_ENDED} onLoggedIn={(next) => adopt(next, user)} />
      )}
    </>
  );
};

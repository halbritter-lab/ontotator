import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
const PAGE_OUT_OF_DATE = "The page is out of date; reload it.";

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
    setNoticeDismissed(false);
  };
  const recheckingRef = useRef(false);
  const appShellRef = useRef<HTMLDivElement>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

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
    const refusedToken = api.getCsrfToken();
    try {
      const user = await api.me();
      if (stateRef.current !== before) return;
      if (user.username === before.user.username && user.csrf_token === refusedToken) {
        // The token was not stale, yet it was refused (e.g. a proxy drops the header):
        // retrying would only fail again, so ask for a reload instead.
        setState({ kind: "ready", user, notice: PAGE_OUT_OF_DATE });
        return;
      }
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
  // Behind the login dialog the editor is inert: no focus, clicks or keys reach it.
  // (Set through the DOM: React 18 has no typed `inert` prop.) The shell stays in the
  // tree in both states, so the editor is never remounted by this.
  useLayoutEffect(() => {
    appShellRef.current?.toggleAttribute("inert", state.kind === "expired");
  }, [state]);

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
  const notice = state.kind === "ready" && !noticeDismissed ? state.notice : undefined;
  return (
    <>
      <div ref={appShellRef} className="app-shell">
        <App key={user.username} user={user} onLogout={() => { void logout(); }} />
      </div>
      {notice && (
        <div role="status" className="notice notice-info session-notice">
          <span>{notice}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNoticeDismissed(true)} aria-label="Dismiss message">
            ✕
          </button>
        </div>
      )}
      {state.kind === "expired" && (
        <LoginScreen overlay notice={SESSION_ENDED} onLoggedIn={(next) => adopt(next, user)} />
      )}
    </>
  );
};

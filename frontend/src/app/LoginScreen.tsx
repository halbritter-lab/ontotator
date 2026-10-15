import React, { useEffect, useRef, useState } from "react";
import { api, AuthError, type CurrentUser } from "../api/client";

interface LoginScreenProps {
  /** Shown above the form, e.g. why the previous session ended. */
  notice?: string | null;
  /** A modal dialog over the still-open editor (after the session ended) instead of a page. */
  overlay?: boolean;
  onLoggedIn: (user: CurrentUser) => void;
}

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.");

/**
 * Login: username and password, or a setup/reset code from an administrator to
 * set a new password (index Q9). Both end logged in. A full page, or a modal
 * dialog over the editor when the session ended while it was open.
 */
export const LoginScreen: React.FC<LoginScreenProps> = ({ notice, overlay = false, onLoggedIn }) => {
  const [view, setView] = useState<"login" | "code">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const shownView = useRef(view);

  // A dialog takes the focus to its first field; switching views moves it to the new heading.
  useEffect(() => {
    if (overlay) firstFieldRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    headingRef.current?.focus();
  }, [view]);

  const switchTo = (next: "login" | "code") => {
    setView(next);
    setProblem(null);
    setInfo(null);
    setPassword("");
    setCode("");
    setNewPassword("");
    setRepeatPassword("");
  };

  const run = async (action: () => Promise<CurrentUser>, onError: (err: unknown) => void = (err) => setProblem(errorText(err))) => {
    setBusy(true);
    setProblem(null);
    setInfo(null);
    try {
      onLoggedIn(await action());
    } catch (err: unknown) {
      setBusy(false);
      onError(err);
    }
  };

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void run(() => api.login(username.trim(), password));
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (newPassword !== repeatPassword) {
      setProblem("The two passwords differ.");
      return;
    }
    void run(
      () => api.redeemCode(username.trim(), code.trim(), newPassword),
      (err) => {
        // The password is set; only the login after it failed (e.g. a lockout).
        if (err instanceof AuthError && err.status === 401) {
          switchTo("login");
          setInfo("Your password is set. Log in with it now.");
        } else {
          setProblem(errorText(err));
        }
      },
    );
  };

  const alert = problem && (
    <p role="alert" className="field-hint field-hint-error">
      {problem}
    </p>
  );

  const card = (
    <div className="session-lost-card login-card">
      {notice && (
        <p role="status" className="session-lost-muted">
          {notice}
        </p>
      )}
      {view === "login" ? (
        <form aria-labelledby="login-title" onSubmit={submitLogin} className="login-form">
          <h1 id="login-title" ref={headingRef} tabIndex={-1}>Log in to Ontocurator</h1>
          {info && <p role="status" className="field-hint">{info}</p>}
          <label htmlFor="login-username" className="form-label">Username</label>
          <input
            id="login-username"
            ref={firstFieldRef}
            className="form-control"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="login-password" className="form-label">Password</label>
          <input
            id="login-password"
            type="password"
            className="form-control"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {alert}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Log in
          </button>
          <button type="button" className="login-link" onClick={() => switchTo("code")}>
            I have a setup or reset code
          </button>
        </form>
      ) : (
        <form aria-labelledby="code-title" onSubmit={submitCode} className="login-form">
          <h1 id="code-title" ref={headingRef} tabIndex={-1}>Set your password</h1>
          <label htmlFor="code-username" className="form-label">Username</label>
          <input
            id="code-username"
            className="form-control"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="code-value" className="form-label">Setup or reset code</label>
          <input
            id="code-value"
            className="form-control"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <label htmlFor="code-new-password" className="form-label">New password</label>
          <input
            id="code-new-password"
            type="password"
            className="form-control"
            autoComplete="new-password"
            aria-describedby="code-new-password-hint"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <div id="code-new-password-hint" className="field-hint">At least 12 characters.</div>
          <label htmlFor="code-repeat-password" className="form-label">Repeat the new password</label>
          <input
            id="code-repeat-password"
            type="password"
            className="form-control"
            autoComplete="new-password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
          {alert}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Set password and log in
          </button>
          <button type="button" className="login-link" onClick={() => switchTo("login")}>
            Back to login
          </button>
        </form>
      )}
    </div>
  );

  if (overlay) {
    return (
      <div
        className="session-lost login-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby={view === "login" ? "login-title" : "code-title"}
      >
        {card}
      </div>
    );
  }
  return (
    <main className="session-lost" aria-label="Log in">
      {card}
    </main>
  );
};

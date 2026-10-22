import React, { useEffect, useRef, useState } from "react";
import { api, AuthError, type CurrentUser } from "../api/client";

import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { InlineMessage } from "../ui/InlineMessage";

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
    <InlineMessage tone="error">
      {problem}
    </InlineMessage>
  );

  const card = (
    <div className="session-lost-card login-card">
      {notice && (
        <InlineMessage tone="info">
          {notice}
        </InlineMessage>
      )}
      {view === "login" ? (
        <form aria-labelledby="login-title" onSubmit={submitLogin} className="login-form">
          <h1 id="login-title" ref={headingRef} tabIndex={-1}>Log in to Ontocurator</h1>
          {info && <InlineMessage tone="info">{info}</InlineMessage>}
          <TextInput
            id="login-username"
            label="Username"
            aria-label="Username"
            ref={firstFieldRef}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextInput
            id="login-password"
            label="Password"
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {alert}
          <Button type="submit" variant="primary" disabled={busy}>
            Log in
          </Button>
          <Button className="login-link" onClick={() => switchTo("code")}>
            I have a setup or reset code
          </Button>
        </form>
      ) : (
        <form aria-labelledby="code-title" onSubmit={submitCode} className="login-form">
          <h1 id="code-title" ref={headingRef} tabIndex={-1}>Set your password</h1>
          <TextInput
            id="code-username"
            label="Username"
            aria-label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextInput
            id="code-value"
            label="Setup or reset code"
            aria-label="Setup or reset code"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <TextInput
            id="code-new-password"
            label="New password"
            aria-label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters."
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <TextInput
            id="code-repeat-password"
            label="Repeat the new password"
            aria-label="Repeat the new password"
            type="password"
            autoComplete="new-password"
            required
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
          {alert}
          <Button type="submit" variant="primary" disabled={busy}>
            Set password and log in
          </Button>
          <Button className="login-link" onClick={() => switchTo("login")}>
            Back to login
          </Button>
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
        // Keys typed here must not reach the editor's window shortcuts behind the dialog.
        onKeyDown={(e) => e.stopPropagation()}
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

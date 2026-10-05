import React, { useState } from "react";
import { parseTokenInput, type SessionLostReason } from "../api/client";

interface SessionLostScreenProps {
  reason: SessionLostReason;
  /** Called with the access key (and optional package) from a pasted link. */
  onConnect: (token: string, packageId: string | null) => void;
}

/**
 * Full-page notice shown when the page's access key is no longer accepted,
 * typically because Ontocurator was restarted (each start creates a new key).
 */
export const SessionLostScreen: React.FC<SessionLostScreenProps> = ({ reason, onConnect }) => {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { token, packageId } = parseTokenInput(value);
    if (!token) {
      setProblem("This does not look like an Ontocurator link. Copy the whole link from the Ontocurator window.");
      return;
    }
    setProblem(null);
    onConnect(token, packageId);
  };

  return (
    <main className="session-lost" aria-label="Ontocurator needs to be reopened">
      <div className="session-lost-card">
        <h1>Please reopen Ontocurator</h1>
        <p>
          {reason === "invalid"
            ? "Ontocurator was restarted. "
            : "This page was opened without its access link. "}
          Please open it again by double-clicking <strong>ontocurator.exe</strong> (or reopen the link shown in
          the Ontocurator window).
        </p>
        <p className="session-lost-muted">
          Double-clicking again is safe: if Ontocurator is already running, it simply opens a fresh browser tab.
          Your saved work is not affected. You can close this tab afterwards.
        </p>
        <details className="session-lost-advanced">
          <summary>Advanced: paste link</summary>
          <form onSubmit={submit}>
            <label htmlFor="session-link-input">Link or access key</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="session-link-input"
                type="text"
                className="form-control"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="http://127.0.0.1:8000/#token=..."
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn btn-secondary" disabled={!value.trim()}>
                Connect
              </button>
            </div>
            {problem && <p className="field-hint field-hint-error">{problem}</p>}
          </form>
        </details>
      </div>
    </main>
  );
};

import React, { useState } from "react";
import { api, type LegacyConfigStatus, type LegacyImportResult } from "../api/client";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const yesNo = (value: boolean) => (value ? "Yes" : "No");

/** Plain-language summary of what was taken over. */
export function describeLegacyImport(result: LegacyImportResult): string {
  const imported = result.imported_ontologies ?? [];
  const skipped = result.skipped_ontologies ?? [];
  const parts: string[] = [];
  if (imported.length > 0) {
    parts.push(`${imported.length} ontology ${imported.length === 1 ? "file was" : "files were"} added`);
  }
  const later: string[] = [];
  if (result.port != null) later.push(`port ${result.port}`);
  if (result.auto_open_browser != null) {
    later.push(`opening the browser automatically: ${yesNo(result.auto_open_browser)}`);
  }
  let text = "Settings from the earlier installation were imported";
  text += parts.length > 0 ? `: ${parts.join(", ")}.` : ".";
  if (later.length > 0) text += ` The ${later.join(" and ")} will apply the next time Ontocurator starts.`;
  if (skipped.length > 0) {
    text += ` Skipped: ${skipped.map((s) => `${fileName(s.path)} (${s.reason})`).join(", ")}.`;
  }
  return text;
}

interface Props {
  status: LegacyConfigStatus;
  /** The notice is done (imported, ignored or deleted); optional message for the user. */
  onClosed: (message: string | null) => void;
  onImported: () => void;
  onError: (message: string) => void;
}

/**
 * Settings from an earlier per-user installation. Nothing is taken over unless
 * the person clicks "Import settings".
 */
export const LegacyConfigNotice: React.FC<Props> = ({ status, onClosed, onImported, onError }) => {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err: unknown) {
      onError(`${failure}: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const importSettings = () =>
    run(async () => {
      const result = await api.importLegacyConfig();
      onClosed(describeLegacyImport(result));
      onImported();
    }, "Could not import the old settings");

  const ignore = () =>
    run(async () => {
      await api.dismissLegacyConfig();
      onClosed(null);
    }, "Could not hide this notice");

  const openFolder = () =>
    run(async () => {
      await api.openLegacyConfigFolder();
    }, "Could not open the folder");

  const deleteFile = () => {
    setConfirmDelete(false);
    return run(async () => {
      const res = await api.deleteLegacyConfig();
      onClosed(`The old settings file ${res.deleted} was deleted.`);
    }, "Could not delete the old settings file");
  };

  const ontologies = status.ontologies ?? [];
  const restartNote = status.port != null || status.auto_open_browser != null;

  return (
    <>
      <section
        role="region"
        aria-label="Settings from an earlier installation"
        className="notice notice-info legacy-config-notice"
      >
        <div>
          <strong>Settings from an earlier Ontocurator installation were found</strong>
          <p>
            They are stored in <code>{status.path}</code>. Nothing has been taken over. You can import them into
            this copy or ignore them.
          </p>
          <ul>
            {ontologies.length > 0 && (
              <li>
                Ontology files:
                <ul>
                  {ontologies.map((o) => (
                    <li key={o.path}>
                      <code>{o.path}</code>
                      {o.status === "missing" && " – file not found, will be skipped"}
                      {o.status === "in_use" && " – already available here"}
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {status.port != null && <li>Port: {status.port}</li>}
            {status.auto_open_browser != null && (
              <li>Open the browser automatically on start: {yesNo(status.auto_open_browser)}</li>
            )}
          </ul>
          {restartNote && (
            <p className="field-hint">The port and browser setting take effect the next time Ontocurator starts.</p>
          )}
          <div className="legacy-config-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void importSettings()} disabled={busy}>
              Import settings
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void ignore()} disabled={busy}>
              Ignore
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openFolder()} disabled={busy}>
              Open folder
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete old settings…
            </button>
          </div>
        </div>
      </section>
      {confirmDelete && (
        <div className="modal-overlay">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-legacy-title" className="modal-content">
            <h2 id="delete-legacy-title" style={{ fontSize: "1.1rem", margin: "0 0 8px" }}>
              Delete old settings?
            </h2>
            <p style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>
              This deletes only this file: <code style={{ wordBreak: "break-all" }}>{status.path}</code>
              {" "}(and its folder, if it is then empty).
            </p>
            <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Your workspace, work packages, annotations and ontology files are not affected.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)} autoFocus>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void deleteFile()}>
                Delete file
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

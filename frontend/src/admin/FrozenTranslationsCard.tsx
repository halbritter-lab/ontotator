import { useState } from "react";
import { api, type ProjectSettings } from "../api/client";
import { formatDateTime } from "../app/labels";
import { Button, ConfirmDialog } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { SettingsCard } from "./SettingsCard";
import { auditActor } from "./UsersPage";

type Frozen = NonNullable<ProjectSettings["frozen_translations"]>;
type FrozenFile = Frozen["files"][number];

export interface FrozenTranslationsCardProps {
  frozen: Frozen | null | undefined;
  /** With both: a lead can move the project to the newest translations. */
  projectKey?: string;
  onRefreshed?: (settings: ProjectSettings) => void;
}

const fileList = (files: FrozenFile[], label: string) =>
  <ul aria-label={label} className="settings-card-list">{files.map(file => <li key={`${file.ontology_id}-${file.sha256}`}>
    {file.filename} ({file.languages.join(", ")}), {file.ontology_id}: <code title={file.sha256}>{file.sha256.slice(0, 12)}</code>
  </li>)}</ul>;

/**
 * Settings › Ontology: the translations the project froze at the first use of its ontology (issue 254).
 * A later upload does not reach the project until a lead uses the newest translations; earlier states stay listed.
 */
export function FrozenTranslationsCard({ frozen, projectKey, onRefreshed }: FrozenTranslationsCardProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const why = "Searches keep the translations of their first use, so results stay comparable. A later upload reaches the project only when a lead uses the newest translations.";
  if (!frozen) {
    return <SettingsCard title="Translations" hint="Not frozen yet." why={why}>
      <p className="settings-card-text">The first term search or opening a text in the editor takes the translation files on the server then.</p>
    </SettingsCard>;
  }
  const notIncluded = frozen.not_included ?? [];
  const history = frozen.history ?? [];
  const frozenNames = new Set(frozen.files.map(file => file.filename));
  const replaced = notIncluded.filter(name => frozenNames.has(name));
  const added = notIncluded.filter(name => !frozenNames.has(name));
  const canRefresh = projectKey !== undefined && onRefreshed !== undefined && notIncluded.length > 0;
  const refresh = async () => {
    if (projectKey === undefined || busy) return;
    setBusy(true); setError(undefined);
    try {
      const settings = await api.refreshTranslations(projectKey);
      setConfirming(false);
      onRefreshed?.(settings);
    } catch (failure: unknown) { setError(failure); }
    finally { setBusy(false); }
  };
  const updated = frozen.updated;
  return <SettingsCard title="Translations" hint={updated ? "Updated to the newest translations." : "Frozen at the first use of the ontology."} why={why}>
    {frozen.files.length
      ? fileList(frozen.files, "Frozen translations")
      : <p className="settings-card-text">No translations: searches use the English names only.</p>}
    {updated && <p className="settings-card-text">Translations updated on <time dateTime={updated.at}>{formatDateTime(updated.at)}</time> by {auditActor(updated.by)}.</p>}
    {notIncluded.length > 0 && <p className="settings-card-text">Uploaded later, not used here: {notIncluded.join(", ")}.</p>}
    {canRefresh && <div className="settings-section-actions">
      <Button onClick={() => { setError(undefined); setConfirming(true); }}>Use the newest translations</Button>
    </div>}
    {history.length > 0 && <details className="settings-advanced"><summary>Earlier translations ({history.length})</summary>
      <ul aria-label="Earlier translations" className="settings-card-list">{history.map(item => <li key={`${item.until}-${item.condition_ids.join("-")}`}>
        Until <time dateTime={item.until}>{formatDateTime(item.until)}</time> ({item.reason === "refresh" ? `updated by ${auditActor(item.by)}` : `ontology changed by ${auditActor(item.by)}`}): {item.files.length ? item.files.map(file => file.filename).join(", ") : "English names only"}
      </li>)}</ul>
    </details>}
    <ConfirmDialog open={confirming} title="Use the newest translations?" confirmLabel="Use the newest translations" busy={busy}
      onCancel={() => { setConfirming(false); setError(undefined); }} onConfirm={() => { void refresh(); }} message={<>
        <p>Term searches in this project will use these files from now on:</p>
        <ul aria-label="Translation changes">
          {added.map(name => <li key={`added-${name}`}>Added: {name}</li>)}
          {replaced.map(name => <li key={`replaced-${name}`}>Replaced by a newer file: {name}</li>)}
        </ul>
        <p>Findings do not change: they store the term IDs, for example HPO IDs. Earlier searches keep the record of the translations they used. This also works while work is open or submitted.</p>
        {error !== undefined && <ErrorNotice error={error} />}
      </>} />
  </SettingsCard>;
}

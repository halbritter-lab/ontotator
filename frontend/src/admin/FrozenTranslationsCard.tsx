import type { ProjectSettings } from "../api/client";
import { SettingsCard } from "./SettingsCard";

type Frozen = NonNullable<ProjectSettings["frozen_translations"]>;

/**
 * Settings › Ontology: the translations the project froze at the first use of its ontology (#254).
 * Read-only: a later upload does not reach the project, and nothing here changes that.
 */
export function FrozenTranslationsCard({ frozen }: { frozen: Frozen | null | undefined }): JSX.Element {
  const why = "Searches keep the translations of their first use, so results stay comparable. A later upload does not reach the project.";
  if (!frozen) {
    return <SettingsCard title="Translations" hint="Not frozen yet." why={why}>
      <p className="settings-card-text">The first term search or opening the ontology information takes the translation files on the server then.</p>
    </SettingsCard>;
  }
  const notIncluded = frozen.not_included ?? [];
  return <SettingsCard title="Translations" hint="Frozen at the first use of the ontology." why={why}>
    {frozen.files.length
      ? <ul aria-label="Frozen translations" className="settings-card-list">{frozen.files.map(file => <li key={`${file.ontology_id}-${file.sha256}`}>
        {file.filename} ({file.languages.join(", ")}), {file.ontology_id}: <code title={file.sha256}>{file.sha256.slice(0, 12)}</code>
      </li>)}</ul>
      : <p className="settings-card-text">No translations: searches use the English names only.</p>}
    {notIncluded.length > 0 && <p className="settings-card-text">Uploaded later, not used here: {notIncluded.join(", ")}.</p>}
  </SettingsCard>;
}

import { useEffect, useRef, useState } from "react";
import { api, type Preferences } from "../api/client";
import { Button, Checkbox, InlineMessage } from "../ui";
import { LanguagesField } from "../admin/LanguagesField";
import { ErrorNotice } from "../admin/ErrorNotice";

type SearchPreferences = NonNullable<Preferences["multilingual_search"]>;
export function SearchPreferencesSection({ pseudonym, onDirty }: { pseudonym: string; onDirty: (dirty: boolean) => void }): JSX.Element {
  const [draft, setDraft] = useState<SearchPreferences>();
  const [baseline, setBaseline] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current += 1;
    setDraft(undefined); setSaved(false); setBusy(false);
    setError(undefined);
    api.getPreferences().then(prefs => {
      if (!active) return;
      const legacy = prefs.search_languages_by_annotator?.[pseudonym];
      const value = prefs.multilingual_search ?? { enabled: true, preferred_languages: legacy ?? [], automatic_document_language: legacy === undefined };
      setDraft(value); setBaseline(JSON.stringify(value));
    }).catch(err => { if (active) setError(err); });
    return () => { active = false; generation.current += 1; };
  }, [pseudonym, retry]);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const edit = (change: Partial<SearchPreferences>) => { setDraft(value => value && { ...value, ...change }); setSaved(false); };
  const save = async () => {
    if (!draft || busy) return;
    const requestGeneration = generation.current;
    setBusy(true); setSaved(false); setError(undefined);
    try {
      await api.updatePreferences({ multilingual_search: draft });
      if (requestGeneration === generation.current) { setBaseline(JSON.stringify(draft)); setSaved(true); }
    } catch (err) { if (requestGeneration === generation.current) setError(err); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  };
  return <section className="detail-section"><h2>Search preferences</h2>
    <p>English names are always searched. These defaults apply across texts. Language switches in the editor are temporary. Only translations available for the pinned ontology can be searched.</p>
    {error != null && <><ErrorNotice error={error} />{!draft && <Button onClick={() => setRetry(value => value + 1)}>Retry search preferences</Button>}</>}
    {draft && <form aria-label="Search preferences" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Checkbox id="search-multilingual" label="Search translated names" checked={draft.enabled ?? true} disabled={busy} onChange={event => edit({ enabled: event.target.checked })} />
      <LanguagesField id="search-preferred-languages" label="Preferred search languages" value={draft.preferred_languages ?? []} disabled={busy} onChange={preferred_languages => edit({ preferred_languages })} />
      <Checkbox id="search-auto-language" label="Automatically include the document language" checked={draft.automatic_document_language ?? true} disabled={busy} onChange={event => edit({ automatic_document_language: event.target.checked })} />
      {dirty && <p role="status">Unsaved search preferences</p>}{saved && <InlineMessage tone="success">Search preferences saved.</InlineMessage>}
      <Button type="submit" loading={busy}>Save search preferences</Button>
    </form>}
  </section>;
}

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorNotice } from "./ErrorNotice";
import { Button, Checkbox, InlineMessage } from "../ui";

/** Administration › Server settings: server-wide settings. Today: Practice projects (issue 266). */
export function SettingsPage(): JSX.Element {
  const [offer, setOffer] = useState<{ saved: boolean; draft: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    api.adminPracticeSettings().then(value => { if (active) setOffer({ saved: value.offer, draft: value.offer }); },
      failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [retry]);
  const save = async () => {
    if (!offer) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const value = await api.adminSetPracticeSettings(offer.draft);
      setOffer({ saved: value.offer, draft: value.offer }); setSaved(true);
    } catch (failure) { setError(failure); } finally { setBusy(false); }
  };
  return <div className="density-compact">
    <h1>Server settings</h1>
    <section className="detail-section" aria-labelledby="settings-practice">
      <h2 id="settings-practice">Practice projects</h2>
      <p>Annotators and translation reviewers can try the work in a private practice project with invented texts. Nothing done there counts. A practice project is deleted after 30 days without activity.</p>
      {!offer && !error && <InlineMessage tone="info">Loading settings…</InlineMessage>}
      {error != null && <><ErrorNotice error={error} />{!offer && <Button onClick={() => setRetry(value => value + 1)}>Retry</Button>}</>}
      {offer && <form aria-label="Practice projects" onSubmit={event => { event.preventDefault(); void save(); }}>
        <Checkbox id="settings-practice-offer" label="Offer practice projects to annotators and translation reviewers" checked={offer.draft} disabled={busy}
          hint="Off hides the card on My tasks and the start in Profile. Existing practice projects stay until they are deleted or expire."
          onChange={event => { setSaved(false); setOffer({ ...offer, draft: event.target.checked }); }} />
        {saved && <InlineMessage tone="success">Saved.</InlineMessage>}
        <Button type="submit" variant="primary" loading={busy} disabled={busy || offer.draft === offer.saved}>Save changes</Button>
      </form>}
    </section>
  </div>;
}

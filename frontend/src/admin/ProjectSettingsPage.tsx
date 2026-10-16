import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type CurrentUser, type OntologyInfo, type ProjectSettings } from "../api/client";
import { Button, Checkbox, InlineMessage, Textarea, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { HiddenAxisValuesField } from "./HiddenAxisValuesField";
import { LanguagesField } from "./LanguagesField";
import { MembersSection } from "./MembersSection";
import { draftPins, PinFields, ProfileUpload, serializePins, type UploadedProfile } from "./projectFields";
export interface ProjectSettingsPageProps { projectKey: string; currentUser: CurrentUser; onSaved?: (settings: ProjectSettings) => void }

export function ProjectSettingsPage(props: ProjectSettingsPageProps): JSX.Element {
  const [loaded, setLoaded] = useState<{ key: string; settings: ProjectSettings; ontologies: OntologyInfo[] } | null>(null);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(null); setError(undefined);
    void Promise.all([api.getProjectSettings(props.projectKey), api.listOntologies()]).then(([settings, ontologies]) => {
      if (active) setLoaded({ key: props.projectKey, settings, ontologies });
    }).catch((failure: unknown) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [props.projectKey, retry]);
  return <section><h1>Project settings</h1>
    {error !== undefined ? <><ErrorNotice error={error} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></> : loaded?.key === props.projectKey ?
      <SettingsEditor key={`${props.projectKey}-${retry}`} {...props} initial={loaded.settings} ontologies={loaded.ontologies} /> : <InlineMessage tone="info">Loading project settings…</InlineMessage>}
  </section>;
}

type Section = "General" | "Guideline" | "Rules" | "Pins" | "Profile";
const generalOf = (settings: ProjectSettings) => ({ name: settings.name, description: settings.description ?? "", languages: settings.languages ?? [] });
const guidelineOf = (settings: ProjectSettings) => ({ url: settings.guideline_url ?? "", version: settings.guideline_version ?? "" });
const rulesOf = (settings: ProjectSettings) => ({ require_chosen_axes: settings.require_chosen_axes, adjudicator_not_annotator: settings.adjudicator_not_annotator, contiguous_mentions_only: settings.contiguous_mentions_only, annotate_accepted_translations_only: settings.annotate_accepted_translations_only, hidden_axis_values: settings.hidden_axis_values ?? {} });

function SettingsEditor({ initial, ontologies, projectKey, currentUser, onSaved }: ProjectSettingsPageProps & { initial: ProjectSettings; ontologies: OntologyInfo[] }): JSX.Element {
  const [model, setModel] = useState(initial);
  const [general, setGeneral] = useState(() => generalOf(initial));
  const [guideline, setGuideline] = useState(() => guidelineOf(initial));
  const [rules, setRules] = useState(() => rulesOf(initial));
  const [pins, setPins] = useState(() => draftPins(initial.pins));
  const [uploaded, setUploaded] = useState<UploadedProfile | null>(null);
  const [profileGeneration, setProfileGeneration] = useState(0);
  const [busy, setBusy] = useState<Section | null>(null);
  const [error, setError] = useState<{ section: Section; error: unknown } | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const active = useRef(false);
  const writing = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const save = async (section: Section, work: () => Promise<ProjectSettings>) => {
    if (writing.current) return;
    writing.current = true; setBusy(section); setError(null); setSaved(null);
    try {
      const response = await work();
      if (!active.current) return;
      setModel(response);
      // Adopt only this section's returned values. Other sections may contain
      // unsaved edits and must not be reset by an unrelated section's save.
      if (section === "General") setGeneral(generalOf(response));
      if (section === "Guideline") setGuideline(guidelineOf(response));
      if (section === "Rules") setRules(rulesOf(response));
      if (section === "Pins") setPins(current => current === pins ? draftPins(response.pins) : current);
      if (section === "Profile") { setUploaded(null); setProfileGeneration(value => value + 1); }
      setSaved(section); onSaved?.(response);
    } catch (failure: unknown) { if (active.current) setError({ section, error: failure }); }
    finally { if (active.current) { writing.current = false; setBusy(null); } }
  };
  const submit = (event: FormEvent<HTMLFormElement>, section: Section, work: () => Promise<ProjectSettings>) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) void save(section, work);
  };
  const feedback = (section: Section) => <>{error?.section === section && <ErrorNotice error={error.error} />}{saved === section && <InlineMessage tone="success">{section} saved.</InlineMessage>}</>;
  const ids = model.profile.ontologies.map(item => item.ontology_id);
  return <>
    <p>{model.name} ({model.project_key})</p>
    <form aria-label="General" onSubmit={event => submit(event, "General", () => api.updateProjectSettings(projectKey, { name: general.name, description: general.description.trim() ? general.description : null, languages: general.languages }))}>
      <fieldset disabled={busy !== null}><legend>General</legend>
        <TextInput id="project-name" label="Name" required value={general.name} onChange={event => { setGeneral({ ...general, name: event.target.value }); setSaved(null); }} />
        <Textarea id="project-description" label="Description" value={general.description} onChange={event => { setGeneral({ ...general, description: event.target.value }); setSaved(null); }} />
        <LanguagesField id="project-languages" label="Document languages" value={general.languages} onChange={languages => { setGeneral({ ...general, languages }); setSaved(null); }} disabled={busy !== null} />
        <Button type="submit" loading={busy === "General"}>Save general</Button>
      </fieldset>{feedback("General")}
    </form>
    <form aria-label="Guideline" onSubmit={event => submit(event, "Guideline", () => api.updateProjectSettings(projectKey, { guideline_url: guideline.url.trim() || null, guideline_version: guideline.version.trim() || null }))}>
      <fieldset disabled={busy !== null}><legend>Guideline</legend>
        <TextInput id="project-guideline-url" label="Guideline URL" type="url" value={guideline.url} hint="Exported with every annotation set as url@version." onChange={event => { setGuideline({ ...guideline, url: event.target.value }); setSaved(null); }} />
        <TextInput id="project-guideline-version" label="Guideline version" value={guideline.version} onChange={event => { setGuideline({ ...guideline, version: event.target.value }); setSaved(null); }} />
        <Button type="submit" loading={busy === "Guideline"}>Save guideline</Button>
      </fieldset>{feedback("Guideline")}
    </form>
    <form aria-label="Rules" onSubmit={event => submit(event, "Rules", () => api.updateProjectSettings(projectKey, rules))}>
      <fieldset disabled={busy !== null}><legend>Rules</legend>
        <Checkbox id="project-rule-chosen" label="Every axis must be chosen before submission" checked={rules.require_chosen_axes} onChange={event => { setRules({ ...rules, require_chosen_axes: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-adjudicator" label="The adjudicator of a document may not be one of its annotators" checked={rules.adjudicator_not_annotator} onChange={event => { setRules({ ...rules, adjudicator_not_annotator: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-contiguous" label="Only contiguous mentions" checked={rules.contiguous_mentions_only} onChange={event => { setRules({ ...rules, contiguous_mentions_only: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-translations" label="Annotate translations only after an accepted review" checked={rules.annotate_accepted_translations_only} onChange={event => { setRules({ ...rules, annotate_accepted_translations_only: event.target.checked }); setSaved(null); }} />
        <HiddenAxisValuesField profile={model.profile} axisDefaults={model.axis_defaults} value={rules.hidden_axis_values} onChange={hidden_axis_values => { setRules({ ...rules, hidden_axis_values }); setSaved(null); }} disabled={busy !== null} />
        <Button type="submit" loading={busy === "Rules"}>Save rules</Button>
        <Button variant="quiet" onClick={() => { setRules(rulesOf(model)); setSaved(null); if (error?.section === "Rules") setError(null); }}>Discard rule changes</Button>
      </fieldset>{feedback("Rules")}
    </form>
    <section aria-label="Ontology and profile"><h2>Ontology and profile</h2>
      <ul aria-label="Current profile layers">{model.profile.layers.map(layer => <li key={layer.layer_id}>{layer.label} ({layer.layer_id})</li>)}</ul>
      {model.locked ? <>
        <InlineMessage tone="info">Locked because work has been submitted. Start a new project for another ontology version.</InlineMessage>
        <ul>{model.pins.map(pin => <li key={pin.ontology_id}>{pin.ontology_id} {pin.release}: <code>{pin.sha256}</code>; roots: {(pin.allowed_roots ?? []).join(", ") || "All"}; T1 profile: {pin.t1_profile}</li>)}</ul>
      </> : <>
        <form aria-label="Ontology pins" onSubmit={event => submit(event, "Pins", () => api.updatePins(projectKey, serializePins(ids, pins)))}>
          <fieldset disabled={busy !== null}><legend>Ontology pins</legend>
            <PinFields ids={ids} ontologies={ontologies} value={pins} onChange={value => { setPins(value); setSaved(null); }} disabled={busy !== null} />
            <Button type="submit" loading={busy === "Pins"}>Save pins</Button>
          </fieldset>{feedback("Pins")}
        </form>
        <form aria-label="Task profile" onSubmit={event => { event.preventDefault(); if (uploaded && event.currentTarget.reportValidity()) void save("Profile", () => api.updateProjectProfile(projectKey, uploaded.profile)); }}>
          <fieldset disabled={busy !== null}><legend>Task profile</legend>
            <ProfileUpload key={profileGeneration} onChange={setUploaded} disabled={busy !== null} />
            <Button type="submit" disabled={!uploaded} loading={busy === "Profile"}>Save profile</Button>
          </fieldset>{feedback("Profile")}
        </form>
      </>}
    </section>
    <MembersSection projectKey={projectKey} isSystemAdmin={currentUser.is_system_admin} />
  </>;
}

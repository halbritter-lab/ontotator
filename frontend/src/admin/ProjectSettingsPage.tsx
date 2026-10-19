import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type CurrentUser, type OntologyInfo, type ProjectSettings } from "../api/client";
import { Button, Checkbox, InlineMessage, Select, Textarea, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { HiddenAxisValuesField } from "./HiddenAxisValuesField";
import { LanguagesField } from "./LanguagesField";
import { MembersSection } from "./MembersSection";
import { draftPins, PinFields, ProfileUpload, serializePins, type UploadedProfile } from "./projectFields";
import { axisOptionLabel } from "../editor/axisLabels";
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

type Section = "General" | "Guideline" | "Rules" | "Pins" | "Profile" | "Creation defaults";
const generalOf = (settings: ProjectSettings) => ({ name: settings.name, description: settings.description ?? "", languages: settings.languages ?? [] });
const guidelineOf = (settings: ProjectSettings) => ({ url: settings.guideline_url ?? "", version: settings.guideline_version ?? "" });
const rulesOf = (settings: ProjectSettings) => ({ allow_spanless_findings: settings.allow_spanless_findings ?? true, require_spanless_note: settings.require_spanless_note ?? true, require_chosen_axes: settings.require_chosen_axes, adjudicator_not_annotator: settings.adjudicator_not_annotator, contiguous_mentions_only: settings.contiguous_mentions_only, annotate_accepted_translations_only: settings.annotate_accepted_translations_only, hidden_axis_values: settings.hidden_axis_values ?? {} });

function SettingsEditor({ initial, ontologies, projectKey, currentUser, onSaved }: ProjectSettingsPageProps & { initial: ProjectSettings; ontologies: OntologyInfo[] }): JSX.Element {
  const [model, setModel] = useState(initial);
  const [general, setGeneral] = useState(() => generalOf(initial));
  const [guideline, setGuideline] = useState(() => guidelineOf(initial));
  const [rules, setRules] = useState(() => rulesOf(initial));
  const [creationDefaults, setCreationDefaults] = useState(initial.creation_defaults ?? {});
  const [pins, setPins] = useState(() => draftPins(initial.pins));
  const [uploaded, setUploaded] = useState<UploadedProfile | null>(null);
  const [profileGeneration, setProfileGeneration] = useState(0);
  const [busy, setBusy] = useState<Section | null>(null);
  const [error, setError] = useState<{ section: Section; error: unknown } | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const sectionTargets = useRef<Record<string, HTMLElement | null>>({});
  const target = (section: string) => (element: HTMLElement | null) => { sectionTargets.current[section] = element; };
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
      if (section === "Creation defaults") setCreationDefaults(response.creation_defaults ?? {});
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
  const dirty: Record<Section, boolean> = {
    General: JSON.stringify(general) !== JSON.stringify(generalOf(model)),
    Guideline: JSON.stringify(guideline) !== JSON.stringify(guidelineOf(model)),
    Rules: JSON.stringify(rules) !== JSON.stringify(rulesOf(model)),
    Pins: JSON.stringify(pins) !== JSON.stringify(draftPins(model.pins)),
    Profile: uploaded !== null,
    "Creation defaults": JSON.stringify(creationDefaults) !== JSON.stringify(model.creation_defaults ?? {}),
  };
  const feedback = (section: Section) => <>{error?.section === section && <ErrorNotice error={error.error} />}{saved === section && <InlineMessage tone="success">{section} saved.{dirty[section] ? " Newer changes remain unsaved." : ""}</InlineMessage>}{dirty[section] && <p role="status" className="field-hint">Unsaved changes in {section.toLowerCase()}.</p>}</>;
  const ids = model.profile.ontologies.map(item => item.ontology_id);
  return <div className="project-settings-sections">
    <p>{model.name} ({model.project_key})</p>
    <nav aria-label="Settings sections" className="settings-section-navigation">{["General", "Guideline", "Annotation rules", "Creation defaults", "Ontology and profile", "Members"].map(section => <Button key={section} variant="quiet" onClick={() => {
      const element = sectionTargets.current[section]; element?.scrollIntoView?.({ block: "start" }); element?.focus({ preventScroll: true });
    }}>{section}</Button>)}</nav>
    <form ref={target("General")} tabIndex={-1} aria-label="General" onSubmit={event => submit(event, "General", () => api.updateProjectSettings(projectKey, { name: general.name, description: general.description.trim() ? general.description : null, languages: general.languages }))}>
      <fieldset disabled={busy !== null}><legend>General</legend>
        <TextInput id="project-name" label="Name" required value={general.name} onChange={event => { setGeneral({ ...general, name: event.target.value }); setSaved(null); }} />
        <Textarea id="project-description" label="Description" value={general.description} onChange={event => { setGeneral({ ...general, description: event.target.value }); setSaved(null); }} />
        <LanguagesField id="project-languages" label="Document languages" value={general.languages} onChange={languages => { setGeneral({ ...general, languages }); setSaved(null); }} disabled={busy !== null} />
        <Button type="submit" loading={busy === "General"}>Save general</Button>
      </fieldset>{feedback("General")}
    </form>
    <form ref={target("Guideline")} tabIndex={-1} aria-label="Guideline" onSubmit={event => submit(event, "Guideline", () => api.updateProjectSettings(projectKey, { guideline_url: guideline.url.trim() || null, guideline_version: guideline.version.trim() || null }))}>
      <fieldset disabled={busy !== null}><legend>Guideline</legend>
        <TextInput id="project-guideline-url" label="Guideline URL" type="url" value={guideline.url} hint="Exported with every annotation set as url@version." onChange={event => { setGuideline({ ...guideline, url: event.target.value }); setSaved(null); }} />
        <TextInput id="project-guideline-version" label="Guideline version" value={guideline.version} onChange={event => { setGuideline({ ...guideline, version: event.target.value }); setSaved(null); }} />
        <Button type="submit" loading={busy === "Guideline"}>Save guideline</Button>
      </fieldset>{feedback("Guideline")}
    </form>
    <form ref={target("Annotation rules")} tabIndex={-1} aria-label="Rules" onSubmit={event => submit(event, "Rules", () => api.updateProjectSettings(projectKey, rules))}>
      <fieldset disabled={busy !== null}><legend>Rules</legend>
        <div className="settings-section-actions" role="group" aria-label="Rules save state">
          <Button type="submit" loading={busy === "Rules"}>Save rules</Button>
          <Button variant="quiet" onClick={() => { setRules(rulesOf(model)); setSaved(null); if (error?.section === "Rules") setError(null); }}>Discard rule changes</Button>
          {feedback("Rules")}
        </div>
        <Select id="project-rule-spanless" label="Findings without a text span" hint="Applies to every future submission; completed submissions are unchanged. Profile requirements for text evidence still apply."
          value={!rules.allow_spanless_findings ? "prohibited" : rules.require_spanless_note ? "required" : "optional"}
          onChange={event => { const mode = event.target.value; setRules({ ...rules, allow_spanless_findings: mode !== "prohibited", require_spanless_note: mode === "prohibited" ? rules.require_spanless_note : mode === "required" }); setSaved(null); }}>
          <option value="prohibited">Prohibited</option>
          <option value="required">Allowed with a required reason</option>
          <option value="optional">Allowed with an optional reason</option>
        </Select>
        <Checkbox id="project-rule-chosen" label="Every axis must be chosen before submission" hint="When off, unconfirmed axis values require a submission warning acknowledgement. Acknowledging a warning does not confirm clinical values." checked={rules.require_chosen_axes} onChange={event => { setRules({ ...rules, require_chosen_axes: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-adjudicator" label="The adjudicator of a document may not be one of its annotators" checked={rules.adjudicator_not_annotator} onChange={event => { setRules({ ...rules, adjudicator_not_annotator: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-contiguous" label="Only contiguous mentions" checked={rules.contiguous_mentions_only} onChange={event => { setRules({ ...rules, contiguous_mentions_only: event.target.checked }); setSaved(null); }} />
        <Checkbox id="project-rule-translations" label="Annotate translations only after an accepted review" checked={rules.annotate_accepted_translations_only} onChange={event => { setRules({ ...rules, annotate_accepted_translations_only: event.target.checked }); setSaved(null); }} />
        <details className="settings-secondary-rules"><summary>More rule settings: hidden axis values</summary><HiddenAxisValuesField profile={model.profile} axisDefaults={model.axis_defaults} value={rules.hidden_axis_values} onChange={hidden_axis_values => { setRules({ ...rules, hidden_axis_values }); setSaved(null); }} disabled={busy !== null} /></details>
      </fieldset>
    </form>
    <form ref={target("Creation defaults")} tabIndex={-1} aria-label="Creation defaults" onSubmit={event => submit(event, "Creation defaults", () => api.updateProjectSettings(projectKey, { creation_defaults: creationDefaults }))}>
      <fieldset disabled={busy !== null}><legend>Creation defaults</legend>
        <p>Prefill new findings with these values. Each preset stays unconfirmed until the annotator explicitly confirms or changes it. Existing findings, proposals and carried findings keep their recorded values.</p>
        {model.profile.layers.flatMap(layer => layer.annotation_types.flatMap(type => (type.axes ?? []).map(axis => {
          const current = creationDefaults[layer.layer_id]?.[type.type_id]?.[axis.id] ?? "";
          const options = axis.options.filter(option => !(model.hidden_axis_values?.[layer.layer_id]?.[axis.id] ?? []).includes(option));
          return <Select key={`${layer.layer_id}/${type.type_id}/${axis.id}`} id={`default-${layer.layer_id}-${type.type_id}-${axis.id}`}
            label={`Default ${axis.label} (${layer.label} / ${type.label})`} value={current}
            onChange={event => {
              const next = structuredClone(creationDefaults);
              const values = { ...next[layer.layer_id]?.[type.type_id] };
              if (event.target.value) values[axis.id] = event.target.value; else delete values[axis.id];
              next[layer.layer_id] = { ...next[layer.layer_id], [type.type_id]: values };
              if (!Object.keys(values).length) delete next[layer.layer_id][type.type_id];
              if (!Object.keys(next[layer.layer_id]).length) delete next[layer.layer_id];
              setCreationDefaults(next); setSaved(null);
            }}>
            <option value="">No preset</option>
            {current && !options.includes(current) && <option value={current} disabled>{axisOptionLabel(current)} (unavailable)</option>}
            {options.map(option => <option key={option} value={option}>{axisOptionLabel(option)}</option>)}
          </Select>;
        })))}
        {!model.profile.layers.some(layer => layer.annotation_types.some(type => type.axes?.length)) && <p>This profile has no axes to prefill.</p>}
        <Button type="submit" loading={busy === "Creation defaults"}>Save creation defaults</Button>
        <Button variant="quiet" onClick={() => { setCreationDefaults(model.creation_defaults ?? {}); setSaved(null); }}>Discard default changes</Button>
      </fieldset>{feedback("Creation defaults")}
    </form>
    <section ref={target("Ontology and profile")} tabIndex={-1} aria-label="Ontology and profile"><h2>Ontology and profile</h2>
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
    <div ref={target("Members")} tabIndex={-1}><MembersSection projectKey={projectKey} isSystemAdmin={currentUser.is_system_admin} /></div>
  </div>;
}

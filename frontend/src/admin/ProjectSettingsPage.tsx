import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type MutableRefObject } from "react";
import { api, type CurrentUser, type OntologyInfo, type ProjectSettings } from "../api/client";
import { routeHref, SETTINGS_SECTIONS, type Route, type RouteLeaveGuard, type SettingsSection } from "../app/router";
import { Button, Checkbox, Dialog, InlineMessage, Select, Textarea, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { HiddenAxisValuesField } from "./HiddenAxisValuesField";
import { LanguagesField } from "./LanguagesField";
import { MembersSection } from "./MembersSection";
import { draftPins, PinFields, ProfileUpload, serializePins, WorkflowFields, workflowOf, type UploadedProfile } from "./projectFields";
import { axisOptionLabel } from "../editor/axisLabels";
export interface ProjectSettingsPageProps {
  projectKey: string;
  currentUser: CurrentUser;
  onSaved?: (settings: ProjectSettings) => void;
  /** Section of the current address; absent means General. */
  section?: SettingsSection;
  onNavigate?: (route: Route) => void;
  routeLeaveRef?: MutableRefObject<RouteLeaveGuard | null>;
}

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

type Section = "General" | "Rules" | "Workflow" | "Pins" | "Profile" | "Creation defaults";
const SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General", guideline: "Guidelines", rules: "Annotation rules", workflow: "Workflow",
  defaults: "Creation defaults", profile: "Ontology and profile", members: "Members",
};
/** The saveable parts behind each address; Members saves its own rows directly. */
const SECTION_PARTS: Record<SettingsSection, readonly Section[]> = {
  general: ["General"], guideline: [], rules: ["Rules"], workflow: ["Workflow"],
  defaults: ["Creation defaults"], profile: ["Pins", "Profile"], members: [],
};
const settingsRoute = (key: string, section: SettingsSection): Route =>
  section === "general" ? { name: "projectSettings", key } : { name: "projectSettings", key, section };
const generalOf = (settings: ProjectSettings) => ({ name: settings.name, description: settings.description ?? "", languages: settings.languages ?? [] });
const rulesOf = (settings: ProjectSettings) => ({ allow_spanless_findings: settings.allow_spanless_findings ?? true, require_spanless_note: settings.require_spanless_note ?? true, require_chosen_axes: settings.require_chosen_axes, adjudicator_not_annotator: settings.adjudicator_not_annotator, contiguous_mentions_only: settings.contiguous_mentions_only, annotate_accepted_translations_only: settings.annotate_accepted_translations_only, hidden_axis_values: settings.hidden_axis_values ?? {} });

function SettingsEditor({ initial, ontologies, projectKey, currentUser, onSaved, section = "general", onNavigate, routeLeaveRef }: ProjectSettingsPageProps & { initial: ProjectSettings; ontologies: OntologyInfo[] }): JSX.Element {
  const [model, setModel] = useState(initial);
  const [general, setGeneral] = useState(() => generalOf(initial));
  const [rules, setRules] = useState(() => rulesOf(initial));
  const [workflow, setWorkflow] = useState(() => workflowOf(initial));
  const [creationDefaults, setCreationDefaults] = useState(initial.creation_defaults ?? {});
  const [pins, setPins] = useState(() => draftPins(initial.pins));
  const [uploaded, setUploaded] = useState<UploadedProfile | null>(null);
  const [profileGeneration, setProfileGeneration] = useState(0);
  const [busy, setBusy] = useState<Section | null>(null);
  const [error, setError] = useState<{ section: Section; error: unknown } | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [leaving, setLeaving] = useState<SettingsSection | null>(null);
  const [leaveInvalid, setLeaveInvalid] = useState(false);
  const pendingLeave = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const active = useRef(false);
  const writing = useRef(false);
  const sectionElement = useRef<HTMLElement | null>(null);
  const bindSection = (element: HTMLElement | null) => { sectionElement.current = element; };
  const shownSection = useRef(section);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    // A new address shows a new section: move focus there with normal scrolling.
    sectionElement.current?.focus();
  }, [section]);
  const save = async (part: Section, work: () => Promise<ProjectSettings>): Promise<boolean> => {
    if (writing.current) return false;
    writing.current = true; setBusy(part); setError(null); setSaved(null);
    try {
      const response = await work();
      if (!active.current) return false;
      setModel(response);
      // Adopt only this section's returned values. Other sections may contain
      // unsaved edits and must not be reset by an unrelated section's save.
      if (part === "General") setGeneral(generalOf(response));
      if (part === "Rules") setRules(rulesOf(response));
      if (part === "Workflow") setWorkflow(workflowOf(response));
      if (part === "Creation defaults") setCreationDefaults(response.creation_defaults ?? {});
      if (part === "Pins") setPins(current => current === pins ? draftPins(response.pins) : current);
      if (part === "Profile") { setUploaded(null); setProfileGeneration(value => value + 1); }
      setSaved(part); onSaved?.(response);
      return true;
    } catch (failure: unknown) { if (active.current) setError({ section: part, error: failure }); return false; }
    finally { if (active.current) { writing.current = false; setBusy(null); } }
  };
  const ids = model.profile.ontologies.map(item => item.ontology_id);
  const work: Record<Section, () => Promise<ProjectSettings>> = {
    General: () => api.updateProjectSettings(projectKey, { name: general.name, description: general.description.trim() ? general.description : null, languages: general.languages }),
    Rules: () => api.updateProjectSettings(projectKey, rules),
    Workflow: () => api.updateProjectSettings(projectKey, { import_plan: workflow.import_plan, annotations_per_text: workflow.annotations_per_text }),
    "Creation defaults": () => api.updateProjectSettings(projectKey, { creation_defaults: creationDefaults }),
    Pins: () => api.updatePins(projectKey, serializePins(ids, pins)),
    Profile: () => api.updateProjectProfile(projectKey, uploaded!.profile),
  };
  const submit = (event: FormEvent<HTMLFormElement>, part: Section) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) void save(part, work[part]);
  };
  const dirty: Record<Section, boolean> = {
    General: JSON.stringify(general) !== JSON.stringify(generalOf(model)),
    Rules: JSON.stringify(rules) !== JSON.stringify(rulesOf(model)),
    Workflow: JSON.stringify(workflow) !== JSON.stringify(workflowOf(model)),
    Pins: !model.locked && JSON.stringify(pins) !== JSON.stringify(draftPins(model.pins)),
    Profile: !model.locked && uploaded !== null,
    "Creation defaults": JSON.stringify(creationDefaults) !== JSON.stringify(model.creation_defaults ?? {}),
  };
  const dirtyParts = (target: SettingsSection) => SECTION_PARTS[target].filter(part => dirty[part]);
  const sectionDirty = dirtyParts(section).length > 0;

  // Leave guard: only while the shown section has unsaved edits.
  useEffect(() => {
    if (!routeLeaveRef || !sectionDirty) return;
    const guard: RouteLeaveGuard = () => {
      if (pendingLeave.current) return pendingLeave.current.promise;
      let resolve!: (allowed: boolean) => void;
      const promise = new Promise<boolean>(done => { resolve = done; });
      pendingLeave.current = { promise, resolve };
      setLeaveInvalid(false); setLeaving(section);
      return promise;
    };
    routeLeaveRef.current = guard;
    return () => { if (routeLeaveRef.current === guard) routeLeaveRef.current = null; };
  }, [routeLeaveRef, sectionDirty, section]);
  useEffect(() => () => { pendingLeave.current?.resolve(false); pendingLeave.current = null; }, []);
  const closeLeave = (allowed: boolean) => {
    const request = pendingLeave.current; pendingLeave.current = null;
    setLeaving(null); setLeaveInvalid(false);
    request?.resolve(allowed);
  };
  const discard = (parts: readonly Section[]) => {
    for (const part of parts) {
      if (part === "General") setGeneral(generalOf(model));
      if (part === "Rules") setRules(rulesOf(model));
      if (part === "Workflow") setWorkflow(workflowOf(model));
      if (part === "Creation defaults") setCreationDefaults(model.creation_defaults ?? {});
      if (part === "Pins") setPins(draftPins(model.pins));
      if (part === "Profile") { setUploaded(null); setProfileGeneration(value => value + 1); }
    }
    setSaved(null);
    if (error && parts.includes(error.section)) setError(null);
  };
  const leaveParts = leaving ? dirtyParts(leaving) : [];
  const saveAndLeave = async () => {
    const element = sectionElement.current;
    const forms = element instanceof HTMLFormElement ? [element] : Array.from(element?.querySelectorAll("form") ?? []);
    if (forms.some(form => !form.checkValidity())) { setLeaveInvalid(true); return; }
    setLeaveInvalid(false);
    for (const part of leaveParts) {
      if (!await save(part, work[part])) return;
    }
    if (active.current) closeLeave(true);
  };

  const feedback = (part: Section) => <>{error?.section === part && <ErrorNotice error={error.error} />}{saved === part && <InlineMessage tone="success">{part} saved.{dirty[part] ? " Newer changes remain unsaved." : ""}</InlineMessage>}{dirty[part] && <p role="status" className="field-hint">Unsaved changes in {part.toLowerCase()}.</p>}</>;
  const navigateTo = (event: MouseEvent<HTMLAnchorElement>, destination: Route) => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(destination);
  };

  let content: JSX.Element;
  switch (section) {
    case "general": content = <form ref={bindSection} tabIndex={-1} aria-label="General" onSubmit={event => submit(event, "General")}>
      <fieldset disabled={busy !== null}><legend>General</legend>
        <TextInput id="project-name" label="Name" required value={general.name} onChange={event => { setGeneral({ ...general, name: event.target.value }); setSaved(null); }} />
        <Textarea id="project-description" label="Description" value={general.description} onChange={event => { setGeneral({ ...general, description: event.target.value }); setSaved(null); }} />
        <LanguagesField id="project-languages" label="Document languages" value={general.languages} onChange={languages => { setGeneral({ ...general, languages }); setSaved(null); }} disabled={busy !== null} />
        <Button type="submit" loading={busy === "General"}>Save general</Button>
      </fieldset>{feedback("General")}
    </form>; break;
    case "guideline": content = <section ref={bindSection} tabIndex={-1} aria-label="Guidelines"><h2>Guidelines</h2></section>; break;
    case "rules": content = <form ref={bindSection} tabIndex={-1} aria-label="Rules" onSubmit={event => submit(event, "Rules")}>
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
    </form>; break;
    case "workflow": content = <form ref={bindSection} tabIndex={-1} aria-label="Workflow" onSubmit={event => submit(event, "Workflow")}>
      <fieldset disabled={busy !== null}><legend>Workflow</legend>
        <WorkflowFields projectKey={projectKey} value={workflow} saved={workflowOf(model)} disabled={busy !== null} onChange={value => { setWorkflow(value); setSaved(null); }} />
        <Button type="submit" loading={busy === "Workflow"}>Save workflow</Button>
      </fieldset>{feedback("Workflow")}
    </form>; break;
    case "defaults": content = <form ref={bindSection} tabIndex={-1} aria-label="Creation defaults" onSubmit={event => submit(event, "Creation defaults")}>
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
    </form>; break;
    case "profile": content = <section ref={bindSection} tabIndex={-1} aria-label="Ontology and profile"><h2>Ontology and profile</h2>
      <ul aria-label="Current profile layers">{model.profile.layers.map(layer => <li key={layer.layer_id}>{layer.label} ({layer.layer_id})</li>)}</ul>
      {model.locked ? <>
        <InlineMessage tone="info">Locked because work has been submitted. Start a new project for another ontology version.</InlineMessage>
        <ul>{model.pins.map(pin => <li key={pin.ontology_id}>{pin.ontology_id} {pin.release}: <code>{pin.sha256}</code>; roots: {(pin.allowed_roots ?? []).join(", ") || "All"}; T1 profile: {pin.t1_profile}</li>)}</ul>
      </> : <>
        <form aria-label="Ontology pins" onSubmit={event => submit(event, "Pins")}>
          <fieldset disabled={busy !== null}><legend>Ontology pins</legend>
            <PinFields ids={ids} ontologies={ontologies} value={pins} onChange={value => { setPins(value); setSaved(null); }} disabled={busy !== null} />
            <Button type="submit" loading={busy === "Pins"}>Save pins</Button>
          </fieldset>{feedback("Pins")}
        </form>
        <form aria-label="Task profile" onSubmit={event => { event.preventDefault(); if (uploaded && event.currentTarget.reportValidity()) void save("Profile", work.Profile); }}>
          <fieldset disabled={busy !== null}><legend>Task profile</legend>
            <ProfileUpload key={profileGeneration} onChange={setUploaded} disabled={busy !== null} />
            <Button type="submit" disabled={!uploaded} loading={busy === "Profile"}>Save profile</Button>
          </fieldset>{feedback("Profile")}
        </form>
      </>}
    </section>; break;
    case "members": content = <div ref={bindSection} tabIndex={-1}><MembersSection projectKey={projectKey} isSystemAdmin={currentUser.is_system_admin} /></div>; break;
  }

  return <div className="project-settings-sections">
    <p>{model.name} ({model.project_key})</p>
    <nav aria-label="Settings sections" className="settings-tabs">{SETTINGS_SECTIONS.map(id => {
      const destination = settingsRoute(projectKey, id);
      return <a key={id} href={routeHref(destination)} className="settings-tab" aria-current={id === section ? "page" : undefined}
        onClick={event => navigateTo(event, destination)}>{SECTION_LABELS[id]}</a>;
    })}</nav>
    {content}
    <Dialog open={leaving !== null} title={leaving ? `Unsaved changes in ${SECTION_LABELS[leaving]}` : ""} size="sm"
      onClose={() => { if (busy === null) closeLeave(false); }}
      footer={<>
        <Button variant="primary" loading={busy !== null} onClick={() => { void saveAndLeave(); }}>{`Save ${leaveParts.map(part => part.toLowerCase()).join(" and ")}`}</Button>
        <Button disabled={busy !== null} onClick={() => { discard(leaveParts); closeLeave(true); }}>Discard</Button>
        <Button variant="quiet" disabled={busy !== null} onClick={() => closeLeave(false)}>Cancel</Button>
      </>}>
      <p>Save these changes before leaving, or discard them.</p>
      {leaveInvalid && <InlineMessage tone="error">Some fields need correcting. Choose Cancel to fix them.</InlineMessage>}
      {error && leaveParts.includes(error.section) && <ErrorNotice error={error.error} />}
    </Dialog>
  </div>;
}

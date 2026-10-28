import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type MutableRefObject } from "react";
import { api, type CurrentUser, type OntologyInfo, type ProjectPin, type ProjectSettings, type RepinReport } from "../api/client";
import { DEFAULT_SETTINGS_SECTION, routeHref, SETTINGS_SECTIONS, type Route, type RouteLeaveGuard, type SettingsSection } from "../app/router";
import { Button, Checkbox, Dialog, InlineMessage, Select, Textarea, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { GuidelinesSection } from "./GuidelinesSection";
import { hiddenCount, HiddenAxisValuesField } from "./HiddenAxisValuesField";
import { LanguagesField } from "./LanguagesField";
import { MembersSection } from "./MembersSection";
import { SettingsCard, SettingsHint } from "./SettingsCard";
import { draftPins, PinFields, ProfileUpload, ReleaseFields, serializePins, ANNOTATION_SCHEME_LABELS, WorkflowFields, workflowOf, type UploadedProfile } from "./projectFields";
import { RepinReportPanel } from "./RepinReport";
import { axisOptionLabel } from "../editor/axisLabels";
export interface ProjectSettingsPageProps {
  projectKey: string;
  currentUser: CurrentUser;
  onSaved?: (settings: ProjectSettings) => void;
  /** Section of the current address; absent means People. */
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
  // The editor names the page "{project} · Settings" once the project is known.
  return <section>
    {error !== undefined ? <><h1 className="settings-title">Project settings</h1><ErrorNotice error={error} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></> : loaded?.key === props.projectKey ?
      <SettingsEditor key={`${props.projectKey}-${retry}`} {...props} initial={loaded.settings} ontologies={loaded.ontologies} /> : <><h1 className="settings-title">Project settings</h1><InlineMessage tone="info">Loading project settings…</InlineMessage></>}
  </section>;
}

/** The saveable parts; Members and Guidelines save on their own. */
type Section = "General" | "Workflow" | "Annotation" | "Pins" | "Profile";
/** Six tabs by job and frequency (M2 M-8a, audit D1 B); People first and the default (D2 B). */
const SECTION_LABELS: Record<SettingsSection, string> = {
  people: "People", workflow: "Workflow", annotation: "Annotation", guidelines: "Guidelines", general: "General", ontology: "Ontology",
};
const SECTION_PARTS: Record<SettingsSection, readonly Section[]> = {
  people: [], workflow: ["Workflow"], annotation: ["Annotation"], guidelines: [], general: ["General"], ontology: ["Pins", "Profile"],
};
const PART_LABELS: Record<Section, string> = { General: "General", Workflow: "Workflow", Annotation: "Annotation", Pins: "Ontology version", Profile: "Task profile" };
/** A pin change waits for the lead to look at its check; not an error to show. */
class RepinPending extends Error {}
const settingsRoute = (key: string, section: SettingsSection): Route =>
  section === DEFAULT_SETTINGS_SECTION ? { name: "projectSettings", key } : { name: "projectSettings", key, section };
const generalOf = (settings: ProjectSettings) => ({ name: settings.name, description: settings.description ?? "", languages: settings.languages ?? [] });
/** Settings › Annotation (M-8c): submit rules, prefilled values and the values annotators can choose; one Save. */
const annotationOf = (settings: ProjectSettings) => ({ allow_spanless_findings: settings.allow_spanless_findings ?? true, require_spanless_note: settings.require_spanless_note ?? true, require_chosen_axes: settings.require_chosen_axes, contiguous_mentions_only: settings.contiguous_mentions_only, hidden_axis_values: settings.hidden_axis_values ?? {}, creation_defaults: settings.creation_defaults ?? {} });

function SettingsEditor({ initial, ontologies, projectKey, currentUser, onSaved, section = DEFAULT_SETTINGS_SECTION, onNavigate, routeLeaveRef }: ProjectSettingsPageProps & { initial: ProjectSettings; ontologies: OntologyInfo[] }): JSX.Element {
  const [model, setModel] = useState(initial);
  const [general, setGeneral] = useState(() => generalOf(initial));
  const [annotation, setAnnotation] = useState(() => annotationOf(initial));
  const [workflow, setWorkflow] = useState(() => workflowOf(initial));
  const [pins, setPins] = useState(() => draftPins(initial.pins));
  const [repin, setRepin] = useState<{ pins: ProjectPin[]; report: RepinReport } | null>(null);
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
    // A new address shows a new section: move focus there with normal scrolling (no focus ring on the container, P9).
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
      if (part === "Annotation") setAnnotation(annotationOf(response));
      if (part === "Workflow") setWorkflow(workflowOf(response));
      if (part === "Pins") setPins(current => current === pins ? draftPins(response.pins) : current);
      if (part === "Profile") { setUploaded(null); setProfileGeneration(value => value + 1); }
      setSaved(part); onSaved?.(response);
      return true;
    } catch (failure: unknown) { if (active.current && !(failure instanceof RepinPending)) setError({ section: part, error: failure }); return false; }
    finally { if (active.current) { writing.current = false; setBusy(null); } }
  };
  const ids = model.profile.ontologies.map(item => item.ontology_id);
  const work: Record<Section, () => Promise<ProjectSettings>> = {
    General: () => api.updateProjectSettings(projectKey, { name: general.name, description: general.description.trim() ? general.description : null, languages: general.languages }),
    Annotation: () => api.updateProjectSettings(projectKey, annotation),
    Workflow: () => api.updateProjectSettings(projectKey, { import_plan: workflow.import_plan, annotations_per_text: workflow.annotations_per_text, tool_proposal_mode: workflow.tool_proposal_mode, annotate_accepted_translations_only: workflow.annotate_accepted_translations_only, adjudicator_not_annotator: workflow.adjudicator_not_annotator }),
    // The check first: a move that touches drafts, or any move once work was submitted, waits for the lead's look.
    Pins: async () => {
      const chosen = serializePins(ids, pins);
      const report = await api.previewPins(projectKey, chosen);
      if (!model.locked && !report.rewrites.length && !report.flagged.length) return api.updatePins(projectKey, chosen);
      if (active.current) setRepin({ pins: chosen, report });
      throw new RepinPending();
    },
    Profile: () => api.updateProjectProfile(projectKey, uploaded!.profile),
  };
  const submit = (event: FormEvent<HTMLFormElement>, part: Section) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) void save(part, work[part]);
  };
  const dirty: Record<Section, boolean> = {
    General: JSON.stringify(general) !== JSON.stringify(generalOf(model)),
    Annotation: JSON.stringify(annotation) !== JSON.stringify(annotationOf(model)),
    Workflow: JSON.stringify(workflow) !== JSON.stringify(workflowOf(model)),
    Pins: JSON.stringify(pins) !== JSON.stringify(draftPins(model.pins)),
    Profile: !model.locked && uploaded !== null,
  };
  const dirtyParts = (target: SettingsSection) => SECTION_PARTS[target].filter(part => dirty[part]);
  const sectionDirty = dirtyParts(section).length > 0;
  const anyDirty = Object.values(dirty).some(Boolean);
  const anyDirtyRef = useRef(anyDirty);
  anyDirtyRef.current = anyDirty;
  // Reload or tab close: the browser's own prompt while any edit is unsaved (as Profile has).
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (anyDirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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
      if (part === "Annotation") setAnnotation(annotationOf(model));
      if (part === "Workflow") setWorkflow(workflowOf(model));
      if (part === "Pins") { setPins(draftPins(model.pins)); setRepin(null); }
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

  /**
   * One save model on every form (M-8d, D6 A): "Save changes" (enabled only with unsaved edits), "Discard changes" while there is something to discard,
   * and a status line ("Unsaved changes." / "{part} saved.").
   */
  const saveBar = (part: Section) => <div className="settings-section-actions" role="group" aria-label={`${PART_LABELS[part]} save state`}>
    <Button type="submit" variant="primary" disabled={!dirty[part]} loading={busy === part}>Save changes</Button>
    {dirty[part] && <Button onClick={() => discard([part])}>Discard changes</Button>}
    {error?.section === part && <ErrorNotice error={error.error} />}
    {saved === part && <InlineMessage tone="success">{PART_LABELS[part]} saved.{dirty[part] ? " Newer changes remain unsaved." : ""}</InlineMessage>}
    {dirty[part] && <p role="status" className="field-hint">Unsaved changes.</p>}
  </div>;
  const navigateTo = (event: MouseEvent<HTMLAnchorElement>, destination: Route) => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(destination);
  };
  const editAnnotation = (patch: Partial<typeof annotation>) => { setAnnotation({ ...annotation, ...patch }); setSaved(null); };
  const hidden = hiddenCount(annotation.hidden_axis_values);
  const editPins = (value: typeof pins) => { setPins(value); setRepin(null); setSaved(null); };
  const applyRepin = () => {
    const pending = repin;
    if (pending) void save("Pins", () => api.applyPins(projectKey, pending.pins, pending.report.report_sha256)).then(done => { if (done && active.current) setRepin(null); });
  };
  const repinPanel = repin && <RepinReportPanel report={repin.report} busy={busy === "Pins"} onApply={applyRepin} onCancel={() => setRepin(null)} />;
  const prefillGroups = model.profile.layers.flatMap(layer => layer.annotation_types.filter(type => type.axes?.length)
    .map(type => ({ layer, type, heading: layer.annotation_types.length > 1 ? `${layer.label}: ${type.label}` : layer.label })));

  let content: JSX.Element;
  switch (section) {
    case "people": content = <div ref={bindSection} tabIndex={-1} className="settings-section"><MembersSection projectKey={projectKey} isSystemAdmin={currentUser.is_system_admin} /></div>; break;
    case "workflow": content = <form ref={bindSection} tabIndex={-1} className="settings-section" aria-label="Workflow" onSubmit={event => submit(event, "Workflow")}>
      <fieldset disabled={busy !== null}><legend className="visually-hidden">Workflow</legend>
        <WorkflowFields projectKey={projectKey} value={workflow} saved={workflowOf(model)} disabled={busy !== null} onChange={value => { setWorkflow(value); setSaved(null); }} />
        {saveBar("Workflow")}
      </fieldset>
    </form>; break;
    case "annotation": content = <form ref={bindSection} tabIndex={-1} className="settings-section" aria-label="Annotation" onSubmit={event => submit(event, "Annotation")}>
      <fieldset disabled={busy !== null}><legend className="visually-hidden">Annotation</legend>
        <SettingsCard title="When submitting" hint="Applies to every submission from now on."
          why="In annotation and in consolidation. Submitted work is unchanged. Text evidence the task profile requires is still required.">
          <Select id="project-rule-spanless" label="Findings that point to no text passage"
            value={!annotation.allow_spanless_findings ? "prohibited" : annotation.require_spanless_note ? "required" : "optional"}
            onChange={event => { const mode = event.target.value; editAnnotation({ allow_spanless_findings: mode !== "prohibited", require_spanless_note: mode === "prohibited" ? annotation.require_spanless_note : mode === "required" }); }}>
            <option value="prohibited">Not allowed</option>
            <option value="required">Allowed with a reason</option>
            <option value="optional">Allowed, reason optional</option>
          </Select>
          <Checkbox id="project-rule-chosen" label="Annotators must confirm every value before submitting" hint="Off: unconfirmed prefilled values are submitted marked as prefilled, after a warning." checked={annotation.require_chosen_axes} onChange={event => editAnnotation({ require_chosen_axes: event.target.checked })} />
          <Checkbox id="project-rule-contiguous" label="A finding must be one continuous passage" checked={annotation.contiguous_mentions_only} onChange={event => editAnnotation({ contiguous_mentions_only: event.target.checked })} />
        </SettingsCard>
        <SettingsCard title="Prefilled values" hint="New findings start with these values, marked as not confirmed."
          why="The mark stays until the annotator confirms or changes the value. Existing findings, proposals and carried findings keep their values.">
          {prefillGroups.map(({ layer, type, heading }) => <div key={`${layer.layer_id}/${type.type_id}`} role="group" aria-label={heading} className="settings-prefill-group">
            {prefillGroups.length > 1 && <h3 className="settings-subheading">{heading}</h3>}
            {(type.axes ?? []).map(axis => {
              const defaults = annotation.creation_defaults;
              const current = defaults[layer.layer_id]?.[type.type_id]?.[axis.id] ?? "";
              const options = axis.options.filter(option => !(annotation.hidden_axis_values[layer.layer_id]?.[axis.id] ?? []).includes(option));
              return <Select key={axis.id} id={`default-${layer.layer_id}-${type.type_id}-${axis.id}`} label={axis.label} value={current}
                onChange={event => {
                  const next = structuredClone(defaults);
                  const values = { ...next[layer.layer_id]?.[type.type_id] };
                  if (event.target.value) values[axis.id] = event.target.value; else delete values[axis.id];
                  next[layer.layer_id] = { ...next[layer.layer_id], [type.type_id]: values };
                  if (!Object.keys(values).length) delete next[layer.layer_id][type.type_id];
                  if (!Object.keys(next[layer.layer_id]).length) delete next[layer.layer_id];
                  editAnnotation({ creation_defaults: next });
                }}>
                <option value="">No prefill</option>
                {current && !options.includes(current) && <option value={current} disabled>{axisOptionLabel(current)} (hidden)</option>}
                {options.map(option => <option key={option} value={option}>{axisOptionLabel(option)}</option>)}
              </Select>;
            })}
          </div>)}
          {!prefillGroups.length && <p className="settings-card-text">This profile has no values to prefill.</p>}
        </SettingsCard>
        <section className="settings-card" aria-label="Values annotators can choose">
          <details className="settings-secondary-rules"><summary className="settings-card-title">Values annotators can choose{hidden ? ` (${hidden} hidden)` : ""}</summary>
            <SettingsHint why="Existing findings keep their values; a finding with a hidden value must be changed before it is saved again.">Switch a value off to hide it from the editor's choices.</SettingsHint>
            <HiddenAxisValuesField profile={model.profile} axisDefaults={model.axis_defaults} value={annotation.hidden_axis_values} onChange={hidden_axis_values => editAnnotation({ hidden_axis_values })} disabled={busy !== null} />
          </details>
        </section>
        {saveBar("Annotation")}
      </fieldset>
    </form>; break;
    case "guidelines": content = <section ref={bindSection} tabIndex={-1} className="settings-section" aria-label="Guidelines"><GuidelinesSection projectKey={projectKey} /></section>; break;
    case "general": content = <form ref={bindSection} tabIndex={-1} className="settings-section" aria-label="General" onSubmit={event => submit(event, "General")}>
      <fieldset disabled={busy !== null}><legend className="visually-hidden">General</legend>
        <SettingsCard title="Name and description">
          <TextInput id="project-name" label="Name" required value={general.name} onChange={event => { setGeneral({ ...general, name: event.target.value }); setSaved(null); }} />
          <Textarea id="project-description" label="Description" hint="Shown under the project name on Projects." value={general.description} onChange={event => { setGeneral({ ...general, description: event.target.value }); setSaved(null); }} />
        </SettingsCard>
        <SettingsCard title="Languages" hint="Empty: any language." why="An import refuses texts in other languages.">
          <LanguagesField id="project-languages" label="Languages of the texts" value={general.languages} onChange={languages => { setGeneral({ ...general, languages }); setSaved(null); }} disabled={busy !== null} />
        </SettingsCard>
        {saveBar("General")}
      </fieldset>
    </form>; break;
    case "ontology": content = <section ref={bindSection} tabIndex={-1} className="settings-section" aria-label="Ontology">
      {model.locked ? <><SettingsCard title="Ontology" hint="Only the release can change once work has been submitted."
        why="Moving to another release rewrites draft terms the new release replaced or merged. Submitted work stays as it was submitted.">
        {/* D8: a plain summary; the technical details collapsed. */}
        <ul aria-label="Ontologies" className="settings-card-list">{model.pins.map(pin => <li key={pin.ontology_id}>
          {model.profile.ontologies.find(item => item.ontology_id === pin.ontology_id)?.label ?? pin.ontology_id} ({pin.ontology_id}), release {pin.release}
        </li>)}</ul>
        <p className="settings-card-text">Layers: {model.profile.layers.map(layer => layer.label).join(", ")}.</p>
        <details className="settings-advanced"><summary>Technical details</summary>
          <ul>{model.pins.map(pin => <li key={pin.ontology_id}>{pin.ontology_id} {pin.release}: file checksum (SHA-256) <code>{pin.sha256}</code>; branches: {(pin.allowed_roots ?? []).join(", ") || "every term"}; annotation scheme: {ANNOTATION_SCHEME_LABELS[pin.t1_profile] ?? pin.t1_profile}</li>)}</ul>
          <ul aria-label="Current profile layers">{model.profile.layers.map(layer => <li key={layer.layer_id}>{layer.label} ({layer.layer_id})</li>)}</ul>
        </details>
      </SettingsCard>
        <form className="settings-card" aria-label="Ontology release" onSubmit={event => submit(event, "Pins")}>
          <fieldset disabled={busy !== null}><legend className="settings-card-title">Move to another release</legend>
            <ReleaseFields ids={ids} ontologies={ontologies} value={pins} onChange={editPins} disabled={busy !== null} />
            <SettingsHint why="Terms with exactly one successor or merged into another term are rewritten in drafts. Obsolete terms without one stay and must be changed before submitting.">Check the changes before moving.</SettingsHint>
            <div className="settings-section-actions" role="group" aria-label="Ontology release check">
              <Button type="submit" variant="primary" disabled={!dirty.Pins || repin !== null} loading={busy === "Pins" && repin === null}>Check changes</Button>
              {dirty.Pins && <Button onClick={() => discard(["Pins"])}>Discard changes</Button>}
              {error?.section === "Pins" && <ErrorNotice error={error.error} />}
              {saved === "Pins" && <InlineMessage tone="success">Ontology release changed.</InlineMessage>}
            </div>
          </fieldset>
        </form>
        {repinPanel}
      </> : <>
        <form className="settings-card" aria-label="Ontology version" onSubmit={event => submit(event, "Pins")}>
          <fieldset disabled={busy !== null}><legend className="settings-card-title">Ontology version</legend>
            <PinFields plain ids={ids} ontologies={ontologies} value={pins} onChange={editPins} disabled={busy !== null} />
            <SettingsHint why="A change that rewrites or flags draft terms shows its check first.">Branches and the annotation scheme can change until work has been submitted.</SettingsHint>
            {saveBar("Pins")}
          </fieldset>
        </form>
        {repinPanel}
        <section className="settings-card" aria-label="Task profile">
          <details className="settings-advanced"><summary className="settings-card-title">Advanced: task profile</summary>
            <ul aria-label="Current profile layers">{model.profile.layers.map(layer => <li key={layer.layer_id}>{layer.label} ({layer.layer_id})</li>)}</ul>
            <form aria-label="Task profile" onSubmit={event => { event.preventDefault(); if (uploaded && event.currentTarget.reportValidity()) void save("Profile", work.Profile); }}>
              <fieldset disabled={busy !== null}><legend className="visually-hidden">Task profile</legend>
                <SettingsHint why="The layers, finding types and values annotators work with.">Replace it with a profile file (JSON) only before work starts.</SettingsHint>
                <ProfileUpload key={profileGeneration} label="Profile file (JSON)" onChange={setUploaded} disabled={busy !== null} />
                {saveBar("Profile")}
              </fieldset>
            </form>
          </details>
        </section>
      </>}
    </section>; break;
  }

  return <div className="project-settings-sections">
    <h1 className="settings-title">{model.name} · Settings</h1>
    <nav aria-label="Settings sections" className="settings-tabs">{SETTINGS_SECTIONS.map(id => {
      const destination = settingsRoute(projectKey, id);
      return <a key={id} href={routeHref(destination)} className="settings-tab" aria-current={id === section ? "page" : undefined}
        onClick={event => navigateTo(event, destination)}>{SECTION_LABELS[id]}</a>;
    })}</nav>
    {content}
    <Dialog open={leaving !== null} title={leaving ? `Unsaved changes in ${SECTION_LABELS[leaving]}` : ""} size="sm"
      onClose={() => { if (busy === null) closeLeave(false); }}
      footer={<>
        <Button variant="primary" loading={busy !== null} onClick={() => { void saveAndLeave(); }}>Save changes</Button>
        <Button disabled={busy !== null} onClick={() => { discard(leaveParts); closeLeave(true); }}>Discard changes</Button>
        <Button disabled={busy !== null} onClick={() => closeLeave(false)}>Cancel</Button>
      </>}>
      <p>Save these changes before leaving, or discard them.</p>
      {leaveInvalid && <InlineMessage tone="error">Some fields need correcting. Choose Cancel to fix them.</InlineMessage>}
      {error && leaveParts.includes(error.section) && <ErrorNotice error={error.error} />}
    </Dialog>
  </div>;
}

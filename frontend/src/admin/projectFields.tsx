import { useEffect, useId, useRef, useState } from "react";
import { api, type OntologyInfo, type ProjectPin, type ProjectSettings, type TaskProfile } from "../api/client";
import { Checkbox, InlineMessage, Select, TextInput } from "../ui";
import { helpHref } from "../help/sections";
import { ErrorNotice } from "./ErrorNotice";
import { SettingsCard } from "./SettingsCard";

export type PinDraft = Omit<ProjectPin, "allowed_roots"> & { rootsText: string };
export const draftPins = (pins: ProjectPin[]): Record<string, PinDraft> => Object.fromEntries(pins.map(pin => [pin.ontology_id, { ontology_id: pin.ontology_id, sha256: pin.sha256, t1_profile: pin.t1_profile, rootsText: (pin.allowed_roots ?? []).join(", ") }]));
// The HPO ontology gets the HPO phenotype scheme by default (#5) and only Phenotypic abnormality as findings (#85);
// every other ontology the generic scheme and every term.
export const emptyPin = (id: string): PinDraft => {
  const hpo = id.toUpperCase() === "HP";
  return { ontology_id: id, sha256: "", t1_profile: hpo ? "hpo-phenotype" : "generic", rootsText: hpo ? "HP:0000118" : "" };
};
/** The start for an ontology of an uploaded profile: what it sets; unset branches stay empty (issue 196), `[]` too (the whole ontology). */
export const profilePin = (ontology: TaskProfile["ontologies"][number]): PinDraft => {
  const start = emptyPin(ontology.ontology_id);
  // The file is unchecked until the server reads it: a wrong shape must not break the form.
  return { ...start, t1_profile: ontology.t1_profile ?? start.t1_profile, rootsText: Array.isArray(ontology.allowed_roots) ? ontology.allowed_roots.join(", ") : "" };
};
/** The branches and scheme an uploaded profile sets per ontology; a field the file leaves unset is absent. */
export type LoadedPinFields = Record<string, Partial<Pick<PinDraft, "rootsText" | "t1_profile">>>;
export const loadedPinFields = (profile: TaskProfile): LoadedPinFields => Object.fromEntries((profile.ontologies ?? []).map(ontology => {
  const pin = profilePin(ontology);
  return [ontology.ontology_id, {
    ...(Array.isArray(ontology.allowed_roots) ? { rootsText: pin.rootsText } : {}),
    ...(ontology.t1_profile ? { t1_profile: pin.t1_profile } : {}),
  }];
}));
/** The note on a field that still shows the value of the uploaded profile (issue 239). */
export const LOADED_FROM_PROFILE = "Loaded from the profile.";
const withLoadedNote = (loaded: boolean, hint: string): string => (loaded ? `${LOADED_FROM_PROFILE} ${hint}` : hint);

export const serializePins =(ids: string[], pins: Record<string, PinDraft>): ProjectPin[] => ids.map(id => {
  const pin = pins[id] ?? emptyPin(id);
  return { ontology_id: id, sha256: pin.sha256, allowed_roots: pin.rootsText.split(",").map(root => root.trim()).filter(Boolean), t1_profile: pin.t1_profile };
});

/** Loaded versions of the ontology `id`. */
const versionChoices = (id: string, ontologies: OntologyInfo[]): OntologyInfo[] =>
  ontologies.filter(item => item.status !== "failed" && item.ontology_id.toLowerCase() === id.toLowerCase());

/** `pins` with the only loaded version of an ontology chosen where none is chosen yet (no guess among several). */
export function preselectOnlyVersions(ids: string[], ontologies: OntologyInfo[], pins: Record<string, PinDraft>): Record<string, PinDraft> {
  const next = { ...pins };
  for (const id of ids) {
    const choices = versionChoices(id, ontologies);
    if (!next[id]?.sha256 && choices.length === 1) next[id] = { ...(next[id] ?? emptyPin(id)), sha256: choices[0].sha256 };
  }
  return next;
}

/** The annotation scheme of an ontology in plain words (the API field is `t1_profile`, #5). */
export const ANNOTATION_SCHEME_LABELS: Readonly<Record<ProjectPin["t1_profile"], string>> = {
  "hpo-phenotype": "HPO phenotype (fixed qualifiers, modifiers)",
  generic: "Generic (free qualifiers)",
};
/** Only the version of each pin (a started project): branches and scheme stay. */
export function ReleaseFields({ ids, ontologies, value, onChange, disabled }: {
  ids: string[]; ontologies: OntologyInfo[]; value: Record<string, PinDraft>; onChange: (value: Record<string, PinDraft>) => void; disabled?: boolean;
}): JSX.Element {
  const prefix = useId();
  return <>{ids.map((id, index) => {
    const pin = value[id] ?? emptyPin(id);
    const choices = versionChoices(id, ontologies);
    return <Select key={id} id={`${prefix}-${index}-release`} label={`${id} release`} required value={pin.sha256} disabled={disabled}
      onChange={event => onChange({ ...value, [id]: { ...pin, sha256: event.target.value } })}>
      {pin.sha256 && !choices.some(choice => choice.sha256 === pin.sha256) && <option value={pin.sha256} title={pin.sha256}>Current pin ({pin.sha256.slice(0, 12)})</option>}
      {choices.map(choice => <option key={choice.sha256} value={choice.sha256} title={choice.sha256}>{choice.ontology_id} {choice.release} ({choice.sha256.slice(0, 12)})</option>)}
    </Select>;
  })}</>;
}
const SCHEME_HINT = "HPO phenotype: fixed qualifiers with closed value lists and HPO modifier terms. Generic: qualifiers as the profile defines them.";

/**
 * One fieldset per ontology: the file (version), the allowed roots and the annotation scheme. `plain` (Settings, D8 B): the
 * version stays visible, roots and checks go under "Advanced" with plain labels.
 */
export function PinFields({ ids, ontologies, value, onChange, disabled, plain = false, loaded }: {
  ids: string[]; ontologies: OntologyInfo[]; value: Record<string, PinDraft>; onChange: (value: Record<string, PinDraft>) => void; disabled?: boolean; plain?: boolean;
  /** Values of an uploaded profile: a field still showing its value says "Loaded from the profile." (issue 239). */
  loaded?: LoadedPinFields;
}): JSX.Element {
  const prefix = useId();
  return <>{ids.map((id, index) => {
    const pin = value[id] ?? emptyPin(id);
    const choices = versionChoices(id, ontologies);
    const change = (patch: Partial<PinDraft>) => onChange({ ...value, [id]: { ...pin, ...patch } });
    const fromProfile = loaded?.[id];
    const rootsLoaded = fromProfile?.rootsText !== undefined && fromProfile.rootsText === pin.rootsText;
    const schemeLoaded = fromProfile?.t1_profile !== undefined && fromProfile.t1_profile === pin.t1_profile;
    const roots = <TextInput id={`${prefix}-${index}-roots`} label={plain ? `Limit ${id} terms to these branches` : `Allowed roots for ${id}`}
      hint={withLoadedNote(rootsLoaded, plain ? "Term codes separated by commas, for example HP:0000118. Empty: every term." : pin.rootsText.trim() ? "Comma-separated CURIEs; leave empty for the whole ontology." : "Whole ontology: every term is allowed. Add comma-separated CURIEs to limit it.")}
      value={pin.rootsText} onChange={event => change({ rootsText: event.target.value })} />;
    const checks = <Select id={`${prefix}-${index}-t1`} label={`Annotation scheme for ${id}`} hint={withLoadedNote(schemeLoaded, SCHEME_HINT)} value={pin.t1_profile} onChange={event => change({ t1_profile: event.target.value as ProjectPin["t1_profile"] })}>
      {(Object.keys(ANNOTATION_SCHEME_LABELS) as ProjectPin["t1_profile"][]).map(option => <option key={option} value={option}>{ANNOTATION_SCHEME_LABELS[option]}</option>)}
    </Select>;
    return <fieldset key={id} disabled={disabled}><legend>{id}</legend>
      {/* The short SHA-256 keeps the select narrow; the hint (the select's description) and each option's title carry the full value. */}
      <Select id={`${prefix}-${index}-file`} label={plain ? `${id} version` : `Ontology file for ${id}`} required value={pin.sha256}
        hint={pin.sha256 && !plain ? `SHA-256 ${pin.sha256}` : undefined} onChange={event => change({ sha256: event.target.value })}>
        <option value="">Choose an ontology version</option>
        {pin.sha256 && !choices.some(choice => choice.sha256 === pin.sha256) && <option value={pin.sha256} title={pin.sha256}>Current pin ({pin.sha256.slice(0, 12)})</option>}
        {choices.map(choice => <option key={choice.sha256} value={choice.sha256} title={choice.sha256}>{choice.ontology_id} {choice.release} ({choice.sha256.slice(0, 12)})</option>)}
      </Select>
      {plain ? <details className="settings-advanced"><summary>Advanced</summary>
        {pin.sha256 && <p className="field-hint">File checksum (SHA-256): <code>{pin.sha256}</code></p>}
        {roots}{checks}
      </details> : <>{roots}{checks}</>}
    </fieldset>;
  })}</>;
}

/** The handbook's "Task profiles" in a new tab: template or own file, and what must match a bundle (issue 199). */
export function TaskProfileHelp(): JSX.Element {
  return <p className="field-hint"><a href={helpHref("taskProfiles")} target="_blank" rel="noopener noreferrer">What is a task profile, and which do I need?</a></p>;
}

export interface UploadedProfile { profile: TaskProfile; ids: string[]; layers: { id: string; label: string }[] }
export function ProfileUpload({ onChange, disabled, id = "project-profile-file", label = "Profile JSON" }: { onChange: (value: UploadedProfile | null) => void; disabled?: boolean; id?: string; label?: string }): JSX.Element {
  const [preview, setPreview] = useState<UploadedProfile | null>(null);
  const [error, setError] = useState<unknown>();
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const read = async (file: File | undefined) => {
    const request = ++generation.current;
    setPreview(null); setError(undefined); onChange(null);
    if (!file) { setReading(false); return; }
    setReading(true);
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The profile file could not be read."));
        reader.readAsText(file);
      });
      const raw: unknown = JSON.parse(text);
      if (!raw || typeof raw !== "object" || !("layers" in raw) || !Array.isArray(raw.layers) || !("ontologies" in raw) || !Array.isArray(raw.ontologies)) throw new Error("Choose a profile JSON object with layers and ontologies.");
      // Inspect only preview identifiers. The parsed object itself is sent
      // unchanged; complete schema/clinical validation belongs to the server.
      const layers = raw.layers.map((layer: unknown) => {
        if (!layer || typeof layer !== "object" || !("layer_id" in layer) || typeof layer.layer_id !== "string" || !("label" in layer) || typeof layer.label !== "string") throw new Error("Each preview layer needs its ID and label.");
        return { id: layer.layer_id, label: layer.label };
      });
      const ids = raw.ontologies.map((ontology: unknown) => {
        if (!ontology || typeof ontology !== "object" || !("ontology_id" in ontology) || typeof ontology.ontology_id !== "string") throw new Error("Each profile ontology needs its ID.");
        return ontology.ontology_id;
      });
      const uploaded = { profile: raw as TaskProfile, ids: [...new Set(ids)], layers };
      if (request === generation.current) { setPreview(uploaded); onChange(uploaded); }
    } catch (failure: unknown) { if (request === generation.current) setError(failure); }
    finally { if (request === generation.current) setReading(false); }
  };
  return <>
    <TextInput id={id} label={label} type="file" accept=".json,application/json" disabled={disabled} onChange={event => { void read(event.target.files?.[0]); }} />
    {reading && <InlineMessage tone="info">Reading profile…</InlineMessage>}
    {error !== undefined && <ErrorNotice error={error} />}
    {preview && <ul aria-label="Profile layers">{preview.layers.map(layer => <li key={layer.id}>{layer.label} ({layer.id})</li>)}</ul>}
  </>;
}

export type ToolProposalMode = "proposals" | "scratch";
export interface WorkflowDraft { import_plan: ProjectSettings["import_plan"]; annotations_per_text: number; tool_proposal_mode: ToolProposalMode; annotate_accepted_translations_only: boolean; adjudicator_not_annotator: boolean }
export const workflowOf = (settings: ProjectSettings): WorkflowDraft => ({ import_plan: settings.import_plan ?? "review_and_annotate_translations", annotations_per_text: settings.annotations_per_text ?? 1, tool_proposal_mode: settings.tool_proposal_mode ?? "proposals", annotate_accepted_translations_only: settings.annotate_accepted_translations_only ?? true, adjudicator_not_annotator: settings.adjudicator_not_annotator });
const toolProposalOptions: { value: ToolProposalMode; label: string; help: string }[] = [
  { value: "proposals", label: "Annotators work from the proposals", help: "confirm, reject, correct, add" },
  { value: "scratch", label: "Annotators start from scratch", help: "proposals hidden" },
];
const importPlanOptions: { value: WorkflowDraft["import_plan"]; label: string }[] = [
  { value: "review_and_annotate_translations", label: "Plan review and annotation for every translation" },
  { value: "nothing", label: "Plan nothing; I plan texts on Documents" },
];

/**
 * Settings › Workflow in the order a text moves through work (M2 M-8b, audit §3.2): the plan of new imports, how texts
 * with tool proposals are annotated, the translation gate, annotators per text and the consolidator rule (D3). Each hint
 * says where the setting acts and what overrides it. Lowering the number shows how many rows already have more
 * annotators (server preview).
 */
export function WorkflowFields({ projectKey, value, saved, onChange, disabled }: {
  projectKey: string; value: WorkflowDraft; saved: WorkflowDraft; onChange: (value: WorkflowDraft) => void; disabled?: boolean;
}): JSX.Element {
  const prefix = useId().replace(/:/g, "");
  const target = value.annotations_per_text;
  const lowered = Number.isInteger(target) && target >= 1 && target <= 5 && target < saved.annotations_per_text;
  const [over, setOver] = useState<{ target: number; rows: number } | null>(null);
  useEffect(() => {
    if (!lowered) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api.annotationTargetPreview(projectKey, target).then(result => { if (active) setOver({ target, rows: result.rows_over_target }); }, () => { if (active) setOver(null); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [projectKey, target, lowered]);
  const rows = lowered && over?.target === target ? over.rows : null;
  return <>
    <SettingsCard id={`${prefix}-plan`} title="New imports" hint="For texts imported from now on."
      why="Single texts can be changed on Documents (Plan…); those changes stay.">
      <div role="radiogroup" aria-labelledby={`${prefix}-plan-title`} aria-describedby={`${prefix}-plan-hint`} className="settings-radio-group">
        {importPlanOptions.map(option => <label key={option.value} className="form-checkbox-row">
          <input type="radio" name={`${prefix}-import-plan`} value={option.value} checked={value.import_plan === option.value} disabled={disabled} onChange={() => onChange({ ...value, import_plan: option.value })} />
          <span>{option.label}</span>
        </label>)}
      </div>
    </SettingsCard>
    <SettingsCard id={`${prefix}-tools`} title="Texts with tool proposals" hint="Project default; a text's plan can override it until work starts.">
      <div role="radiogroup" aria-labelledby={`${prefix}-tools-title`} aria-describedby={`${prefix}-tools-hint`} className="settings-radio-group">
        {toolProposalOptions.map(option => <label key={option.value} className="form-checkbox-row">
          <input type="radio" name={`${prefix}-tool-proposals`} value={option.value} checked={value.tool_proposal_mode === option.value} disabled={disabled}
            aria-describedby={`${prefix}-tools-${option.value}`} onChange={() => onChange({ ...value, tool_proposal_mode: option.value })} />
          <span>{option.label} <small id={`${prefix}-tools-${option.value}`} className="settings-option-note" aria-hidden="true">{option.help}</small></span>
        </label>)}
      </div>
    </SettingsCard>
    <SettingsCard title="Annotation and consolidation" hint="Checked when you assign."
      why={<><p>Native source texts are never held back by the translation review; the Assign dialog can override this for one assignment.</p><p>The consolidator rule is checked when you assign consolidation.</p></>}>
      <div className="settings-card-row">
        <TextInput id={`${prefix}-annotations`} label="Annotators per text" type="number" min={1} max={5} step={1} required hint="Upper limit; fewer is fine." value={Number.isFinite(target) ? String(target) : ""} disabled={disabled}
          onChange={event => onChange({ ...value, annotations_per_text: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
        <div>
          <Checkbox id={`${prefix}-translation-gate`} label="Annotate only after the translation review is accepted"
            checked={value.annotate_accepted_translations_only} disabled={disabled} onChange={event => onChange({ ...value, annotate_accepted_translations_only: event.target.checked })} />
          <Checkbox id={`${prefix}-consolidator`} label="Consolidator must not be one of the text's annotators"
            checked={value.adjudicator_not_annotator} disabled={disabled} onChange={event => onChange({ ...value, adjudicator_not_annotator: event.target.checked })} />
        </div>
      </div>
      {rows !== null && <p role="status" className="field-hint">{rows > 0 ? `${rows} ${rows === 1 ? "row has" : "rows have"} more annotators than the new limit. Nobody is removed.` : "Nobody is removed."}</p>}
    </SettingsCard>
  </>;
}

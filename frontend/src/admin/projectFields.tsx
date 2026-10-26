import { useEffect, useId, useRef, useState } from "react";
import { api, type OntologyInfo, type ProjectPin, type ProjectSettings, type TaskProfile } from "../api/client";
import { Checkbox, InlineMessage, Select, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";

export type PinDraft = Omit<ProjectPin, "allowed_roots"> & { rootsText: string };
export const draftPins = (pins: ProjectPin[]): Record<string, PinDraft> => Object.fromEntries(pins.map(pin => [pin.ontology_id, { ontology_id: pin.ontology_id, sha256: pin.sha256, t1_profile: pin.t1_profile, rootsText: (pin.allowed_roots ?? []).join(", ") }]));
export const emptyPin = (id: string): PinDraft => ({ ontology_id: id, sha256: "", t1_profile: "generic", rootsText: "" });
export const serializePins = (ids: string[], pins: Record<string, PinDraft>): ProjectPin[] => ids.map(id => {
  const pin = pins[id] ?? emptyPin(id);
  return { ontology_id: id, sha256: pin.sha256, allowed_roots: pin.rootsText.split(",").map(root => root.trim()).filter(Boolean), t1_profile: pin.t1_profile };
});

/** Checks named in plain words (Settings › Ontology › Advanced, M2 D8). */
export const T1_PROFILE_LABELS: Readonly<Record<ProjectPin["t1_profile"], string>> = {
  generic: "General checks",
  "hpo-phenotype": "HPO phenotype checks (findings and modifiers)",
};

/**
 * One fieldset per ontology: the file (version), the allowed roots and the T1 profile. `plain` (Settings, D8 B): the
 * version stays visible, roots and checks go under "Advanced" with plain labels.
 */
export function PinFields({ ids, ontologies, value, onChange, disabled, plain = false }: {
  ids: string[]; ontologies: OntologyInfo[]; value: Record<string, PinDraft>; onChange: (value: Record<string, PinDraft>) => void; disabled?: boolean; plain?: boolean;
}): JSX.Element {
  const prefix = useId();
  return <>{ids.map((id, index) => {
    const pin = value[id] ?? emptyPin(id);
    const choices = ontologies.filter(item => item.status !== "failed" && item.ontology_id.toLowerCase() === id.toLowerCase());
    const change = (patch: Partial<PinDraft>) => onChange({ ...value, [id]: { ...pin, ...patch } });
    const roots = <TextInput id={`${prefix}-${index}-roots`} label={plain ? `Limit ${id} terms to these branches` : `Allowed roots for ${id}`}
      hint={plain ? "Term codes separated by commas, for example HP:0000118. Empty: every term." : "Comma-separated CURIEs; leave empty to allow all roots."}
      value={pin.rootsText} onChange={event => change({ rootsText: event.target.value })} />;
    const checks = <Select id={`${prefix}-${index}-t1`} label={plain ? `Checks for ${id}` : `T1 profile for ${id}`} value={pin.t1_profile} onChange={event => change({ t1_profile: event.target.value as ProjectPin["t1_profile"] })}>
      {plain ? (Object.keys(T1_PROFILE_LABELS) as ProjectPin["t1_profile"][]).map(option => <option key={option} value={option}>{T1_PROFILE_LABELS[option]}</option>)
        : <><option value="generic">generic</option><option value="hpo-phenotype">hpo-phenotype</option></>}
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
  { value: "proposals", label: "From the proposals", help: "They confirm, reject or correct each proposal and add what the tool missed." },
  { value: "scratch", label: "From scratch", help: "They start from the plain text and do not see the proposals." },
];
const importPlanOptions: { value: WorkflowDraft["import_plan"]; label: string }[] = [
  { value: "review_and_annotate_translations", label: "Plan review and annotation for every translation" },
  { value: "nothing", label: "Do not plan anything (plan texts on Documents)" },
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
    <h3 className="settings-subheading">New imports</h3>
    <div className="form-group">
      <div id={`${prefix}-plan-label`} className="form-label">When texts are imported</div>
      <div role="radiogroup" aria-labelledby={`${prefix}-plan-label`} aria-describedby={`${prefix}-plan-hint`} className="settings-radio-group">
        {importPlanOptions.map(option => <label key={option.value} className="form-checkbox-row">
          <input type="radio" name={`${prefix}-import-plan`} value={option.value} checked={value.import_plan === option.value} disabled={disabled} onChange={() => onChange({ ...value, import_plan: option.value })} />
          <span>{option.label}</span>
        </label>)}
      </div>
      <div id={`${prefix}-plan-hint`} className="field-hint">Applies to texts imported from now on. Single texts can be changed on Documents (Plan…); those changes stay.</div>
    </div>
    <h3 className="settings-subheading">Texts with tool proposals</h3>
    <div className="form-group">
      <div id={`${prefix}-tools-label`} className="form-label">Annotators work</div>
      <div role="radiogroup" aria-labelledby={`${prefix}-tools-label`} aria-describedby={`${prefix}-tools-hint`} className="settings-radio-group">
        {toolProposalOptions.map(option => <label key={option.value} className="form-checkbox-row">
          <input type="radio" name={`${prefix}-tool-proposals`} value={option.value} checked={value.tool_proposal_mode === option.value} disabled={disabled}
            aria-describedby={`${prefix}-tools-${option.value}`} onChange={() => onChange({ ...value, tool_proposal_mode: option.value })} />
          <span>{option.label}<span id={`${prefix}-tools-${option.value}`} className="field-hint">{option.help}</span></span>
        </label>)}
      </div>
      <div id={`${prefix}-tools-hint`} className="field-hint">The project default. A text's plan can override it until work on that text has started.</div>
    </div>
    <h3 className="settings-subheading">Annotation and consolidation</h3>
    <Checkbox id={`${prefix}-translation-gate`} label="Wait for an accepted translation review before annotating"
      hint="Native source texts are never held back. The Assign dialog can override this for one assignment."
      checked={value.annotate_accepted_translations_only} disabled={disabled} onChange={event => onChange({ ...value, annotate_accepted_translations_only: event.target.checked })} />
    <TextInput id={`${prefix}-annotations`} label="Annotators per text" type="number" min={1} max={5} step={1} required hint="An upper limit per text when you assign; fewer is fine." value={Number.isFinite(target) ? String(target) : ""} disabled={disabled}
      onChange={event => onChange({ ...value, annotations_per_text: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
    {rows !== null && <p role="status" className="field-hint">{rows > 0 ? `${rows} ${rows === 1 ? "row has" : "rows have"} more annotators than the new limit. Nobody is removed.` : "Nobody is removed."}</p>}
    <Checkbox id={`${prefix}-consolidator`} label="The consolidator of a text may not be one of its annotators" hint="Checked when you assign consolidation."
      checked={value.adjudicator_not_annotator} disabled={disabled} onChange={event => onChange({ ...value, adjudicator_not_annotator: event.target.checked })} />
  </>;
}

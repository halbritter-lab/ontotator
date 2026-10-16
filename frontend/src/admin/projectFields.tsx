import { useEffect, useId, useRef, useState } from "react";
import type { OntologyInfo, ProjectPin, TaskProfile } from "../api/client";
import { InlineMessage, Select, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";

export type PinDraft = Omit<ProjectPin, "allowed_roots"> & { rootsText: string };
export const draftPins = (pins: ProjectPin[]): Record<string, PinDraft> => Object.fromEntries(pins.map(pin => [pin.ontology_id, { ontology_id: pin.ontology_id, sha256: pin.sha256, t1_profile: pin.t1_profile, rootsText: (pin.allowed_roots ?? []).join(", ") }]));
export const emptyPin = (id: string): PinDraft => ({ ontology_id: id, sha256: "", t1_profile: "generic", rootsText: "" });
export const serializePins = (ids: string[], pins: Record<string, PinDraft>): ProjectPin[] => ids.map(id => {
  const pin = pins[id] ?? emptyPin(id);
  return { ontology_id: id, sha256: pin.sha256, allowed_roots: pin.rootsText.split(",").map(root => root.trim()).filter(Boolean), t1_profile: pin.t1_profile };
});

export function PinFields({ ids, ontologies, value, onChange, disabled }: {
  ids: string[]; ontologies: OntologyInfo[]; value: Record<string, PinDraft>; onChange: (value: Record<string, PinDraft>) => void; disabled?: boolean;
}): JSX.Element {
  const prefix = useId();
  return <>{ids.map((id, index) => {
    const pin = value[id] ?? emptyPin(id);
    const choices = ontologies.filter(item => item.status !== "failed" && item.ontology_id.toLowerCase() === id.toLowerCase());
    const change = (patch: Partial<PinDraft>) => onChange({ ...value, [id]: { ...pin, ...patch } });
    return <fieldset key={id} disabled={disabled}><legend>{id}</legend>
      <Select id={`${prefix}-${index}-file`} label={`Ontology file for ${id}`} required value={pin.sha256} onChange={event => change({ sha256: event.target.value })}>
        <option value="">Choose an ontology version</option>
        {pin.sha256 && !choices.some(choice => choice.sha256 === pin.sha256) && <option value={pin.sha256}>Current pin ({pin.sha256})</option>}
        {choices.map(choice => <option key={choice.sha256} value={choice.sha256}>{choice.ontology_id} {choice.release} ({choice.sha256})</option>)}
      </Select>
      <TextInput id={`${prefix}-${index}-roots`} label={`Allowed roots for ${id}`} hint="Comma-separated CURIEs; leave empty to allow all roots." value={pin.rootsText} onChange={event => change({ rootsText: event.target.value })} />
      <Select id={`${prefix}-${index}-t1`} label={`T1 profile for ${id}`} value={pin.t1_profile} onChange={event => change({ t1_profile: event.target.value as ProjectPin["t1_profile"] })}>
        <option value="generic">generic</option><option value="hpo-phenotype">hpo-phenotype</option>
      </Select>
    </fieldset>;
  })}</>;
}

export interface UploadedProfile { profile: TaskProfile; ids: string[]; layers: { id: string; label: string }[] }
export function ProfileUpload({ onChange, disabled, id = "project-profile-file" }: { onChange: (value: UploadedProfile | null) => void; disabled?: boolean; id?: string }): JSX.Element {
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
    <TextInput id={id} label="Profile JSON" type="file" accept=".json,application/json" disabled={disabled} onChange={event => { void read(event.target.files?.[0]); }} />
    {reading && <InlineMessage tone="info">Reading profile…</InlineMessage>}
    {error !== undefined && <ErrorNotice error={error} />}
    {preview && <ul aria-label="Profile layers">{preview.layers.map(layer => <li key={layer.id}>{layer.label} ({layer.id})</li>)}</ul>}
  </>;
}

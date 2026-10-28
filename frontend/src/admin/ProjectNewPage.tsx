import { useEffect, useRef, useState } from "react";
import { api, type OntologyInfo, type TemplateInfo } from "../api/client";
import type { Route } from "../app/router";
import { Button, InlineMessage, Select, Textarea, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { fieldError } from "./errors";
import { LanguagesField } from "./LanguagesField";
import { PinFields, preselectOnlyVersions, ProfileUpload, serializePins, type PinDraft, type UploadedProfile } from "./projectFields";

export function ProjectNewPage({ onNavigate }: { onNavigate: (route: Route) => void }): JSX.Element {
  const [metadata, setMetadata] = useState<{ templates: TemplateInfo[]; ontologies: OntologyInfo[] } | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [source, setSource] = useState("template");
  const [template, setTemplate] = useState("");
  const [uploaded, setUploaded] = useState<UploadedProfile | null>(null);
  const [pins, setPins] = useState<Record<string, PinDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const writing = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => {
    const epoch = ++lifetime.current;
    setMetadata(null); setLoadError(undefined);
    void Promise.all([api.listTemplates(), api.listOntologies()]).then(([templates, ontologies]) => {
      if (epoch === lifetime.current) setMetadata({ templates, ontologies });
    }).catch((failure: unknown) => { if (epoch === lifetime.current) setLoadError(failure); });
    return () => { lifetime.current++; };
  }, [retry]);
  const ids = source === "template" ? metadata?.templates.find(item => item.id === template)?.required_ontology_ids ?? [] : uploaded?.ids ?? [];
  // An ontology with one loaded version starts with it chosen (#47 A-18).
  const shownPins = metadata ? preselectOnlyVersions(ids, metadata.ontologies, pins) : pins;
  const keyError = fieldError(error, ["PROJECT_EXISTS", "PROJECT_KEY_INVALID"]);
  const keyInput = useRef<HTMLInputElement>(null);
  // A refusal about the key moves focus to the key field, where its message is shown.
  // Any other refusal: back to Create project, which was disabled (and lost focus) while saving (#18).
  const createButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (error !== undefined) (keyError ? keyInput : createButton).current?.focus(); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps -- keyError derives from error
  const create = async () => {
    if (writing.current || !metadata || (source === "upload" && !uploaded)) return;
    const epoch = lifetime.current;
    writing.current = true; setBusy(true); setError(undefined);
    try {
      const result = await api.createProject({ key, name, description: description.trim() ? description : null, languages, pins: serializePins(ids, shownPins), ...(source === "template" ? { template } : { profile: uploaded!.profile }) });
      // A new project needs its people next (B6-1: the bare address opens General).
      if (epoch === lifetime.current) onNavigate({ name: "projectSettings", key: result.project_key, section: "people" });
    } catch (failure: unknown) { if (epoch === lifetime.current) setError(failure); }
    finally { if (epoch === lifetime.current) { writing.current = false; setBusy(false); } }
  };
  return <section><h1>New project</h1>
    {!metadata && loadError === undefined && <InlineMessage tone="info">Loading project templates and ontologies…</InlineMessage>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></>}
    {metadata && <form onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void create(); }}>
      <fieldset disabled={busy}><legend>Project</legend>
        <TextInput ref={keyInput} id="new-project-key" label="Project key" value={key} error={keyError} onChange={event => { setKey(event.target.value); if (keyError) setError(undefined); }} required pattern="[a-z0-9][a-z0-9\-]{1,62}" minLength={2} maxLength={63} hint="Use 2–63 lower-case letters, digits or hyphens; start with a letter or digit." />
        <TextInput id="new-project-name" label="Name" value={name} required onChange={event => setName(event.target.value)} />
        <Textarea id="new-project-description" label="Description" value={description} onChange={event => setDescription(event.target.value)} />
        <LanguagesField id="new-project-languages" label="Languages of the texts" value={languages} onChange={setLanguages} disabled={busy} />
        <Select id="new-project-source" label="Profile source" value={source} onChange={event => { setSource(event.target.value); setUploaded(null); setError(undefined); }}>
          <option value="template">Built-in template</option><option value="upload">Upload profile JSON</option>
        </Select>
        {source === "template" ? <Select id="new-project-template" label="Built-in template" required value={template} onChange={event => setTemplate(event.target.value)}>
          <option value="">Choose a template</option>{metadata.templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </Select> : <ProfileUpload onChange={setUploaded} disabled={busy} />}
        <PinFields ids={ids} ontologies={metadata.ontologies} value={shownPins} onChange={setPins} disabled={busy} />
        <Button ref={createButton} type="submit" variant="primary" loading={busy} disabled={source === "upload" && uploaded === null}>Create project</Button>
      </fieldset>
      {error !== undefined && !keyError && <ErrorNotice error={error} />}
    </form>}
  </section>;
}

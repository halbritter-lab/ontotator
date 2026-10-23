/**
 * "Select by case IDs…" (spec "Selection on Documents (D17)", `approved/work-plan-by-language.html`
 * step 2): paste a list, look it up live, then replace the selection (or add to it) with every text
 * of the found cases (documents overview VD4, through `document-rows/keys`). The selection holds
 * texts of at most `MAX_SELECTION_CASES` cases; beyond that the first ones in pasted order are selected.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, type CaseIdLookupResult, type RowRefView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, Textarea } from "../ui";
import { parseCaseIds } from "./caseIds";
import { MAX_SELECTION_CASES as MAX_SELECTION, textKeyOf } from "./useTextSelection";

export interface SelectByIdsDialogProps {
  projectKey: string;
  /** Case IDs of the current selection (replaced by default). */
  current: ReadonlySet<string>;
  onClose: () => void;
  /** Text keys `"{case}:{language}"` of the found cases in pasted order; the caller applies them (and the cap) and closes the dialog. */
  onSelect: (keys: readonly string[], mode: "replace" | "add") => void;
}

/** Lookup waits this long after the last keystroke. */
export const LOOKUP_DELAY_MS = 250;
/** IDs per lookup request (the endpoint accepts at most 5000). */
const LOOKUP_CHUNK = 5000;
const UNKNOWN_SHOWN = 20;
export const LIMIT_NOTE = `Selection is limited to ${MAX_SELECTION} cases.`;

/** Every text of the given cases (at most `MAX_SELECTION` cases), in the given case order. */
async function textsOf(projectKey: string, caseIds: readonly string[]): Promise<string[]> {
  const wanted = caseIds.slice(0, MAX_SELECTION);
  const result = await api.documentRowKeys(projectKey, { case_ids: wanted });
  const byCase = new Map<string, RowRefView[]>();
  for (const key of result.keys) byCase.set(key.case_id, [...(byCase.get(key.case_id) ?? []), key]);
  return wanted.flatMap(caseId => (byCase.get(caseId) ?? []).map(textKeyOf));
}

async function lookup(projectKey: string, ids: readonly string[]): Promise<CaseIdLookupResult> {
  const result: CaseIdLookupResult = { found: [], unknown: [] };
  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const part = await api.lookupCaseIds(projectKey, ids.slice(start, start + LOOKUP_CHUNK));
    result.found.push(...part.found);
    result.unknown.push(...part.unknown);
  }
  return result;
}

export function SelectByIdsDialog({ projectKey, current, onClose, onSelect }: SelectByIdsDialogProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ key: string; value: CaseIdLookupResult } | null>(null);
  const [error, setError] = useState<{ key: string; error: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<unknown>();
  const generation = useRef(0);
  const ids = parseCaseIds(text);
  const key = JSON.stringify(ids);

  useEffect(() => {
    const run = ++generation.current;
    if (!ids.length) return;
    const timer = window.setTimeout(() => {
      lookup(projectKey, ids).then(value => {
        if (generation.current === run) { setResult({ key, value }); setError(null); }
      }, (failure: unknown) => { if (generation.current === run) setError({ key, error: failure }); });
    }, LOOKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `key` stands for `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, key, retry]);

  const fresh = ids.length > 0 && result?.key === key ? result.value : null;
  const failed = ids.length > 0 && error?.key === key && !fresh ? error.error : undefined;
  const found = fresh?.found ?? [];
  const unknown = fresh?.unknown ?? [];
  const add = adding && current.size > 0;
  const total = add ? new Set([...current, ...found]).size : found.length;
  const limited = total > MAX_SELECTION;

  let blocked: string | null = null;
  if (!ids.length) blocked = "Paste case IDs first.";
  else if (failed !== undefined) blocked = "The lookup failed. Retry first.";
  else if (!fresh) blocked = "Looking up…";
  else if (!found.length) blocked = "None of these case IDs exist in this project.";

  const reasonId = `${id}-reason`;
  const choose = async () => {
    if (selecting) return;
    setSelecting(true); setSelectError(undefined);
    try {
      const keys = await textsOf(projectKey, found);
      onSelect(keys, add ? "add" : "replace");
    } catch (failure: unknown) {
      setSelectError(failure);
    } finally {
      setSelecting(false);
    }
  };
  const primary = limited ? `Select the first ${MAX_SELECTION}` : `Select ${found.length}`;
  const copyUnknown = () => {
    void navigator.clipboard?.writeText(unknown.join("\n")).then(() => setCopied(`Copied ${plural(unknown.length, "unknown ID")}.`), () => setCopied("Could not copy."));
  };

  const footer = <>
    {blocked && <span id={reasonId} className="select-ids-reason">{blocked}</span>}
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="primary" aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? reasonId : undefined}
      loading={selecting} onClick={() => { if (!blocked) void choose(); }}>{primary}</Button>
  </>;

  return <Dialog open title="Select by case IDs" size="md" onClose={onClose} footer={footer}>
    <div className="select-ids">
      <Textarea id={`${id}-ids`} label="Paste case IDs" rows={6} spellCheck={false} value={text}
        hint={ids.length ? undefined : "Paste case IDs, one per line or separated by commas."}
        onChange={event => { setText(event.target.value); setCopied(""); }} />
      <p className="select-ids-result" role="status" aria-live="polite">
        {ids.length === 0 ? "" : fresh ? `${found.length} found, ${unknown.length} unknown` : failed === undefined ? "Looking up…" : ""}
      </p>
      {failed !== undefined && <div className="select-ids-error"><ErrorNotice error={failed} /><Button size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
      {unknown.length > 0 && <div className="select-ids-unknown">
        <p>Unknown: {unknown.slice(0, UNKNOWN_SHOWN).join(", ")}{unknown.length > UNKNOWN_SHOWN ? ` and ${unknown.length - UNKNOWN_SHOWN} more` : ""}</p>
        <Button size="sm" onClick={copyUnknown}>Copy unknown IDs</Button>
        {copied && <span className="field-hint">{copied}</span>}
      </div>}
      {current.size > 0 && <>
        {!adding && <p>This replaces the current selection of {plural(current.size, "case")}.</p>}
        <Checkbox id={`${id}-add`} label="Add to the current selection instead" checked={adding} onChange={event => setAdding(event.target.checked)} />
      </>}
      {limited && <p className="select-ids-limit">{LIMIT_NOTE}</p>}
      {selectError !== undefined && <ErrorNotice error={selectError} />}
    </div>
  </Dialog>;
}

/**
 * "Select by case IDs…" (spec "Selection on Documents (D17)", `approved/work-plan-by-language.html`
 * step 2): paste a list, look it up live, then replace the selection (or add to it) with every text
 * of the found cases (documents overview VD4, through `document-rows/keys`). The selection holds
 * texts of at most `MAX_SELECTION_CASES` cases; beyond that the first ones in pasted order are selected.
 * Case IDs are case sensitive: an ID in another case matches only when one case ID fits; when several
 * do (and none exactly), the dialog lists them and the lead enters the exact one (issue 237).
 * "Select all except these" (issue 339) selects the other texts matching the current filters instead: the server
 * computes the complement (`document-rows/keys` with `exclude`) from at most `MAX_EXCLUDED` found case IDs.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, type CaseIdLookupResult, type DocumentRowFilters, type DocumentRowKeys, type DocumentRowKeysRequest, type RowRefView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, Dialog, Textarea } from "../ui";
import { parseCaseIds } from "./caseIds";
import { MAX_SELECTION_CASES as MAX_SELECTION, textKeyOf } from "./useTextSelection";

export interface SelectByIdsDialogProps {
  projectKey: string;
  /** Case IDs of the current selection (replaced by default). */
  current: ReadonlySet<string>;
  /** The current Documents filters and order: "Select all except these" selects the other matching texts. */
  filters?: DocumentRowFilters;
  sort?: DocumentRowKeysRequest["sort"];
  onClose: () => void;
  /**
   * Text keys `"{case}:{language}"` of the found cases in pasted order (or, inverted, of the other matching cases in list
   * order); the caller applies them (and the cap) and closes the dialog. `truncated`: the server cut the texts off at the cap.
   */
  onSelect: (keys: readonly string[], mode: "replace" | "add", truncated?: boolean) => void;
}

/** Lookup waits this long after the last keystroke. */
export const LOOKUP_DELAY_MS = 250;
/** IDs per lookup request (the endpoint accepts at most 5000). */
const LOOKUP_CHUNK = 5000;
const UNKNOWN_SHOWN = 20;
export const LIMIT_NOTE = `Selection is limited to ${MAX_SELECTION} cases.`;
/** Case IDs "Select all except these" sends (the row keys endpoint accepts at most 5000). */
export const MAX_EXCLUDED = 5000;
export const INVERT_LABEL = "Select all except these";

/** Every text of the given cases (at most `MAX_SELECTION` cases), in the given case order. */
async function textsOf(projectKey: string, caseIds: readonly string[]): Promise<string[]> {
  const wanted = caseIds.slice(0, MAX_SELECTION);
  const result = await api.documentRowKeys(projectKey, { case_ids: wanted });
  const byCase = new Map<string, RowRefView[]>();
  for (const key of result.keys) byCase.set(key.case_id, [...(byCase.get(key.case_id) ?? []), key]);
  return wanted.flatMap(caseId => (byCase.get(caseId) ?? []).map(textKeyOf));
}

type Lookup = Required<CaseIdLookupResult>;

async function lookup(projectKey: string, ids: readonly string[]): Promise<Lookup> {
  const found = new Set<string>();
  const result: Lookup = { found: [], unknown: [], case_insensitive: [], ambiguous: [] };
  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    const part = await api.lookupCaseIds(projectKey, ids.slice(start, start + LOOKUP_CHUNK));
    // Two pasted spellings of one case find it once.
    for (const caseId of part.found) found.add(caseId);
    result.unknown.push(...part.unknown);
    result.case_insensitive.push(...(part.case_insensitive ?? []));
    result.ambiguous.push(...(part.ambiguous ?? []));
  }
  result.found = [...found];
  return result;
}

/** "a", "a and b", "a, b and c". */
function listText(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The first `UNKNOWN_SHOWN` entries and "and n more". */
function shortList(items: readonly string[]): string {
  return `${items.slice(0, UNKNOWN_SHOWN).join(", ")}${items.length > UNKNOWN_SHOWN ? ` and ${items.length - UNKNOWN_SHOWN} more` : ""}`;
}

export function SelectByIdsDialog({ projectKey, current, filters = {}, sort, onClose, onSelect }: SelectByIdsDialogProps): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ key: string; value: Lookup } | null>(null);
  const [error, setError] = useState<{ key: string; error: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [invert, setInvert] = useState(false);
  const [rest, setRest] = useState<{ key: string; value: DocumentRowKeys } | null>(null);
  const [restError, setRestError] = useState<{ key: string; error: unknown } | null>(null);
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
  const caseInsensitive = fresh?.case_insensitive ?? [];
  const ambiguous = fresh?.ambiguous ?? [];
  const add = adding && current.size > 0;
  // Inverted: the other texts matching the filters, computed by the server once the lookup is in.
  const restKey = JSON.stringify([key, filters, sort ?? "case"]);
  const tooManyExcluded = found.length > MAX_EXCLUDED;
  const wantRest = invert && fresh !== null && found.length > 0 && !tooManyExcluded;
  useEffect(() => {
    if (!wantRest) return;
    let active = true;
    api.documentRowKeys(projectKey, { case_ids: found, exclude: true, filters, sort: sort ?? "case" }).then(value => {
      if (active) { setRest({ key: restKey, value }); setRestError(null); }
    }, (failure: unknown) => { if (active) setRestError({ key: restKey, error: failure }); });
    return () => { active = false; };
    // `restKey` stands for the found IDs, the filters and the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, wantRest, restKey, retry]);
  const restFresh = wantRest && rest?.key === restKey ? rest.value : null;
  const restFailed = wantRest && !restFresh && restError?.key === restKey ? restError.error : undefined;
  // Cases the selection would hold: the server counts every other matching case, its keys hold at most the cap.
  const restListed = [...new Set((restFresh?.keys ?? []).map(item => item.case_id))];
  const restUnlisted = (restFresh?.cases ?? 0) - restListed.length;
  const chosen = invert ? restListed : found;
  const total = (add ? new Set([...current, ...chosen]).size : chosen.length) + (invert ? restUnlisted : 0);
  const limited = total > MAX_SELECTION;

  let blocked: string | null = null;
  if (!ids.length) blocked = "Paste case IDs first.";
  else if (failed !== undefined) blocked = "The lookup failed. Retry first.";
  else if (!fresh) blocked = "Looking up…";
  else if (!found.length && ambiguous.length) blocked = "Enter the exact case IDs listed as ambiguous.";
  else if (!found.length) blocked = "None of these case IDs exist in this project.";
  else if (invert && tooManyExcluded) blocked = `${INVERT_LABEL} takes at most ${MAX_EXCLUDED} case IDs.`;
  else if (invert && restFailed !== undefined) blocked = "Loading the other texts failed. Retry first.";
  else if (invert && !restFresh) blocked = "Looking up…";
  else if (invert && !restFresh?.total) blocked = "No other texts match the current filters.";

  const reasonId = `${id}-reason`;
  const choose = async () => {
    if (selecting) return;
    setSelecting(true); setSelectError(undefined);
    try {
      if (invert && restFresh) {
        onSelect(restFresh.keys.map(textKeyOf), add ? "add" : "replace", restFresh.truncated);
        return;
      }
      const keys = await textsOf(projectKey, found);
      onSelect(keys, add ? "add" : "replace");
    } catch (failure: unknown) {
      setSelectError(failure);
    } finally {
      setSelecting(false);
    }
  };
  const primary = invert
    ? limited ? `Select the first ${MAX_SELECTION} others` : `Select ${plural(restFresh?.total ?? 0, "other text")}`
    : limited ? `Select the first ${MAX_SELECTION}` : `Select ${found.length}`;
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
        {ids.length === 0 ? "" : fresh ? `${found.length} found, ${unknown.length} unknown${ambiguous.length ? `, ${ambiguous.length} ambiguous` : ""}` : failed === undefined ? "Looking up…" : ""}
      </p>
      {failed !== undefined && <div className="select-ids-error"><ErrorNotice error={failed} /><Button size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
      {unknown.length > 0 && <div className="select-ids-unknown">
        <p>Unknown: {shortList(unknown)}</p>
        <Button size="sm" onClick={copyUnknown}>Copy unknown IDs</Button>
        {copied && <span className="field-hint">{copied}</span>}
      </div>}
      {ambiguous.length > 0 && <div className="select-ids-ambiguous">
        <p>Ambiguous, not selected:</p>
        <ul>
          {ambiguous.slice(0, UNKNOWN_SHOWN).map(entry => <li key={entry.id}>{entry.id} matches {listText(entry.candidates)}; enter the exact ID.</li>)}
        </ul>
        {ambiguous.length > UNKNOWN_SHOWN && <p>and {ambiguous.length - UNKNOWN_SHOWN} more</p>}
      </div>}
      {caseInsensitive.length > 0 && <p className="select-ids-case">
        Matched in another case: {shortList(caseInsensitive.map(entry => `${entry.id} as ${entry.case_id}`))}
      </p>}
      <Checkbox id={`${id}-invert`} label={INVERT_LABEL} checked={invert} onChange={event => setInvert(event.target.checked)}
        hint="Selects the texts matching the current filters, except the texts of these cases." />
      {invert && restFresh && <p className="select-ids-rest" role="status">
        {`${plural(restFresh.total, "other text")} in ${plural(restFresh.cases, "case")} ${restFresh.total === 1 ? "matches" : "match"} the current filters.`}
      </p>}
      {restFailed !== undefined && <div className="select-ids-error"><ErrorNotice error={restFailed} /><Button size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
      {current.size > 0 && <>
        {!adding && <p>This replaces the current selection of {plural(current.size, "case")}.</p>}
        <Checkbox id={`${id}-add`} label="Add to the current selection instead" checked={adding} onChange={event => setAdding(event.target.checked)} />
      </>}
      {limited && <p className="select-ids-limit">{LIMIT_NOTE}</p>}
      {selectError !== undefined && <ErrorNotice error={selectError} />}
    </div>
  </Dialog>;
}

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError, type BatchAssignRequest, type BatchPersonView, type BatchPreview, type BatchSkipView, type DocumentRowFilters, type DocumentRowView } from "../api/client";
import { personLabel, textLabel } from "../app/identity";
import { assignedText } from "../app/assignedDate";
import { plural } from "../app/labels";
import { versionName } from "../documents/labels";
import { Button, Checkbox, Dialog, IconButton, Popover, Select, StatusBadge } from "../ui";
import { IconInfo } from "../ui/icons";
import { DistributionDialog } from "./DistributionDialog";
import { ErrorNotice } from "./ErrorNotice";
import { errorMessage } from "./errors";
import { memberReason, memberUnavailable, onePersonSummary, partlyAssignedLines, personName, resultMessage, skippedLines, stepLabel, stepName } from "./assignSummary";

export type AssignWorkTask = "translation_review" | "annotate";
export type AssignWorkDialogProps =
  | { mode: "row"; projectKey: string; row: DocumentRowView; task: AssignWorkTask; newReviewOfAccepted?: boolean; reviewReason?: "source_changed";
    /** The lead: listed as "<name> (you)" for annotation; picking them uses the self-assignment (P3 grants the annotator role). */
    me?: { username: string; name: string };
    /** Project rule "the consolidator is not an annotator": its hint shows with the lead's own entry. */
    consolidatorRule?: boolean;
    onClose: () => void; onAssigned: (message: string) => void }
  | { mode: "cases"; projectKey: string; caseIds: readonly string[]; sort: "case" | "import" | "activity"; filters: DocumentRowFilters;
    /** The lead: without the annotator role their row offers "Add me as annotator". */
    me?: { username: string; name: string };
    onClose: () => void; onAssigned: (message: string, skipped: readonly string[]) => void };

type Preview = BatchPreview;
type Step = { task: AssignWorkTask; language: string; versions: number };
type Refused = { case_id: string; language: string; username: string; code: string };
const stepKey = (task: string, language: string) => `${task}:${language}`;
const isTask = (value: string): value is AssignWorkTask => value === "translation_review" || value === "annotate";

export function AssignWorkDialog(props: AssignWorkDialogProps): JSX.Element {
  const identity = props.mode === "row" ? ["row", props.projectKey, props.row.case_id, props.row.language, props.task, !!props.newReviewOfAccepted, props.reviewReason ?? null] : ["cases", props.projectKey, props.caseIds];
  return <AssignWorkEditor key={JSON.stringify(identity)} {...props} />;
}

const rank = (person: BatchPersonView) => memberUnavailable(person) ? 2 : person.language_mismatch ? 1 : 0;
/** Reads the task language(s) first, then fewest open tasks, then name; unavailable people last. */
export const sortMembers = (people: readonly BatchPersonView[]): BatchPersonView[] => [...people].sort((a, b) =>
  rank(a) - rank(b) || a.open_before - b.open_before || personName(a.person).localeCompare(personName(b.person)) || a.username.localeCompare(b.username));

/**
 * M2 D5, B7-5 (mockup 03 variant A): the (i) beside "1 of N possible" opens a popover that explains the project-wide
 * limit and changes it right away ("Change for all texts"). Lowering it only warns; no assignment is ever removed.
 * Saving reloads the member list with the new limit; the dialog and its selection stay.
 */
function LimitInfo({ projectKey, current, textName, onSaved }: { projectKey: string; current: number; textName?: string; onSaved: (value: number) => void }): JSX.Element {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [over, setOver] = useState<{ target: number; rows: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const target = Number(value);
  const valid = Number.isInteger(target) && target >= 1 && target <= 5;
  useEffect(() => {
    if (!open || !valid || target >= current) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api.annotationTargetPreview(projectKey, target).then(result => { if (active) setOver({ target, rows: result.rows_over_target }); }, () => { if (active) setOver(null); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, projectKey, target, valid, current]);
  const rows = valid && target < current && over?.target === target ? over.rows : null;
  const close = () => { if (!busy) { setOpen(false); setError(undefined); setValue(String(current)); } };
  const save = async () => {
    if (!valid || busy) return;
    if (target === current) { close(); return; }
    setBusy(true); setError(undefined);
    try { await api.updateProjectSettings(projectKey, { annotations_per_text: target }); setOpen(false); onSaved(target); }
    catch (failure: unknown) { setError(failure); }
    finally { setBusy(false); }
  };
  return <>
    <IconButton ref={anchor} size="sm" variant="quiet" className="assign-limit-info" icon={<IconInfo />}
      label={`About the limit: ${current === 1 ? "1 annotator" : `${current} annotators`} per text`}
      aria-expanded={open} aria-controls={open ? `${id}-limit` : undefined} onClick={() => open ? close() : setOpen(true)} />
    <Popover open={open} anchorRef={anchor} label="Annotators per text" onClose={close} footer={<>
      <Button size="sm" disabled={busy} onClick={close}>Cancel</Button>
      <Button size="sm" variant="primary" loading={busy} aria-disabled={!valid || target === current || undefined} onClick={() => { void save(); }}>Change for all texts</Button>
    </>}>
      <div id={`${id}-limit`} className="assign-limit-popover">
        <h3>{`Up to ${current === 1 ? "1 annotator" : `${current} annotators`} per text`}</h3>
        <p>This is a <strong>project setting</strong>: the most annotators any text can get. Fewer is fine.</p>
        {/* R-11: a compact inline number field, as high as the small buttons. */}
        <p className="assign-limit-field"><label htmlFor={`${id}-per-text`}>Annotators per text</label>
          <input id={`${id}-per-text`} className="form-control assign-limit-input" type="number" min={1} max={5} step={1} required value={value} disabled={busy}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} /></p>
        {rows !== null && rows > 0 && <p role="status" className="assign-limit-warn">{`${rows === 1 ? "1 text already has" : `${rows} texts already have`} more; their assignments stay.`}</p>}
        <p className="assign-limit-warn">Changing it changes the limit for <strong>all texts</strong> in this project{textName ? `, not only ${textName}` : ""}.</p>
        {error !== undefined && <ErrorNotice error={error} />}
      </div>
    </Popover>
  </>;
}

/** Texts the batch dialog names before "Show all" (issue 129, U4). */
export const NAMED_TEXTS = 6;

/** "case-0101 de, case-0102 de v2": the texts that get the task, in the preview's order, each once. */
export function targetTextNames(targets: readonly { case_id: string; language: string; version: number }[]): string[] {
  return [...new Set(targets.map(item => textLabel(item, { withVersion: item.version > 1 })))];
}

/** Why one text cannot get an annotator now (R-12), from the preview's skip reason. */
function rowBlockedText(reason: BatchSkipView["reason"] | undefined, perText: number, language: string): string {
  switch (reason) {
    case "waiting_for_review": return "This text is still in translation review. Annotation can be assigned once the review is accepted.";
    case "not_in_plan": return `Annotation of this text is not in the plan for ${language}. Turn it on with Plan… first.`;
    case "already_assigned": return `Limit reached: ${perText === 1 ? "1 annotator" : `${perText} annotators`} already assigned.`;
    case "step_differs": return "This text is at another step of the plan.";
    case "discarded": return `The ${language} version of this text is discarded.`;
    case "no_proposals_on_version": return "This text's annotation started from tool proposals, but its newest version has none. Change the plan to annotate from scratch.";
    default: return "This text cannot get an annotator now.";
  }
}

function refusedRows(error: ApiError): Refused[] {
  const rows = error.details && typeof error.details === "object" ? (error.details as { refused?: unknown }).refused : undefined;
  return Array.isArray(rows) ? rows.filter((row): row is Refused => !!row && typeof row === "object" && typeof row.case_id === "string" && typeof row.username === "string" && typeof row.code === "string") : [];
}

function AssignWorkEditor(props: AssignWorkDialogProps): JSX.Element {
  const id = useId();
  const isRow = props.mode === "row";
  const [steps, setSteps] = useState<Step[] | null>(isRow ? [] : null);
  const [stepsError, setStepsError] = useState<unknown>();
  const [stepsRetry, setStepsRetry] = useState(0);
  const [current, setCurrent] = useState<string | null>(props.mode === "row" ? stepKey(props.task, props.row.language) : null);
  const [changingTask, setChangingTask] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [self, setSelf] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<{ key: string; value: Preview } | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [randomOpen, setRandomOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [limitSaved, setLimitSaved] = useState<string | null>(null);
  const [allTexts, setAllTexts] = useState(false);
  const randomChanged = useRef(false);
  const writing = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Cases mode: the assignable steps of the selection; default = the step with most versions.
  const caseIdsKey = props.mode === "cases" ? JSON.stringify(props.caseIds) : "";
  const filtersKey = props.mode === "cases" ? JSON.stringify(props.filters) : "";
  useEffect(() => {
    if (props.mode !== "cases") return;
    let active = true;
    setSteps(null); setStepsError(undefined);
    void api.selectionSummary(props.projectKey, props.caseIds, props.filters).then(summary => {
      if (!active) return;
      const found = summary.steps.filter(step => isTask(step.task)).map(step => ({ task: step.task as AssignWorkTask, language: step.language, versions: step.versions }));
      setSteps(found);
      const best = found.reduce<Step | null>((top, step) => !top || step.versions > top.versions ? step : top, null);
      setCurrent(best ? stepKey(best.task, best.language) : null);
    }, error => { if (active) setStepsError(error); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys stand for caseIds and filters
  }, [props.projectKey, caseIdsKey, filtersKey, stepsRetry]);

  const [taskText, language] = current ? [current.slice(0, current.indexOf(":")), current.slice(current.indexOf(":") + 1)] : ["", ""];
  const task: AssignWorkTask | null = isTask(taskText) ? taskText : null;
  /** Annotation takes several people per text: tick them (checkboxes) up to the limit; a review takes one (radios). */
  const multi = task === "annotate";
  const rowMulti = isRow && multi;
  /** "Assign review…" for a changed source: the review resolves the source-change obligation (spec V5). */
  const sourceChanged = props.mode === "row" && props.reviewReason === "source_changed" && task === "translation_review";
  const shown = preview?.value ?? null;
  const me = props.mode === "row" && task === "annotate" ? props.me ?? null : null;
  const people = shown ? sortMembers(shown.people.filter(person => person.username !== me?.username)) : [];
  /** One text: people who already hold this task show a status instead of a choice (F24). */
  const holds = (person: BatchPersonView) => isRow && person.already_assigned > 0;
  const heldBy = people.filter(holds);
  const order = people.map(person => person.username);
  const usernames = order.filter(name => chosen.includes(name));
  const picked = usernames.length + (self ? 1 : 0);
  // One rule for one text and many: every ticked person gets every text up to the limit ("each"); "Distribute evenly…" splits a batch.
  const apiMode: BatchAssignRequest["mode"] = multi ? "each" : "one";
  const request: BatchAssignRequest | null = !task ? null : props.mode === "row"
    ? { task, language, case_ids: [props.row.case_id], mode: apiMode, usernames, ...(props.newReviewOfAccepted && task === "translation_review" ? { review_accepted_translation: true } : {}), ...(sourceChanged ? { review_reason: "source_changed" as const } : {}) }
    : { task, language, case_ids: [...props.caseIds], sort: props.sort, filters: props.filters, mode: apiMode, usernames };
  const requestKey = request ? JSON.stringify([request, reload]) : "";

  useEffect(() => {
    if (!requestKey) return;
    const seq = ++sequence.current;
    const [body] = JSON.parse(requestKey) as [BatchAssignRequest];
    void api.previewAssignmentBatch(props.projectKey, body).then(value => {
      if (alive.current && seq === sequence.current) { setPreview({ key: requestKey, value }); setPreviewError(null); }
    }, error => { if (alive.current && seq === sequence.current) setPreviewError({ key: requestKey, error }); });
  }, [props.projectKey, requestKey]);

  // People who left the project or became unavailable are dropped from the choice.
  useEffect(() => {
    if (!shown) return;
    setChosen(names => {
      const kept = names.filter(name => shown.people.some(person => person.username === name && !memberUnavailable(person)));
      return kept.length === names.length ? names : kept;
    });
  }, [shown]);

  const calculating = !!requestKey && preview?.key !== requestKey && previewError?.key !== requestKey;
  const fresh = shown && !calculating ? shown : null;
  const radios = !multi;
  const chosenPeople = fresh ? people.filter(person => usernames.includes(person.username)) : [];
  const assignments = fresh ? fresh.targets.reduce((sum, target) => sum + target.usernames.length, 0) : 0;
  const count = assignments || fresh?.versions || shown?.versions || 0;
  // R-12: a text the preview has no target for has no free place (its skip reason says why); never a made-up 1.
  const blocked = rowMulti && !!shown && !shown.targets.length ? rowBlockedText(shown.skipped[0]?.reason, shown.per_text, language) : null;
  const limit = rowMulti ? shown?.targets[0]?.remaining ?? (shown ? 0 : 1) : multi ? shown?.per_text ?? 1 : Infinity;
  /** R-13: annotators the text already has (the limit is an upper bound, never a required number). */
  const assignedCount = shown?.targets[0] ? shown.per_text - shown.targets[0].remaining
    : props.mode === "row" ? props.row.work.filter(item => item.task === "annotate" && item.moved_to_version == null).length : 0;
  // Row mode knows it before the preview, so the acknowledgement is there from the start (no jump).
  const unreviewed = task === "annotate" && shown ? shown.targets.filter(target => target.unreviewed_translation) : [];
  const unreviewedText = unreviewed.length > 0 || (props.mode === "row" && task === "annotate" && props.row.unreviewed_translation);
  const unacknowledged = unreviewedText && !acknowledged;
  // One text: a random draw needs more available people than open places.
  const randomUseful = !!fresh && fresh.targets.some(item => item.remaining > 0)
    && fresh.people.filter(person => !memberUnavailable(person)).length > Math.max(...fresh.targets.map(item => item.remaining));
  const meHolds = !!me && props.mode === "row" && props.row.work.some(item => item.task === "annotate" && item.is_me && item.moved_to_version == null);

  /** "Add me as annotator" (F23): the lead adds the role (Documents is lead-only, and leads manage members), then the preview reloads. */
  const addMeAsAnnotator = async () => {
    const username = props.me?.username;
    if (!username || writing.current) return;
    writing.current = true; setBusy(true); reset();
    try {
      const roles = (await api.listMembers(props.projectKey)).find(member => member.username === username)?.roles ?? [];
      await api.setMemberRoles(props.projectKey, username, [...new Set([...roles, "annotator"])]);
      if (alive.current) setReload(value => value + 1);
    } catch (error: unknown) {
      if (alive.current) setFailure(errorMessage(error));
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };

  const reset = () => { setConfirming(false); setRefused([]); setFailure(null); setNotice(null); };
  const choose = (username: string, checked: boolean) => {
    if (busy) return;
    reset();
    if (radios) setChosen([username]);
    else setChosen(names => checked ? (names.includes(username) || names.length + (self ? 1 : 0) >= limit ? names : [...names, username]) : names.filter(name => name !== username));
  };
  const chooseSelf = (checked: boolean) => {
    if (busy) return;
    reset();
    setSelf(checked && (picked < limit || self));
  };

  const reason = !task || steps === null ? "Loading…"
    : calculating || !fresh ? "Calculating…"
    : !fresh.targets.length ? blocked ?? "No cases in the selection need this task."
    : unacknowledged ? "Confirm annotating before the translation review is accepted."
    : !picked ? (radios ? "Choose a person first." : "Choose people first.")
    : usernames.length && !assignments ? "The chosen people already hold these tasks."
    : null;

  const commit = async (confirmLanguage: boolean) => {
    if (writing.current || !request || !fresh || !task) return;
    writing.current = true; setBusy(true); reset();
    try {
      const messages: string[] = [];
      if (usernames.length) {
        const result = await api.commitAssignmentBatch(props.projectKey, { ...request, expected_preview_digest: fresh.digest, confirm_language: confirmLanguage, confirm_unreviewed_translation: acknowledged });
        if (!alive.current) return;
        messages.push(resultMessage(task, result.created.length, chosenPeople.map(person => ({ person: person.person, count: result.created.filter(item => item.username === person.username).length }))));
      }
      if (self && me && props.mode === "row") {
        const response = await api.createAssignments(props.projectKey, { rows: [{ document_id: props.row.open.document_id, username: me.username }], task: "annotate", confirm_language: true, confirm_unreviewed_translation: acknowledged });
        if (!alive.current) return;
        if (!response.created.length) throw new ApiError(409, "You could not be assigned to this text.", response.refused[0]?.code ?? "ASSIGNMENT_REFUSED");
        messages.push(`You annotate ${props.row.case_id} ${props.row.language}.`);
      }
      const message = messages.join(" ");
      if (props.mode === "row") props.onAssigned(message);
      else props.onAssigned(message, fresh.skipped.map(item => item.case_id));
    } catch (error: unknown) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.code === "ASSIGNMENT_BATCH_STALE") { setNotice(errorMessage(error)); setReload(value => value + 1); }
      else if (error instanceof ApiError && error.code === "ASSIGNMENT_BATCH_REFUSED") {
        const rows = refusedRows(error);
        if (rows.length && rows.every(row => row.code === "LANGUAGE_CONFIRMATION_REQUIRED") && !confirmLanguage) setConfirming(true);
        else { setFailure(errorMessage(error)); setRefused(rows); }
      } else setFailure(errorMessage(error));
    } finally { if (alive.current) { writing.current = false; setBusy(false); } }
  };
  const mismatched = chosenPeople.filter(person => person.language_mismatch && person.gets > 0);
  const assign = () => {
    if (reason || busy) return;
    if (mismatched.length && !confirming) { setConfirming(true); return; }
    // While confirming (also after the server asked for it), this is "Assign anyway".
    void commit(confirming || mismatched.length > 0);
  };

  // One roving tab stop for the member radios; arrow keys skip aria-disabled members.
  const enabled = people.filter(person => !memberUnavailable(person) && !holds(person)).map(person => person.username);
  const tabStop = radios ? (usernames[0] ?? enabled[0]) : undefined;
  const rove = (event: KeyboardEvent<HTMLInputElement>, username: string) => {
    if (!radios || !enabled.length) return;
    const at = order.indexOf(username);
    const after = enabled.find(name => order.indexOf(name) > at) ?? enabled[0];
    const before = [...enabled].reverse().find(name => order.indexOf(name) < at) ?? enabled.at(-1)!;
    const target = { ArrowDown: after, ArrowRight: after, ArrowUp: before, ArrowLeft: before, Home: enabled[0], End: enabled.at(-1)! }[event.key];
    if (!target) return;
    event.preventDefault();
    choose(target, true);
    inputs.current.get(target)?.focus();
  };

  const title = props.mode === "cases" ? `Assign ${plural(props.caseIds.length, "case")}`
    : props.newReviewOfAccepted && task === "translation_review" ? "Assign a new review"
    : sourceChanged ? "Assign review after source change" : `Assign ${(task ? stepName(task) : "task").toLowerCase()}`;

  // "Calculating…" is the footer's reason only.
  const summaryLines: string[] = [];
  if (fresh && task) {
    if (!fresh.targets.length) summaryLines.push("No cases in the selection need this task.");
    if (chosenPeople.length && assignments) {
      for (const person of sortMembers(chosenPeople)) summaryLines.push(onePersonSummary({ person: person.person, gets: person.gets, task, language, openBefore: person.open_before, openAfter: person.open_after }));
    }
    if (!isRow) summaryLines.push(...partlyAssignedLines(fresh.targets, fresh.per_text));
    summaryLines.push(...skippedLines(fresh.skipped, language));
  }

  const now = new Date();
  const holders = props.mode === "row" && task ? props.row.work.filter(item => item.task === task).map(item => {
    const name = personLabel(item.person ?? { pseudonym: item.author_label });
    return item.assigned_at ? `${name}, ${assignedText(new Date(item.assigned_at), now)}` : name;
  }) : [];
  const textMode = props.mode === "row" && task === "annotate" ? props.row.annotation_mode ?? null : null;
  /** One status line: mode, who holds the task (of the limit), the limit. */
  const status = [
    textMode && (textMode.mode === "proposals" ? "From proposals" : `From scratch${textMode.source === "no_proposals" ? " (no tool proposals)" : ""}`),
    holders.length ? `Assigned: ${holders.join("; ")}` : "Nobody assigned yet",
  ].filter(Boolean).join(" · ");
  /** Parallel roots of one text share its label: name the chain. */
  const rootLabel = (item: { case_id: string; language: string; document_id: string }) => {
    const version = props.mode === "row" && props.row.parallel_roots ? props.row.versions.find(entry => entry.document_id === item.document_id) : undefined;
    return version ? `${textLabel(item)} (${versionName(version.version, version.chain_name, true)})` : textLabel(item);
  };
  const newest = props.mode === "row" ? props.row.versions.filter(version => version.is_newest_in_chain).at(-1) ?? props.row.versions.at(-1) : undefined;
  const reasonId = `${id}-assign-reason`;
  const limitId = `${id}-limit`;
  const limitReachedId = `${id}-limit-reached`;
  const stepOptions = props.mode === "row"
    ? (["translation_review", "annotate"] as const).filter(item => item !== "translation_review" || !props.row.is_source).map(item => ({ value: stepKey(item, props.row.language), label: stepName(item) }))
    : (steps ?? []).map(step => ({ value: stepKey(step.task, step.language), label: stepLabel(step.task, step.language, step.versions) }));
  const changeStep = (value: string) => { reset(); setChosen([]); setAcknowledged(false); setCurrent(value); };
  // B7-5: one hint in normal text with the (i) popover; it also says why further rows are blocked.
  const limitInfo = shown && <LimitInfo key={shown.per_text} projectKey={props.projectKey} current={shown.per_text}
    textName={props.mode === "row" ? textLabel(props.row) : undefined}
    onSaved={value => { reset(); setLimitSaved(`Annotators per text: ${value}, for all texts.`); setReload(count => count + 1); }} />;
  const closing = busy ? undefined : props.onClose;

  return <Dialog open title={title} size="md" onClose={closing} footer={<>
    {reason && <span id={reasonId} className="dialog-footer-reason">{reason}</span>}
    <Button disabled={busy} onClick={props.onClose}>Cancel</Button>
    <Button variant="primary" loading={busy} aria-disabled={reason ? "true" : undefined} aria-describedby={reason ? reasonId : undefined} onClick={assign}>{confirming ? "Assign anyway" : rowMulti
      ? (picked ? `Assign ${picked === 1 ? "1 person" : `${picked} people`}` : "Assign") : isRow && !usernames.length ? "Assign" : `Assign ${count}`}</Button>
  </>}>
    <div className="assign-dialog">
      {props.mode === "row" && <div className="assign-context">
        <p><strong>{textLabel({ case_id: props.row.case_id, language: props.row.language, version: newest?.version }, { withVersion: (newest?.version ?? 1) > 1 })}</strong></p>
        {task === "translation_review" && heldBy.length > 0 && <p>{`${stepName(task)} of ${textLabel(props.row)} is assigned to ${heldBy.map(person => personLabel(person.person)).join(", ")}. Assign it to someone else?`}</p>}
        <p id={limitId} className="assign-muted">{status}</p>
      </div>}

      {props.mode === "cases" && stepsError !== undefined && <><ErrorNotice error={stepsError} /><Button onClick={() => setStepsRetry(value => value + 1)}>Retry</Button></>}
      {props.mode === "cases" && steps === null && stepsError === undefined && <p className="assign-muted">Loading members…</p>}
      {props.mode === "cases" && steps !== null && !steps.length && <p>No cases in the selection need this task.</p>}

      {task && (props.mode === "row" ? stepOptions.length > 1 && <div className="assign-field">
        {changingTask
          ? <Select id={`${id}-task`} label="Task" value={current ?? ""} disabled={busy} onChange={event => changeStep(event.target.value)}>{stepOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
          : <p><strong>Task</strong> <span>{props.newReviewOfAccepted && task === "translation_review" ? "New review of the accepted translation" : sourceChanged ? "Review after a source change" : stepName(task)}</span> <Button size="sm" disabled={busy} onClick={() => setChangingTask(true)}>Change task</Button></p>}
      </div> : steps && steps.length > 1
        ? <div className="assign-field"><Select id={`${id}-task`} label="Task" hint="from the plan" value={current ?? ""} disabled={busy} onChange={event => changeStep(event.target.value)}>{stepOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>
        : <p className="assign-field"><strong>Task</strong> <span className="assign-step">{stepOptions[0]?.label}</span> <span className="assign-muted">from the plan</span></p>)}

      {props.mode === "cases" && shown && shown.targets.length > 0 && (() => {
        // issue 129, U4: the dialog names the texts it assigns (the table behind it is covered).
        const names = targetTextNames(shown.targets);
        const listed = allTexts ? names : names.slice(0, NAMED_TEXTS);
        return <p className="assign-texts"><strong>{names.length === 1 ? "Text" : `Texts (${names.length})`}</strong>{" "}
          <span>{listed.join(", ")}{listed.length < names.length && `, and ${names.length - listed.length} more`}</span>
          {names.length > NAMED_TEXTS && <Button size="sm" aria-expanded={allTexts} onClick={() => setAllTexts(value => !value)}>{allTexts ? "Show fewer" : "Show all"}</Button>}</p>;
      })()}
      {multi && props.mode === "cases" && shown && <p id={limitId} className="assign-muted">Tick everyone who should annotate these texts. Each ticked person gets every selected text.</p>}
      {multi && shown && <p id={limitReachedId} className="assign-limit-hint">{rowMulti
        ? blocked ?? [`${assignedCount} assigned`, picked > 0 && `${picked} selected`,
          picked >= limit ? "limit reached" : `${limit - picked} more possible (limit ${shown.per_text})`].filter(Boolean).join(" · ")
        : `Up to ${shown.per_text} per text`}{limitInfo}</p>}
      {limitSaved && <p className="assign-muted" role="status">{limitSaved}</p>}

      {unreviewedText && <Checkbox id={`${id}-unreviewed`} label="Annotate before the translation review is accepted"
        hint={`Translation review not accepted yet: ${unreviewed.length ? unreviewed.map(rootLabel).join(", ") : props.mode === "row" ? textLabel(props.row) : ""}`}
        checked={acknowledged} disabled={busy} onChange={event => { reset(); setAcknowledged(event.target.checked); }} />}

      {task && !shown && previewError === null && <p className="assign-muted">Loading members…</p>}
      {previewError && <><ErrorNotice error={previewError.error} /><Button onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {task && shown && <table className="assign-members" aria-label="Members">
        <thead><tr><th scope="col">Person</th><th scope="col">Reads</th><th scope="col">Open tasks</th>{multi && !isRow && <th scope="col">Gets</th>}</tr></thead>
        <tbody>{people.map((person, index) => {
          const why = memberReason(person, task, language);
          const off = memberUnavailable(person);
          const checked = usernames.includes(person.username);
          const atLimit = !radios && !checked && picked >= limit;
          const inputId = `${id}-member-${index}`;
          const addMe = person.unavailable === "role_missing" && person.username === props.me?.username;
          if (holds(person)) return <tr key={person.username}>
            <td><span className="assign-member">{personLabel(person.person)} <StatusBadge tone="success">Already assigned</StatusBadge></span></td>
            <td className="assign-reads"><span className="assign-narrow-label">Reads </span>{person.reads.join(", ") || "None listed"}</td>
            <td className="assign-open"><span className="assign-narrow-label">Open </span>{person.open_before}</td>
          </tr>;
          const whyId = `${id}-why-${index}`;
          const describedBy = [why && whyId, atLimit && limitReachedId].filter(Boolean).join(" ") || undefined;
          // Muted only when the row cannot be ticked; a language mismatch stays normal with its warning.
          return <tr key={person.username} className={[off || atLimit ? "is-unavailable" : "", checked ? "is-chosen" : ""].filter(Boolean).join(" ") || undefined}>
            <td><span className="assign-member">
              <input ref={element => { if (element) inputs.current.set(person.username, element); else inputs.current.delete(person.username); }}
                id={inputId} type={radios ? "radio" : "checkbox"} name={radios ? `assign-member-${id}` : undefined} checked={checked}
                tabIndex={radios ? (person.username === tabStop ? 0 : -1) : undefined}
                aria-disabled={off || atLimit || busy ? "true" : undefined} aria-describedby={describedBy}
                onClick={event => { if (radios && (off || atLimit || busy)) event.preventDefault(); }}
                onChange={event => { if (!off && !atLimit && !busy) choose(person.username, event.target.checked); }}
                onKeyDown={event => rove(event, person.username)} />
              <label htmlFor={inputId}>{personLabel(person.person)}{why ? <span id={whyId} className="assign-reason">, {why}</span> : atLimit && !blocked && <span className="assign-reason">, limit reached</span>}</label>
              {/* issue 177: a project's creator is a system administrator with every role; mark them so they are not ticked by mistake. */}
              {person.system_admin && <StatusBadge tone="neutral" title="System administrator; the creator of a project is a member with every role">Administrator</StatusBadge>}
              {addMe && <Button size="sm" disabled={busy} onClick={() => { void addMeAsAnnotator(); }}>Add me as annotator</Button>}
            </span></td>
            <td className="assign-reads"><span className="assign-narrow-label">Reads </span>{person.reads.length ? person.reads.map((item, at) => <span key={item}>{at > 0 && ", "}{item === language ? <strong>{item}</strong> : item}</span>) : "None listed"}</td>
            <td className="assign-open"><span className="assign-narrow-label">Open </span>{person.open_before}</td>
            {multi && !isRow && <td className="assign-gets">{person.gets > 0 ? <strong>{person.gets}</strong> : "–"}</td>}
          </tr>;
        })}
        {me && rowMulti && (() => {
          const atLimit = !self && picked >= limit;
          const off = meHolds || atLimit || busy;
          const why = meHolds ? "already annotating this text" : atLimit && !blocked ? "limit reached" : null;
          return <tr key="me" className={[meHolds || atLimit ? "is-unavailable" : "", self ? "is-chosen" : ""].filter(Boolean).join(" ") || undefined}>
            <td><span className="assign-member">
              <input id={`${id}-member-me`} type="checkbox" checked={self} aria-disabled={off ? "true" : undefined}
                aria-describedby={[why && `${id}-why-me`, atLimit && limitReachedId, props.mode === "row" && props.consolidatorRule && `${id}-rule`].filter(Boolean).join(" ") || undefined}
                onChange={event => { if (!off) chooseSelf(event.target.checked); }} />
              <label htmlFor={`${id}-member-me`}>{`${me.name} (you)`}{why && <span id={`${id}-why-me`} className="assign-reason">, {why}</span>}</label>
            </span></td>
            <td className="assign-reads" /><td className="assign-open" />
          </tr>;
        })()}
        </tbody>
      </table>}
      {me && rowMulti && props.mode === "row" && props.consolidatorRule && <p id={`${id}-rule`} className="assign-muted">If you annotate this text yourself, you cannot consolidate it afterwards (project rule "the consolidator is not an annotator").</p>}

      <div className="assign-summary" role="status" aria-live="polite" aria-label="Summary">{summaryLines.map(line => <p key={line}>{line}</p>)}</div>

      {fresh && fresh.targets.length > 0 && (!isRow || randomUseful) && <p className="assign-random"><Button size="sm" disabled={busy} aria-disabled={unacknowledged ? "true" : undefined} aria-describedby={unacknowledged && reason ? reasonId : undefined}
        onClick={() => { if (unacknowledged) return; randomChanged.current = false; setRandomOpen(true); }}>Distribute evenly…</Button></p>}

      {notice && <p className="assign-notice" role="alert">{notice}</p>}
      {failure && <p className="assign-error" role="alert">{failure}</p>}
      {refused.length > 0 && <ul className="assign-refused" aria-label="Refused assignments">{refused.map(row => {
        const person = shown?.people.find(item => item.username === row.username)?.person;
        return <li key={`${row.case_id}:${row.username}:${row.code}`}>{textLabel(row)} — {person ? personLabel(person) : "a former member"}: {errorMessage(new ApiError(409, row.code, row.code))}</li>;
      })}</ul>}
      {confirming && <section className="assign-confirm" aria-label="Confirm languages">
        {!mismatched.length && <p>Some chosen people do not read every language this task needs.</p>}
        {mismatched.map(person => <p key={person.username}>{personName(person.person)} {person.reads.includes(language) ? "does not read the source language" : `does not read ${language}`}.</p>)}
        {/* The footer's primary button turns into "Assign anyway" (one primary action); Back keeps the choice open. */}
        <p>Assign anyway?</p>
        <span className="assign-confirm-actions"><Button disabled={busy} onClick={() => setConfirming(false)}>Back</Button></span>
      </section>}
    </div>
    {randomOpen && fresh && task && <DistributionDialog projectKey={props.projectKey} task={task} confirmUnreviewedTranslation={acknowledged}
      documents={fresh.targets.map(item => ({ document_id: item.document_id, language: item.language }))}
      onChanged={() => { randomChanged.current = true; }}
      onClose={() => {
        setRandomOpen(false);
        if (!randomChanged.current) return;
        const message = "Assignments from the even distribution saved.";
        if (props.mode === "row") props.onAssigned(message); else props.onAssigned(message, fresh.skipped.map(item => item.case_id));
      }} />}
  </Dialog>;
}

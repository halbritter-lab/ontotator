import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import type { AssignmentView, CreateRoundRequest, RoundSourceView, WorkRoundView } from "../api/client";
import { Button, DataTable, IconChevronRight, useMediaQuery, type Column } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { carriedCell, carryUnavailableReason, roundStartingPoint, roundStateLabel, sourceOptionLabel, submissionCell } from "../editor/rounds/roundLabels";
import { notifyTasksChanged } from "./tasksEvents";
import "./workRounds.css";

/** Start state shared by the dialog body (choices) and its footer (primary action). */
export interface RoundStart {
  source: string;
  setSource: (submissionId: string) => void;
  busy: boolean;
  error: unknown;
  run: (work: () => Promise<void>) => void;
  start: (kind: "ordinary" | "carry_forward") => void;
}

export function useRoundStart(assignment: AssignmentView, sources: readonly RoundSourceView[], onCreate: (request: CreateRoundRequest) => Promise<void>): RoundStart {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const writing = useRef(false), active = useRef(false);
  const requests = useRef(new Map<string, CreateRoundRequest>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = useCallback((work: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    void (async () => {
      try { await work(); }
      catch (failure) { if (active.current) setError(failure); }
      finally { writing.current = false; if (active.current) setBusy(false); }
    })();
  }, []);
  const start = (kind: "ordinary" | "carry_forward") => {
    if (assignment.held) return;
    if (kind === "carry_forward" && !sources.some(value => value.submission_id === source)) return;
    // One request ID per identity, so a retry after a failure is idempotent on the server.
    const identity = JSON.stringify([assignment.id, assignment.workflow_revision, kind, kind === "carry_forward" ? source : null]);
    let request = requests.current.get(identity);
    if (!request) {
      request = { request_id: crypto.randomUUID(), expected_workflow_revision: assignment.workflow_revision, kind, source_submission_ids: kind === "carry_forward" ? [source] : [] };
      requests.current.set(identity, request);
    }
    const exact = request;
    // A new round reopens a submitted task: the "My tasks (n)" counter reloads.
    run(async () => { await onCreate(exact); notifyTasksChanged(); });
  };
  return { source, setSource, busy, error, run, start };
}

/** Rounds oldest first, each with a display ordinal (server `round_ordinal`, else its position). */
export function orderedRounds(rounds: readonly WorkRoundView[]): WorkRoundView[] {
  return rounds.map((round, index) => ({ round, index }))
    .sort((a, b) => (a.round.round_ordinal ?? a.index + 1) - (b.round.round_ordinal ?? b.index + 1) || a.index - b.index)
    .map(({ round, index }) => ({ ...round, round_ordinal: round.round_ordinal ?? index + 1 }));
}

export type CarryAvailability =
  | { kind: "available" }
  | { kind: "unavailable"; reason: string }
  | { kind: "unknown" }
  | { kind: "none" };

const openRoundOf = (ordered: readonly WorkRoundView[]) => ordered.find(round => round.state === "editable" && round.active) ?? ordered.find(round => round.state === "editable");

/**
 * The open round that "Continue from" may replace if nothing was saved in it: an automatically
 * created (ordinary) active round without a submission. Whether its draft is untouched (revision 0)
 * is a separate fact the caller checks; null when there is no such round or no carry to offer.
 */
export function replaceableRoundCandidate(assignment: AssignmentView, rounds: readonly WorkRoundView[], sources: readonly RoundSourceView[]): WorkRoundView | null {
  if (assignment.task !== "annotate" || assignment.held || !sources.length) return null;
  const open = openRoundOf(orderedRounds(rounds));
  return open && open.kind === "ordinary" && open.active && !open.submission_count && !open.latest_submission_id ? open : null;
}

/**
 * Whether "Continue from" is offered, and the reason derived from data when it is not.
 * `untouchedRoundId` names an open round confirmed to have no saved change (see
 * `replaceableRoundCandidate`); such a round does not block, the carry replaces it.
 */
export function carryAvailability(assignment: AssignmentView, rounds: readonly WorkRoundView[], sources: readonly RoundSourceView[], untouchedRoundId?: string | null): CarryAvailability {
  if (assignment.task !== "annotate") return { kind: "none" };
  const ordered = orderedRounds(rounds);
  const untouched = Boolean(untouchedRoundId) && replaceableRoundCandidate(assignment, rounds, sources)?.round_id === untouchedRoundId;
  const open = untouched ? undefined : openRoundOf(ordered);
  const reason = carryUnavailableReason({ held: assignment.held, openRoundOrdinal: open?.round_ordinal ?? null, sourceCount: sources.length });
  if (reason === null) return { kind: "available" };
  if (!sources.length && !assignment.held && !open) {
    const submitted = Boolean(assignment.last_submission_id) || rounds.some(round => round.submission_count > 0 || round.latest_submission_id);
    if (submitted) return { kind: "unknown" };
  }
  return { kind: "unavailable", reason };
}

const sourceTime = (source: RoundSourceView) => source.recorded_at ?? source.created_at;

export interface WorkRoundActionsProps {
  assignment: AssignmentView;
  rounds: readonly WorkRoundView[];
  sources: readonly RoundSourceView[];
  control: RoundStart;
  /** The round open in the editor; marked "You are here" and offers no Open action. */
  currentRoundId?: string;
  onOpen: (roundId: string) => Promise<void>;
  onReload: () => void;
  /** An open round confirmed to have no saved change; "Continue from" replaces it. */
  untouchedRoundId?: string | null;
}

export function WorkRoundActions({ assignment, rounds, sources, control, currentRoundId, onOpen, onReload, untouchedRoundId }: WorkRoundActionsProps): JSX.Element {
  const narrow = useMediaQuery("(max-width: 700px)");
  const ordered = orderedRounds(rounds);
  const legendId = useId(), radioName = useId();
  const availability = carryAvailability(assignment, rounds, sources, untouchedRoundId);
  const selected = sources.find(value => value.submission_id === control.source);
  const name = (round: WorkRoundView) => `Round ${round.round_ordinal}`;
  const here = <span className="work-rounds__here" aria-current="true"><IconChevronRight className="work-rounds__here-icon" />You are here</span>;
  const roundCell = (round: WorkRoundView) => <>
    <span className="work-rounds__name">{name(round)}</span>
    <span className="work-rounds__start">{roundStartingPoint(round)}</span>
    {round.round_id === currentRoundId && here}
  </>;
  const action = (round: WorkRoundView) => round.round_id === currentRoundId ? null
    : <Button size="sm" aria-label={`Open ${name(round)}`} disabled={control.busy} onClick={() => control.run(() => onOpen(round.round_id))}>Open</Button>;
  const columns: Column<WorkRoundView>[] = [
    { id: "round", header: "Round", rowHeader: true, cell: roundCell },
    { id: "state", header: "Round state", cell: round => roundStateLabel(round, ordered) },
    { id: "submission", header: "Submission", cell: round => submissionCell(round.submission_count, round.latest_submission_recorded_at) },
    { id: "carried", header: "Carried", cell: round => carriedCell(round.input_count) },
    { id: "actions", header: "Actions", cell: action },
  ];
  const showEmptyStart = assignment.status === "open" && !rounds.length && !assignment.last_submission_id;
  return <div className="work-rounds">
    <p className="work-rounds__intro">Each round keeps its starting point and its submissions. Starting a round does not change the final result.</p>
    {!ordered.length ? <p className="work-rounds__empty">No rounds yet.</p> : narrow
      ? <ul className="work-rounds__cards" aria-label="Rounds">{ordered.map(round => <li key={round.round_id} className="work-rounds__card">
        <h3 className="work-rounds__card-title">{roundCell(round)}</h3>
        <dl>
          <dt>Round state</dt><dd>{roundStateLabel(round, ordered)}</dd>
          <dt>Submission</dt><dd>{submissionCell(round.submission_count, round.latest_submission_recorded_at)}</dd>
          <dt>Carried</dt><dd>{carriedCell(round.input_count)}</dd>
        </dl>
        {action(round)}
      </li>)}</ul>
      : <DataTable label="Rounds" columns={columns} rows={ordered} rowKey={round => round.round_id} className="work-rounds__table" />}
    {ordered.length > 0 && <details className="work-rounds__technical">
      <summary>Technical details</summary>
      <dl>{ordered.map(round => <Fragment key={round.round_id}>
        <dt>{name(round)}</dt><dd><code>{round.round_id}</code></dd>
        {round.latest_submission_id && <><dt>{name(round)} latest submission</dt><dd><code>{round.latest_submission_id}</code></dd></>}
        {(round.input_submission_ids ?? []).map(id => <Fragment key={id}><dt>{name(round)} started from</dt><dd><code>{id}</code></dd></Fragment>)}
      </Fragment>)}</dl>
    </details>}
    {(showEmptyStart || availability.kind !== "none") && <section className="work-rounds__start-new" aria-labelledby={`${legendId}-title`}>
      <h3 id={`${legendId}-title`} className="work-rounds__title">Start a new round</h3>
      {showEmptyStart && <Button loading={control.busy} disabled={assignment.held} onClick={() => control.start("ordinary")}>Start empty round</Button>}
      {availability.kind === "available" && <>
        <div role="radiogroup" aria-labelledby={legendId} className="work-rounds__sources">
          <span id={legendId} className="work-rounds__legend">Continue from</span>
          {sources.map(value => <label key={value.submission_id} className="work-rounds__source">
            <input type="radio" name={radioName} value={value.submission_id} checked={control.source === value.submission_id}
              disabled={control.busy} onChange={() => control.setSource(value.submission_id)} />
            <span>{sourceOptionLabel({ ...value, recorded_at: sourceTime(value) })}</span>
          </label>)}
        </div>
        <p className="work-rounds__consequence">{`${selected?.round_ordinal ? `Round ${selected.round_ordinal}` : "The round you continue from"} stays in the history. Every carried finding must be checked again; carried values are not confirmed.`}</p>
        {/* carry_forward supersedes the earlier round and clears the task's submission. */}
        <p className="work-rounds__consequence">{assignment.last_submission_id
          ? "Your earlier submission is then marked as replaced and no longer counts as submitted: the project lead sees your task as not submitted, and a new consolidation cannot start from it. If the lead already chose it as the final result, the lead is asked to review that choice. Submit the new round to hand in your work again."
          : "Submit the new round to hand in your work."}</p>
      </>}
      {availability.kind === "unavailable" && <p className="work-rounds__reason">{availability.reason}</p>}
      {availability.kind === "unknown" && <>
        <p className="work-rounds__reason">No submission can be continued right now.</p>
        <Button disabled={control.busy} onClick={onReload}>Reload task state</Button>
      </>}
    </section>}
    {control.error !== undefined && <div className="work-rounds__error">
      <ErrorNotice error={control.error} />
      <Button disabled={control.busy} onClick={onReload}>Reload task state</Button>
    </div>}
  </div>;
}

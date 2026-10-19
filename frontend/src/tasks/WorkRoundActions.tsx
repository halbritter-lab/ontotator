import { useEffect, useRef, useState } from "react";
import type { AssignmentView, CreateRoundRequest, RoundSourceView, WorkRoundView } from "../api/client";
import { Button, Select, StatusBadge } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";

export interface WorkRoundActionsProps {
  assignment: AssignmentView;
  rounds: readonly WorkRoundView[];
  sources: readonly RoundSourceView[];
  onCreate: (request: CreateRoundRequest) => Promise<void>;
  onOpen: (roundId: string) => Promise<void>;
  onReload: () => void;
}

const kindLabels: Record<WorkRoundView["kind"], string> = {
  ordinary: "Ordinary round", carry_forward: "Carry-forward annotation", clean_restart: "Clean restart", consolidation: "Consolidation review",
};

export function WorkRoundActions({ assignment, rounds, sources, onCreate, onOpen, onReload }: WorkRoundActionsProps): JSX.Element {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const writing = useRef(false), active = useRef(false);
  const requests = useRef(new Map<string, CreateRoundRequest>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(undefined);
    try { await work(); }
    catch (failure) { if (active.current) setError(failure); }
    finally { writing.current = false; if (active.current) setBusy(false); }
  };
  const start = (kind: "ordinary" | "carry_forward") => {
    if (assignment.held) return;
    if (kind === "carry_forward" && !sources.some(value => value.submission_id === source)) return;
    const identity = JSON.stringify([assignment.id, assignment.workflow_revision, kind, kind === "carry_forward" ? source : null]);
    let request = requests.current.get(identity);
    if (!request) {
      request = { request_id: crypto.randomUUID(), expected_workflow_revision: assignment.workflow_revision, kind, source_submission_ids: kind === "carry_forward" ? [source] : [] };
      requests.current.set(identity, request);
    }
    void run(() => onCreate(request!));
  };
  return <section className="work-round-actions" aria-label="Work round actions">
    <p>Each round keeps its exact inputs and result history. Starting a round does not choose a final project result.</p>
    {rounds.length ? <ol>{rounds.map((round, index) => <li key={round.round_id}>
      <h3>Round {index + 1}: {kindLabels[round.kind]}</h3>
      <p><StatusBadge status={round.state}>{round.state}</StatusBadge>{round.active ? " · Active round" : " · Historical round"}</p>
      <p>{(round.input_submission_ids ?? []).length} selected submission input(s).</p>
      <Button disabled={busy} onClick={() => { void run(() => onOpen(round.round_id)); }}>Open round {index + 1}</Button>
      <details className="technical-details"><summary>Exact round details</summary><p>Round: <code>{round.round_id}</code></p>
        {round.latest_submission_id && <p>Latest submission: <code>{round.latest_submission_id}</code></p>}
        {(round.input_submission_ids ?? []).map(id => <p key={id}>Input: <code>{id}</code></p>)}
      </details>
    </li>)}</ol> : <p>No explicit work rounds recorded yet.</p>}
    {assignment.held && <p>Task paused: {assignment.hold_reason ?? "A project problem needs attention."} You can read existing rounds; resume the task before starting another.</p>}
    {assignment.status === "open" && !rounds.length && !assignment.last_submission_id && <Button loading={busy} disabled={assignment.held} onClick={() => start("ordinary")}>Start empty round</Button>}
    {assignment.task === "annotate" && (sources.length ? <form aria-label="Carry my submitted findings forward" onSubmit={event => { event.preventDefault(); start("carry_forward"); }}>
      <h3>Continue from my submitted findings</h3>
      <p>Select your exact submitted work. Every carried finding needs review against this text, including unchanged evidence. Carrying a value does not confirm it.</p>
      <Select id="carry-forward-source" label="My submitted work to carry forward" aria-label="My submitted work to carry forward" value={source} disabled={busy} required onChange={event => setSource(event.target.value)}>
        <option value="">Choose a submitted result</option>
        {sources.map(value => <option key={value.submission_id} value={value.submission_id}>v{value.version} · {value.language} · {value.document_id} · {value.created_at}</option>)}
      </Select>
      {source && <p>Selected submission: <code>{source}</code></p>}
      <Button type="submit" loading={busy} disabled={assignment.held || !sources.some(value => value.submission_id === source)}>Start carry-forward round</Button>
    </form> : <p>No eligible submitted work is available to carry forward.</p>)}
    {error !== undefined && <><ErrorNotice error={error} /><Button disabled={busy} onClick={onReload}>Reload task state</Button></>}
  </section>;
}

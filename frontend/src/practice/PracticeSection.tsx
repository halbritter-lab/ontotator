import { useState } from "react";
import { api, type PracticeState } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { MY_TASKS, type Route } from "../app/router";
import { Button, Checkbox, ConfirmDialog, InlineMessage } from "../ui";
import { PRACTICE_CARD_TEXT, PracticePill } from "./PracticeOnMyTasks";
import { tasksDone } from "./practiceSteps";
import { formatDay, usePractice } from "./usePractice";
import "./practice.css";

type Confirm = "reset" | "delete" | null;

/**
 * Profile › Practice (issue 266): start, continue, reset or delete the private practice project, its progress
 * and deletion date, and whether My tasks shows the "New here?" card.
 */
export function PracticeSection({ onNavigate }: { onNavigate?: (route: Route) => void }): JSX.Element | null {
  const { load, set } = usePractice();
  const [busy, setBusy] = useState<"start" | "reset" | "delete" | "card" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  if (load.kind === "loading") return null;
  // Practice is optional: when its state cannot be read, the section stays away.
  if (load.kind === "error") return null;
  const state = load.state;
  const project = state.project ?? null;
  // Practice is for annotators and translation reviewers; an existing project stays reachable when the offer is off.
  if (!state.offered && !project) return null;
  const run = async (kind: "start" | "reset" | "delete" | "card", call: () => Promise<PracticeState>, after?: () => void) => {
    setBusy(kind); setError(null);
    try { set(await call()); after?.(); } catch (failure) { setError(failure); } finally { setBusy(null); }
  };
  const goToTasks = () => onNavigate?.(MY_TASKS);
  return <section className="detail-section practice-section" id="practice" aria-labelledby="practice-heading">
    <h2 id="practice-heading">Practice</h2>
    <p>{PRACTICE_CARD_TEXT}</p>
    {project ? <>
      <p><PracticePill /> <strong>{project.name}</strong></p>
      <dl>
        <dt>Progress</dt><dd>{tasksDone(project.done, project.total)}</dd>
        <dt>Deleted on</dt><dd>{formatDay(project.expires_at)}<div className="field-hint">After 30 days without activity. Any change in practice moves the date.</div></dd>
      </dl>
      <div className="toolbar">
        <Button variant="primary" disabled={busy !== null} onClick={goToTasks}>Continue</Button>
        <Button disabled={busy !== null} onClick={() => setConfirm("reset")}>Reset…</Button>
        <Button variant="danger" disabled={busy !== null} onClick={() => setConfirm("delete")}>Delete…</Button>
      </div>
    </> : <>
      {!state.available && state.unavailable_message && <InlineMessage tone="info">{state.unavailable_message}</InlineMessage>}
      <div className="toolbar">
        <Button variant="primary" loading={busy === "start"} disabled={busy !== null || !state.available}
          onClick={() => { void run("start", () => api.startPractice(), goToTasks); }}>Start practice</Button>
      </div>
    </>}
    {state.offered && <Checkbox id="practice-card" label="Show the card New here? on My tasks" checked={!state.card_hidden} disabled={busy !== null}
      onChange={event => { const show = event.target.checked; void run("card", () => api.setPracticeCard(show)); }} />}
    {error != null && <ErrorNotice error={error} />}
    <ConfirmDialog open={confirm === "reset"} title="Reset practice?" busy={busy === "reset"} confirmLabel="Reset practice"
      message={<p>Your practice project is deleted and a fresh one with the same texts is made. Your practice work is lost.</p>}
      onConfirm={() => { void run("reset", () => api.resetPractice(), () => setConfirm(null)); }} onCancel={() => setConfirm(null)} />
    <ConfirmDialog open={confirm === "delete"} title="Delete practice project?" tone="danger" busy={busy === "delete"} confirmLabel="Delete practice project"
      message={<p>Your practice project and its work are deleted. Nothing else changes. You can start a new one here.</p>}
      onConfirm={() => { void run("delete", () => api.deletePractice(), () => setConfirm(null)); }} onCancel={() => setConfirm(null)} />
  </section>;
}

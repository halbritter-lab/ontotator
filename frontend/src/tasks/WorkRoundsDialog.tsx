import { useEffect, useId, useState } from "react";
import { api, type AssignmentView, type CreateRoundRequest, type RoundSourceView, type WorkRoundView } from "../api/client";
import { Button, Dialog, InlineMessage } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { WorkRoundActions, carryAvailability, replaceableRoundCandidate, useRoundStart } from "./WorkRoundActions";

const noSources: readonly RoundSourceView[] = [];

export interface WorkRoundsDialogProps {
  assignment: AssignmentView;
  onClose: () => void;
  onCreate: (request: CreateRoundRequest) => Promise<void>;
  onOpen: (roundId: string) => Promise<void>;
  onReload: () => void;
  /** Names the text in the title; without it the title is "Work rounds". */
  documentLabel?: { textId: string; language: string };
  /** The round open in the editor. */
  currentRoundId?: string;
}

export function WorkRoundsDialog({ assignment, onClose, onCreate, onOpen, onReload, documentLabel, currentRoundId }: WorkRoundsDialogProps): JSX.Element {
  const [data, setData] = useState<{ rounds: WorkRoundView[]; sources: RoundSourceView[]; untouchedRoundId: string | null } | null>(null);
  const [error, setError] = useState<unknown>(), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError(undefined);
    void Promise.all([api.listWorkRounds(assignment.id), assignment.task === "annotate" ? api.listRoundSources(assignment.id) : Promise.resolve([])])
      .then(async ([rounds, sources]) => {
        // An automatically created round without a submission does not block "Continue from" while
        // nothing is saved in it (draft revision 0). Any failure to tell counts as saved work.
        const candidate = replaceableRoundCandidate(assignment, rounds, sources);
        const untouchedRoundId = candidate && await api.openWorkRound(candidate.round_id)
          .then(opened => opened.view.draft.revision === 0, () => false) ? candidate.round_id : null;
        if (active) setData({ rounds, sources, untouchedRoundId });
      }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [assignment.id, retry]);
  const sources = data?.sources ?? noSources;
  const control = useRoundStart(assignment, sources, onCreate);
  const available = data !== null && carryAvailability(assignment, data.rounds, data.sources, data.untouchedRoundId).kind === "available";
  const title = documentLabel ? `Work rounds · ${documentLabel.textId} · ${documentLabel.language}` : "Work rounds";
  // No preselection: the source stays a deliberate choice. Until then the button stays focusable and names why.
  const reasonId = `${useId()}-continue-reason`;
  const chosen = sources.some(value => value.submission_id === control.source);
  const footer = <>
    {available && !chosen && <span id={reasonId} className="work-rounds__reason">Choose a submission to continue from.</span>}
    {available && <Button variant="primary" loading={control.busy} disabled={assignment.held}
      aria-disabled={!chosen || undefined} aria-describedby={chosen ? undefined : reasonId}
      onClick={() => { if (chosen) control.start("carry_forward"); }}>Continue from this submission</Button>}
    <Button onClick={onClose}>Close</Button>
  </>;
  return <Dialog open title={title} onClose={onClose} size="lg" footer={footer}>
    {error !== undefined ? <><ErrorNotice error={error} /><Button onClick={() => setRetry(value => value + 1)}>Retry</Button></> : data
      ? <WorkRoundActions assignment={assignment} rounds={data.rounds} sources={data.sources} control={control} currentRoundId={currentRoundId} untouchedRoundId={data.untouchedRoundId} onOpen={onOpen} onReload={onReload} />
      : <InlineMessage tone="info">Loading work rounds…</InlineMessage>}
  </Dialog>;
}

import { useEffect, useState } from "react";
import { api, type AssignmentView, type CreateRoundRequest, type RoundSourceView, type WorkRoundView } from "../api/client";
import { Button, Dialog, InlineMessage } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { WorkRoundActions } from "./WorkRoundActions";

export function WorkRoundsDialog({ assignment, onClose, onCreate, onOpen, onReload }: {
  assignment: AssignmentView; onClose: () => void; onCreate: (request: CreateRoundRequest) => Promise<void>;
  onOpen: (roundId: string) => Promise<void>; onReload: () => void;
}): JSX.Element {
  const [data, setData] = useState<{ rounds: WorkRoundView[]; sources: RoundSourceView[] } | null>(null);
  const [error, setError] = useState<unknown>(), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError(undefined);
    void Promise.all([api.listWorkRounds(assignment.id), assignment.task === "annotate" ? api.listRoundSources(assignment.id) : Promise.resolve([])])
      .then(([rounds, sources]) => { if (active) setData({ rounds, sources }); }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [assignment.id, retry]);
  return <Dialog open title="Work rounds" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
    {error !== undefined ? <><ErrorNotice error={error} /><Button onClick={() => setRetry(value => value + 1)}>Retry round list</Button></> : data
      ? <WorkRoundActions assignment={assignment} rounds={data.rounds} sources={data.sources} onCreate={onCreate} onOpen={onOpen} onReload={onReload} />
      : <InlineMessage tone="info">Loading authorized work rounds…</InlineMessage>}
  </Dialog>;
}

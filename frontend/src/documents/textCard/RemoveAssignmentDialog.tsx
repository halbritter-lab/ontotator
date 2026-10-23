import { useState } from "react";
import { api } from "../../api/client";
import { errorMessage } from "../../admin/errors";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineMessage } from "../../ui/InlineMessage";

/** "Remove assignment?": removes an unsubmitted annotation assignment and discards its draft. */
export function RemoveAssignmentDialog({ assignmentId, name, caseId, onCancel, onRemoved }: {
  assignmentId: number;
  name: string;
  caseId: string;
  onCancel: () => void;
  onRemoved: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeAssignment(assignmentId);
      onRemoved();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };
  return <ConfirmDialog open title="Remove assignment?" confirmLabel="Remove" tone="danger" busy={busy} onCancel={onCancel} onConfirm={() => { void remove(); }}
    message={<>
      <p>{`Remove ${name} from the annotation of ${caseId}? Their draft is discarded.`}</p>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </>} />;
}

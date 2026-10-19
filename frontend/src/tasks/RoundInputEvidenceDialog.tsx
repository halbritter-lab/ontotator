import { useEffect, useState } from "react";
import { api, type RoundInputView } from "../api/client";
import { Button, Dialog, InlineMessage } from "../ui";
import { ErrorNotice } from "../admin/ErrorNotice";
import { ReadOnlyAnnotationView } from "../variants/ReadOnlyAnnotationView";

export function RoundInputEvidenceDialog({ projectKey, input, onClose, labelFor }: {
  projectKey: string; input: RoundInputView; onClose: () => void; labelFor: (layer: string | undefined, term: string) => string | null;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null), [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true; setText(null); setError(undefined);
    void api.getVariantText(projectKey, input.source_snapshot.document_id).then(value => {
      if (value.text_sha256 !== input.source_snapshot.text_sha256) throw new Error("The exact original evidence text is unavailable.");
      if (active) setText(value.text);
    }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey, input]);
  return <Dialog open title="Original carried finding" onClose={onClose} size="lg">
    <p>Submitted input: <code>{input.source_submission_id}</code></p>
    {error !== undefined ? <ErrorNotice error={error} /> : text === null ? <InlineMessage tone="info">Loading exact original evidence…</InlineMessage>
      : <ReadOnlyAnnotationView text={text} annotations={[input.source_snapshot]} evidence={input.source_snapshot.evidence} labelFor={labelFor} />}
    <Button onClick={onClose}>Close original evidence</Button>
  </Dialog>;
}

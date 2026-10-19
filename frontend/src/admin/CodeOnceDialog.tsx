import { useEffect, useId, useRef, useState } from "react";
import type { components } from "../api/generated";
import { Button, Checkbox, Dialog, InlineMessage } from "../ui";
import { formatDateTime } from "../app/labels";

export type CodeOnceDialogProps = components["schemas"]["CodeResponse"] & {
  open: boolean;
  kind: "setup" | "reset";
  onClose: () => void;
};

export function CodeOnceDialog(props: CodeOnceDialogProps): JSX.Element | null {
  // A new issuance or reopening owns a new transient acknowledgement/copy state.
  // The mounted dialog is preserved through ordinary checkbox/copy updates.
  return props.open ? <CodeSession key={JSON.stringify([props.kind, props.code, props.expires_at])} {...props} /> : null;
}

function CodeSession({ code, expires_at, kind, onClose }: CodeOnceDialogProps): JSX.Element {
  const checkboxId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copy, setCopy] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const close = () => { if (acknowledged) onClose(); };
  const copyCode = async () => {
    setCopy("pending");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      if (active.current) setCopy("copied");
    } catch {
      if (active.current) setCopy("failed");
    }
  };

  return <Dialog open title={kind === "setup" ? "Setup code" : "Reset code"} size="sm" onClose={acknowledged ? close : undefined} closeOnBackdrop
    footer={<Button variant="primary" disabled={!acknowledged} onClick={close}>Close</Button>}>
    <p>This code is shown only once. Hand it over in person or by a secure channel.</p>
    <p><code>{code}</code></p>
    <p>Expires (local time): <time dateTime={expires_at}>{formatDateTime(expires_at)}</time></p>
    <Button loading={copy === "pending"} onClick={() => { void copyCode(); }}>{copy === "copied" ? "Copied" : "Copy"}</Button>
    {copy === "copied" && <InlineMessage tone="success">Copied to clipboard.</InlineMessage>}
    {copy === "failed" && <InlineMessage tone="error">Could not copy to the clipboard. Select and copy the code manually.</InlineMessage>}
    <Checkbox id={checkboxId} label="I have handed over or stored the code" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
  </Dialog>;
}

import { useEffect, useId, useRef, useState } from "react";
import type { components } from "../api/generated";
import { Button, Checkbox, Dialog, InlineMessage } from "../ui";
import { formatDateTime } from "../app/labels";

export type CodeOnceDialogProps = components["schemas"]["CodeResponse"] & {
  open: boolean;
  kind: "setup" | "reset";
  /** The account the code is for; named in the hand-over text. */
  username?: string;
  onClose: () => void;
};

/** What the recipient needs in one message: where to go, which button, username, code and expiry. */
export function handoverText({ code, expires_at, kind, username }: Pick<CodeOnceDialogProps, "code" | "expires_at" | "kind" | "username">, loginUrl: string, now = Date.now()): string {
  const hours = Math.max(1, Math.round((new Date(expires_at).getTime() - now) / 3_600_000));
  return [
    kind === "setup" ? "Your Ontotator account is ready." : "Your Ontotator password can be reset.",
    `1. Open ${loginUrl}`,
    `2. Choose "I have a setup or reset code".`,
    `3. Enter your username${username ? ` ${username}` : ""}, the code below and a new password of at least 12 characters.`,
    "",
    `Code: ${code}`,
    "",
    `The code works once and is valid for about ${hours} ${hours === 1 ? "hour" : "hours"}, until ${formatDateTime(expires_at)}. Capital letters, spaces and hyphens do not matter.`,
  ].join("\n");
}

export function CodeOnceDialog(props: CodeOnceDialogProps): JSX.Element | null {
  // A new issuance or reopening owns a new transient acknowledgement/copy state.
  // The mounted dialog is preserved through ordinary checkbox/copy updates.
  return props.open ? <CodeSession key={JSON.stringify([props.kind, props.code, props.expires_at])} {...props} /> : null;
}

type CopyState = { what: "code" | "text"; state: "pending" | "copied" | "failed" } | null;

function CodeSession(props: CodeOnceDialogProps): JSX.Element {
  const { code, expires_at, kind, onClose } = props;
  const checkboxId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copy, setCopy] = useState<CopyState>(null);
  const active = useRef(false);
  const [text] = useState(() => handoverText(props, `${window.location.origin}${window.location.pathname}`));
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const close = () => { if (acknowledged) onClose(); };
  const copyValue = async (what: "code" | "text") => {
    setCopy({ what, state: "pending" });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(what === "code" ? code : text);
      if (active.current) setCopy({ what, state: "copied" });
    } catch {
      if (active.current) setCopy({ what, state: "failed" });
    }
  };
  const state = (what: "code" | "text") => copy?.what === what ? copy.state : "idle";

  return <Dialog open title={kind === "setup" ? "Setup code" : "Reset code"} size="sm" onClose={acknowledged ? close : undefined} closeOnBackdrop
    footer={<Button variant="primary" disabled={!acknowledged} onClick={close}>Close</Button>}>
    <p>This code is shown only once. Hand it over in person or by a secure channel.</p>
    <p><code>{code}</code></p>
    <p>Expires (local time): <time dateTime={expires_at}>{formatDateTime(expires_at)}</time></p>
    <Button loading={state("code") === "pending"} onClick={() => { void copyValue("code"); }}>{state("code") === "copied" ? "Copied" : "Copy"}</Button>
    <Button loading={state("text") === "pending"} onClick={() => { void copyValue("text"); }}>{state("text") === "copied" ? "Hand-over text copied" : "Copy hand-over text"}</Button>
    {copy?.state === "copied" && <InlineMessage tone="success">Copied to clipboard.</InlineMessage>}
    {copy?.state === "failed" && <InlineMessage tone="error">Could not copy to the clipboard. Select and copy the code manually.</InlineMessage>}
    <details><summary>Hand-over text</summary><pre className="handover-text">{text}</pre></details>
    <Checkbox id={checkboxId} label="I have handed over or stored the code" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
  </Dialog>;
}

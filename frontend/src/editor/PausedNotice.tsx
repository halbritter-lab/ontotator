import { useId, useState } from "react";
import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";

/**
 * Issue 232: the editor's paused banner, collapsed by default. One line "Task paused: {reason}" (cut off with an
 * ellipsis when it is too long); "Show more" opens the full reason and what stays available.
 */
export function PausedNotice({ reason, kept }: { reason?: string | null; kept: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <InlineMessage tone="warning">
    <div className={open ? "paused-notice paused-notice--open" : "paused-notice"}>
      <div id={id} className="paused-notice__text">
        <span className="paused-notice__reason">Task paused: {reason?.trim() || "A project problem needs attention."}</span>
        {open && <span className="paused-notice__kept">{kept}</span>}
      </div>
      <Button variant="quiet" size="sm" className="paused-notice__toggle" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(value => !value)}>{open ? "Show less" : "Show more"}</Button>
    </div>
  </InlineMessage>;
}

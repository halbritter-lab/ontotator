import { useId, type ReactNode } from "react";

/** One group of open items in the dialog's box: a small heading and its rows. */
export function SubmitGroup({ heading, action, note, children, ...rest }: {
  heading: string; action?: ReactNode; note?: ReactNode; children: ReactNode; "data-unconfirmed-values"?: boolean; "data-modifier-warnings"?: boolean;
}) {
  const headingId = useId();
  return <section className="submit-group" aria-labelledby={headingId} {...rest}>
    <div className="submit-group__header"><h3 id={headingId}>{heading}</h3>{action}</div>
    {note}
    <ul className="submit-group__list">{children}</ul>
  </section>;
}

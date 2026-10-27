/** One rendering for a value that is not set: a visible dash, read as "not set" (#47 X-11). */
export function EmptyValue(): JSX.Element {
  return <span className="empty-value"><span aria-hidden="true">—</span><span className="visually-hidden">not set</span></span>;
}

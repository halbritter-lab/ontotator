/** What the group will save, always spelled out (spec §3 "Result" line). */
export function ResultLine({ line }: { line: { saved: string; notTaken: string | null } }): JSX.Element {
  return <p className="cons-result" aria-live="polite">
    {line.saved}
    {line.notTaken && <><br /><span className="cons-muted">{line.notTaken}</span></>}
  </p>;
}

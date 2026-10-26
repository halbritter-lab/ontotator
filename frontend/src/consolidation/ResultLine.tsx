import { Fragment } from "react";
import { AxisValue } from "../ui/AxisValue";
import type { ResultPart } from "./groupModel";

/**
 * What the group will save, always spelled out (spec §3 "Result" line); axis values as `AxisValue` chips. `staged`:
 * a choice is staged and waits for "Keep" (M2 M-7d).
 */
export function ResultLine({ line, staged = false }: { line: { saved: string; notTaken: string | null; parts?: readonly ResultPart[] }; staged?: boolean }): JSX.Element {
  return <p className="cons-result" aria-live="polite">
    {line.parts ? <>Result: 1 finding, {line.parts.map((part, index) => <Fragment key={index}>{index > 0 && ", "}
      {part.axis !== undefined ? <AxisValue value={part.axis} /> : part.text}</Fragment>)}</> : line.saved}
    {staged && <> <strong>Not saved yet.</strong></>}
    {line.notTaken && <><br /><span className="cons-muted">{line.notTaken}</span></>}
  </p>;
}

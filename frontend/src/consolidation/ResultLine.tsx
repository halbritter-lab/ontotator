import { Fragment } from "react";
import { AxisValue } from "../ui/AxisValue";
import type { ResultPart } from "./groupModel";

/** What the group will save, always spelled out (spec §3 "Result" line); axis values as `AxisValue` chips. */
export function ResultLine({ line }: { line: { saved: string; notTaken: string | null; parts?: readonly ResultPart[] } }): JSX.Element {
  return <p className="cons-result" aria-live="polite">
    {line.parts ? <>Result: 1 finding, {line.parts.map((part, index) => <Fragment key={index}>{index > 0 && ", "}
      {part.axis !== undefined ? <AxisValue value={part.axis} /> : part.text}</Fragment>)}</> : line.saved}
    {line.notTaken && <><br /><span className="cons-muted">{line.notTaken}</span></>}
  </p>;
}

import type { ReactNode } from "react";

/** Stage tones (spec "Stage cells"): colour follows the tone; the word, never the colour, carries the meaning. */
export type StageTone = "none" | "undecided" | "waiting" | "todo" | "running" | "decision" | "rejected" | "done";

export interface StageCellProps {
  /** Text glyph such as "◐"; decorative, hidden from assistive technology. */
  symbol: string;
  /** Status word, e.g. "In progress". */
  word: string;
  /** Muted second line, e.g. a person or "v1 machine translation". Omitted when empty. */
  detail?: ReactNode;
  tone: StageTone;
  /** Mutes the whole cell (rows outside the plan). */
  muted?: boolean;
}

/** Two-line workflow stage cell: symbol + status word, then a muted detail line. */
export function StageCell({ symbol, word, detail, tone, muted = false }: StageCellProps): JSX.Element {
  return <span className={["stage-cell", `stage-cell--${tone}`, muted && "stage-cell--muted"].filter(Boolean).join(" ")}>
    <span className="stage-cell-status"><span className="stage-cell-symbol" aria-hidden="true">{symbol}</span> {word}</span>
    {detail != null && detail !== "" && <span className="stage-cell-detail">{detail}</span>}
  </span>;
}

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

/** ○ ◐ ● as circles of one size: the font fallback draws ● visibly smaller. Other glyphs stay text. */
const CIRCLES: Readonly<Record<string, JSX.Element>> = {
  "○": <circle cx="8" cy="8" r="6" fill="none" />,
  "◐": <><circle cx="8" cy="8" r="6" fill="none" /><path d="M8 2a6 6 0 0 0 0 12z" stroke="none" /></>,
  "●": <circle cx="8" cy="8" r="6" />,
};

/** The decorative stage glyph (`aria-hidden`); shared by the stage cell, the table row and the narrow cards. */
export function StageSymbol({ symbol }: { symbol: string }): JSX.Element {
  const circle = CIRCLES[symbol];
  return <span className="stage-cell-symbol" aria-hidden="true">
    {circle ? <svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth="1.5" focusable="false">{circle}</svg> : symbol}
  </span>;
}

/** Two-line workflow stage cell: symbol + status word, then a muted detail line. */
export function StageCell({ symbol, word, detail, tone, muted = false }: StageCellProps): JSX.Element {
  return <span className={["stage-cell", `stage-cell--${tone}`, muted && "stage-cell--muted"].filter(Boolean).join(" ")}>
    <span className="stage-cell-status"><StageSymbol symbol={symbol} /> {word}</span>
    {detail != null && detail !== "" && <span className="stage-cell-detail">{detail}</span>}
  </span>;
}

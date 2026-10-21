/**
 * Stage strip of the row panel (acceptance fixes WP-A): three compact tiles Review · Annotation · Final
 * with the row's stage status. A tile filters the panel's Activity to its stage; the pressed tile clears
 * the filter again. The tiles stand in for the table columns the panel covers.
 */
import type { DocumentRowView } from "../api/client";
import type { PanelStage } from "../app/router";
import { stageText, type StageName } from "./stageLabels";

/** Stage titles in table order (the table's column headers). */
export const STAGE_TITLES: Readonly<Record<PanelStage, string>> = { review: "Review", annotation: "Annotation", final: "Final" };
const ORDER: readonly PanelStage[] = ["review", "annotation", "final"];

/** Symbol and status word of a row's stage cell ("—" without a cell). */
export function stageStatus(row: DocumentRowView, stage: StageName, sourceLanguage?: string | null): { symbol: string; word: string; detail: string; tone: string } {
  const cell = row.stages?.[stage];
  if (!cell) return { symbol: "", word: "—", detail: "", tone: "none" };
  const text = stageText(stage, cell, row, { sourceLanguage });
  return { symbol: text.symbol, word: text.word, detail: text.detail, tone: cell.tone };
}

export interface StageStripProps {
  row: DocumentRowView;
  /** Source language of the row's case (Review wording of translations). */
  sourceLanguage?: string | null;
  /** The Activity filter; none means every stage. */
  stage?: PanelStage;
  onSelect: (stage: PanelStage | undefined) => void;
}

export function StageStrip({ row, sourceLanguage, stage, onSelect }: StageStripProps): JSX.Element {
  return <div className="row-panel-stages" role="group" aria-label="Filter activity by stage">
    {ORDER.map(name => {
      const status = stageStatus(row, name, sourceLanguage);
      const pressed = stage === name;
      return <button key={name} type="button" className="row-panel-stage" aria-pressed={pressed}
        onClick={() => onSelect(pressed ? undefined : name)}>
        <span className="row-panel-stage-title">{STAGE_TITLES[name]}</span>
        <span className={`stage-cell stage-cell--${status.tone}`}>
          <span className="stage-cell-status">{status.symbol && <span className="stage-cell-symbol" aria-hidden="true">{status.symbol}</span>} {status.word}</span>
        </span>
      </button>;
    })}
  </div>;
}

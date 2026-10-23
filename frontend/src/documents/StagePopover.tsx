/**
 * Stage popover of a Documents card (acceptance fixes WP-A, "Below 700 px"): a stage line's status opens
 * the stage's 3 newest activity lines, its admin actions (the same the text card offers for the stage)
 * and "Open full details" (the text card on the stage's segment). Built on `ui/Popover`,
 * so below 700 px it is a full-height sheet; Escape returns focus to the stage cell.
 */
import { useId, type ReactNode, type RefObject } from "react";
import type { DocumentRowView } from "../api/client";
import { Button } from "../ui/Button";
import { Popover } from "../ui/Popover";
import { historyLines } from "./historyLines";
import { emptyActivityText } from "./RowActivity";
import { rowName } from "./RowCells";
import { HISTORY_LINE_PREFIX, STAGE_TITLES, type StageName } from "./stageLabels";
import { useRowSubmissions } from "./useRowSubmissions";

/** Lines the popover shows; the rest is in the text card's History. */
const LATEST = 3;

export interface StagePopoverProps {
  row: DocumentRowView;
  stage: StageName;
  projectKey: string;
  /** The stage cell's button (focus returns to it on Escape). */
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  /** "Open full details": the text card on this stage's segment. */
  onOpenDetails: () => void;
  /** Admin actions of this stage (as in the text card). */
  actions?: ReactNode;
  /** Id of the popover content (the stage cell's `aria-controls`). */
  contentId?: string;
  /** Pseudonym of the signed-in lead ("Final: chosen by you"). */
  me?: string | null;
  now?: Date;
}

/** "Annotation: Tom Reis (ann-0004), Round 1, …" without the stage word the popover title already names. */
const lineText = (text: string, title: string): string => (text.startsWith(`${title}: `) ? text.slice(title.length + 2) : text);

export function StagePopover({ row, stage, projectKey, anchorRef, onClose, onOpenDetails, actions, contentId, me, now }: StagePopoverProps): JSX.Element {
  const ownId = useId();
  const id = contentId ?? ownId;
  const title = STAGE_TITLES[stage];
  // Only annotation lines come from the submissions; review and final lines are in the row itself.
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, stage === "annotation");
  const loading = stage === "annotation" && !submissions.data && submissions.error == null;
  const lines = historyLines(row, submissions.data?.submissions ?? null, { me, now }).reverse().filter(line => line.stage === stage).slice(0, LATEST);
  const hasActions = actions != null && actions !== false;

  return <Popover open anchorRef={anchorRef} label={`${title} activity, ${rowName(row)}`} width={320} onClose={onClose}
    footer={<Button size="sm" onClick={onOpenDetails}>Open full details</Button>}>
    <div id={id} className="stage-popover">
      {loading ? <p className="stage-popover-empty">Loading activity…</p>
        : lines.length > 0
          ? <ul className="stage-popover-lines" aria-label={`Latest ${title.toLowerCase()} activity`}>
            {lines.map(line => <li key={line.key} className="stage-popover-line">{lineText(line.text, HISTORY_LINE_PREFIX[stage])}</li>)}
          </ul>
          : <p className="stage-popover-empty">{emptyActivityText(stage)}</p>}
      {hasActions && <div className="stage-popover-actions">{actions}</div>}
    </div>
  </Popover>;
}

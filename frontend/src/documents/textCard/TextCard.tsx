/**
 * Text card of the Documents page (U3, replaces the row panel): a centered modal card for one text. On top the
 * path Translation, Annotation, Finalization; below, the part of the selected segment with its people and
 * actions. History and Text details open inside the card with Back. ‹ › (J / K) step through the table
 * order; Esc and ✕ close it without changing the selection. Below 700 px it is a full-width sheet.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { DocumentRowView } from "../../api/client";
import { plural } from "../../app/labels";
import type { PanelStage, ProjectDocumentsQuery, Route } from "../../app/router";
import { Button } from "../../ui/Button";
import { Dialog, isTopDialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { IconChevronLeft, IconChevronRight } from "../../ui/icons";
import { LanguageTag } from "../../ui/LanguageTag";
import { useShortcut } from "../../ui/shortcuts";
import { StagePath } from "../../ui/StagePath";
import { useMediaQuery } from "../../ui/useMediaQuery";
import { historyLines } from "../historyLines";
import { isActiveRow } from "../stageLabels";
import { RouteLink, rowKeyOf } from "../RowCells";
import { RowActivity } from "../RowActivity";
import type { TextVersionsTools } from "../TextVersions";
import { useRowSubmissions } from "../useRowSubmissions";
import { AnnotationPart } from "./AnnotationPart";
import { CardFooter, TextDetails } from "./CardFooter";
import { cardSegments, defaultSegment, textViewRoute, type CardView, type SegmentId } from "./cardModel";
import { FinalizationPart } from "./FinalizationPart";
import { TranslationPart } from "./TranslationPart";
import "./textCard.css";

export interface TextCardProps {
  projectKey: string;
  row: DocumentRowView;
  /** Rows of the current table order, for ‹ ›. */
  rows: readonly DocumentRowView[];
  query: ProjectDocumentsQuery;
  /** From the route (panel_stage); default via defaultSegment. */
  segment?: SegmentId;
  /** From the route (panel_tab). */
  view?: CardView;
  onSegment: (segment: SegmentId) => void;
  onView: (view: CardView) => void;
  /** ‹ › previous/next row of the table order. */
  onStep: (direction: -1 | 1) => void;
  /** Never changes the selection. */
  onClose: () => void;
  onNavigate: (route: Route) => void;
  /** Task review only via Consolidate… (D1). */
  onAssign: (row: DocumentRowView, task: "translation_review" | "annotate") => void;
  onChangePlan: (row: DocumentRowView) => void;
  /** Switches the card to another text of the case (the "Other languages" list). */
  onOpenText?: (row: DocumentRowView) => void;
  /** Reload rows after remove. */
  onChanged: () => void;
  /** The existing DecisionBlock (Compare/Consolidate/Accept result). */
  decision?: ReactNode;
  textVersionTools?: TextVersionsTools;
  /** Lead. */
  canManage: boolean;
  me?: { username: string; pseudonym?: string | null } | null;
  now?: Date;
  /** Route of a problem report (banner, History, Text details). */
  reportRoute: (reportId: string) => Route;
  /** The row's plan chips (Text details). */
  plan?: ReactNode;
  /** Current plan revision of the case (Text details). */
  planRevision?: number;
  /** Admin actions of a stage (Reassign…, Reopen…, Assign a new review…, Change final…), under its part. */
  stageActions?: (stage: PanelStage) => ReactNode;
  /** Focus target when the card closes (asked at close time); default: the element focused on open. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** A notice on top of the card (the page's "Discard your unsaved choice?" before a row switch). */
  notice?: ReactNode;
  /** The row's lead steps that no part of the card offers (text changes, reports, Resolve…); the table row shows one button only. */
  steps?: ReactNode;
  /** The plan control of a step in its section header (Review On / Off, the annotation mode); planned texts only. */
  planControl?: (step: "review" | "annotation") => ReactNode;
}

/** "v2", plus ", newer than the annotations" when annotate work sits on an older version; null with one version. */
function versionWarning(row: DocumentRowView): string | null {
  if (row.versions.length <= 1) return null;
  const newest = Math.max(...row.versions.map(version => version.version));
  const older = row.work.some(item => item.task === "annotate" && item.version < newest);
  return `v${newest}${older ? ", newer than the annotations" : ""}`;
}

/** The case's other texts on this page: each switches the card; texts outside the plan say so and offer "Add to plan…". */
function OtherLanguages({ row, rows, canManage, onOpenText, onChangePlan }: Pick<TextCardProps, "row" | "rows" | "canManage" | "onChangePlan"> & { onOpenText: (row: DocumentRowView) => void }): JSX.Element | null {
  const others = rows.filter(entry => entry.case_id === row.case_id && entry.language !== row.language);
  if (!others.length) return null;
  return <div className="text-card-languages">
    <span id="text-card-languages-label" className="text-card-plan-label">Other languages</span>
    <ul className="text-card-language-list" aria-labelledby="text-card-languages-label">
      {others.map(entry => <li key={entry.language} className="text-card-language">
        <Button size="sm" aria-label={`Show ${entry.case_id} ${entry.language}`} onClick={() => onOpenText(entry)}>
          <LanguageTag code={entry.language} />{entry.is_source && <span className="text-card-muted">source</span>}
        </Button>
        {!isActiveRow(entry) && <><span className="text-card-muted">not in plan</span>
          {canManage && <Button size="sm" aria-label={`Add to plan…, ${entry.case_id} ${entry.language}`} onClick={() => onChangePlan(entry)}>Add to plan…</Button>}</>}
      </li>)}
    </ul>
  </div>;
}

/** Banners above the path: open problem reports and findings flagged "guidelines unclear" (X5). */
function Banners({ row, projectKey, query, reportRoute, onNavigate }: Pick<TextCardProps, "row" | "projectKey" | "query" | "reportRoute" | "onNavigate">): JSX.Element | null {
  const open = (row.problem_reports ?? []).filter(report => report.state === "open");
  const flagged = row.flagged_unclear ?? 0;
  if (!open.length && flagged <= 0) return null;
  const name = `${row.case_id} ${row.language}`;
  const roundId = row.flagged_round_id;
  return <div className="text-card-banners">
    {open.length > 0 && <p className="text-card-banner">
      {plural(open.length, "open problem report")}{", "}
      <RouteLink route={reportRoute(open[0].report_id)} className="btn btn-secondary btn-sm" onNavigate={onNavigate} aria-label={`Open problem report, ${open[0].title}`}>Open</RouteLink>
    </p>}
    {flagged > 0 && <p className="text-card-banner">
      {`${flagged === 1 ? "1 finding" : `${flagged} findings`} flagged: guidelines unclear`}
      {roundId && <>{", "}<RouteLink route={{ name: "projectConsolidation", key: projectKey, roundId, ...(row.flagged_group_id ? { group: row.flagged_group_id } : {}),
        ...(Object.keys(query).length ? { documents: query } : {}) }} className="btn btn-secondary btn-sm" onNavigate={onNavigate} aria-label={`Open flagged finding, ${name}`}>Open</RouteLink></>}
    </p>}
  </div>;
}

export function TextCard(props: TextCardProps): JSX.Element {
  const { projectKey, row, query, view = "path", onSegment, onView, onStep, onClose, onNavigate, canManage, now = new Date() } = props;
  const sheet = useMediaQuery("(max-width: 699px)");
  const segments = cardSegments(row, now);
  const segment = props.segment ?? defaultSegment(segments);
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, true);
  const list = submissions.data?.submissions ?? null;

  // A refreshed rows page with new activity on the row reloads its submissions.
  const activity = row.last_activity_at ?? "";
  const seenActivity = useRef(activity);
  const { reload } = submissions;
  useEffect(() => {
    if (seenActivity.current === activity) return;
    seenActivity.current = activity;
    reload();
  }, [activity, reload]);

  // Only while the card is the topmost dialog (not under "Remove assignment?" or the assign dialog).
  const nav = useRef<HTMLDivElement>(null);
  useShortcut(["j", "k"], event => {
    const card = nav.current?.closest<HTMLElement>('[role="dialog"]');
    if (!card || !isTopDialog(card)) return false;
    onStep(event.key.toLowerCase() === "j" ? 1 : -1);
  },
    { scope: "dialog", group: "Documents", description: "Next / previous text in the text card" });

  const warning = versionWarning(row);
  // Texts outside the plan get "Add to plan…" (the dialog), planned ones edit each step in place.
  const plannable = canManage && isActiveRow(row);
  const heading = <span className="text-card-heading">
    {row.case_id} <LanguageTag code={row.language} />{warning && <>{" "}<span className="text-card-version">{warning}</span></>}
  </span>;
  // "Open text": the text view, with the proposals layer shown when the text has tool proposals.
  const proposals = row.proposal_count ?? row.annotation_mode?.proposal_count ?? 0;
  const openText = <RouteLink route={textViewRoute(projectKey, row.case_id, row.open.document_id, query, proposals > 0 ? { show: "proposals" } : {})} onNavigate={onNavigate}
    className="btn btn-secondary btn-sm text-card-open-text" aria-label={`Open text, ${row.case_id} ${row.language}`}>Open text</RouteLink>;
  const back = <Button size="sm" onClick={() => onView("path")}>Back</Button>;

  let body: ReactNode;
  if (view === "history") {
    body = <div className="text-card-view">
      {back}
      <RowActivity row={row} projectKey={projectKey} submissions={list} onStage={() => {}} reportRoute={props.reportRoute} onNavigate={onNavigate} me={props.me?.pseudonym ?? null} now={now} />
    </div>;
  } else if (view === "details") {
    body = <div className="text-card-view">
      {back}
      <TextDetails row={row} data={submissions.data} plan={props.plan} planRevision={props.planRevision} reportRoute={props.reportRoute} onRoute={onNavigate} members={props.textVersionTools?.members} now={now} />
    </div>;
  } else {
    // Row-keyed parts drop their busy/error state on ‹ ›; the finalization part is not keyed, so the decision
    // block's "saved, next" message survives its automatic move to the next row.
    body = <>
      <Banners {...props} />
      {props.onOpenText && <OtherLanguages row={row} rows={props.rows} canManage={canManage} onOpenText={props.onOpenText} onChangePlan={props.onChangePlan} />}
      {props.steps && <div className="text-card-actions">{props.steps}</div>}
      <StagePath segments={segments} current={segment} onSelect={id => onSegment(id as SegmentId)} />
      {!isActiveRow(row) && <div className="text-card-not-planned">
        <p>This text is not worked on.</p>
        {canManage && <Button variant="primary" size="sm" onClick={() => props.onChangePlan(row)}>Add to plan…</Button>}
      </div>}
      {segment === "translation" && <><TranslationPart key={rowKeyOf(row)} row={row} projectKey={projectKey} query={query} canManage={canManage}
        onAssign={props.onAssign} onNavigate={onNavigate} onChanged={props.onChanged} textVersionTools={props.textVersionTools} now={now}
        planControl={plannable ? props.planControl?.("review") : undefined} />{props.stageActions && <div className="text-card-actions">{props.stageActions("review")}</div>}</>}
      {segment === "annotation" && <><AnnotationPart key={rowKeyOf(row)} row={row} projectKey={projectKey} query={query} submissions={list} canManage={canManage}
        onAssign={props.onAssign} onNavigate={onNavigate} onChanged={props.onChanged} tools={props.textVersionTools} now={now}
        planControl={plannable ? props.planControl?.("annotation") : undefined} />{props.stageActions && <div className="text-card-actions">{props.stageActions("annotation")}</div>}</>}
      {segment === "finalization" && <><FinalizationPart row={row} projectKey={projectKey} query={query} decision={props.decision} onNavigate={onNavigate} now={now}
        canManage={canManage} tools={props.textVersionTools} onChanged={props.onChanged} />{props.stageActions && <div className="text-card-actions">{props.stageActions("final")}</div>}</>}
    </>;
  }

  // The sheet's header has room for ‹ › only: "Open text" leads the body there.
  body = <>{props.notice}{sheet && <div className="text-card-actions">{openText}</div>}{body}</>;
  return <Dialog open title={`${row.case_id} ${row.language}`} heading={heading} variant="center" size="lg" closeOnBackdrop onClose={onClose} returnFocus={props.returnFocus}
    className={sheet ? "text-card text-card--sheet" : "text-card"}>
    <div ref={nav} className="text-card-nav">
      {!sheet && openText}
      <IconButton label="Previous text" icon={<IconChevronLeft />} variant="quiet" size="sm" aria-keyshortcuts="K" onClick={() => onStep(-1)} />
      <IconButton label="Next text" icon={<IconChevronRight />} variant="quiet" size="sm" aria-keyshortcuts="J" onClick={() => onStep(1)} />
    </div>
    <div className="text-card-body">{body}</div>
    {view === "path" && <CardFooter historyCount={list ? historyLines(row, list, { now }).length : null}
      onHistory={() => onView("history")} onDetails={() => onView("details")} />}
  </Dialog>;
}

/**
 * Row panel of the Documents page (acceptance fixes WP-A, U1, U10, U11): one non-modal `aside` for one
 * text row, opened from the text name (everything) or a stage cell (Activity filtered to that stage).
 * From 700 px it sits on the right below the shell header, over the page without moving it (nothing
 * becomes `inert`, nothing is dimmed); below 700 px it is a full-screen sheet. Content: header with
 * Previous / Next (J / K) and Close, the stage strip, the decision block when the lead must decide,
 * banners, and the tabs Activity · Versions (n) · Details. Previous / Next keep the tab and the stage
 * filter and swap the content without remounting the frame.
 */
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { AssignmentView, DocumentRowView, RowSubmissions } from "../api/client";
import { AssignmentActions } from "../admin/AssignmentActions";
import { plural } from "../app/labels";
import { Time } from "../app/Time";
import type { PanelStage, PanelTab, ProjectDocumentsQuery, Route } from "../app/router";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { IconClose } from "../ui/icons";
import { InlineConfirm } from "../ui/InlineConfirm";
import { useShortcut } from "../ui/shortcuts";
import { NOT_PLANNED, versionName } from "./labels";
import { RowActivity } from "./RowActivity";
import { chainNames, displayedVersion, documentsRowId, RouteLink, rowKeyOf, rowName } from "./RowCells";
import { StageStrip } from "./StageStrip";
import { isActiveRow } from "./stageLabels";
import { acceptanceLabel, acceptanceOf, discardLabel, isDiscarded, TextVersions, type TextVersionsTools } from "./TextVersions";
import { useRowSubmissions } from "./useRowSubmissions";
import { caseOfTextKey, languageOfTextKey } from "./useTextSelection";

/** Report state words of the Details list (same words as `reportStateBadge`). */
const REPORT_STATE_TEXT = { open: "Open", resolved: "Closed", withdrawn: "Withdrawn" } as const;

/** Tabs in order with their visible names. */
const TABS: readonly (readonly [PanelTab, string])[] = [["activity", "Activity"], ["versions", "Versions"], ["details", "Details"]];

export type AssignTaskKind = "translation_review" | "annotate" | "review";

/** Where the panel goes next: another row, another stage filter or another tab. */
export interface RowPanelTarget {
  key: string;
  stage?: PanelStage;
  tab?: PanelTab;
}

/** A row switch waiting for "Discard your unsaved choice?". */
export interface PendingSwitch {
  /** "case-109 · de" */
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface RowPanelProps {
  projectKey: string;
  /** "{case}:{language}" (route parameter `panel`). */
  rowKey: string;
  /** The row on the current page; null when it is not in this list. */
  row: DocumentRowView | null;
  /** The visible table rows in order (Previous / Next); group header rows are not in it. */
  rows: readonly DocumentRowView[];
  stage?: PanelStage;
  tab?: PanelTab;
  /** Current Documents query; editor links keep it so Back returns to the panel. */
  query: ProjectDocumentsQuery;
  /** Show another row, stage filter or tab (route parameters `panel`, `panel_stage`, `panel_tab`). */
  onNavigate: (target: RowPanelTarget) => void;
  /** In-app links (editor, problem reports). */
  onRoute: (route: Route) => void;
  onClose: () => void;
  /** The control that opened the panel; it gets focus back on Close and Escape. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** A new value moves focus to the panel heading (another entry point was used). */
  focusRequest?: number;
  /** Extra banners above the tabs (flags banner, WP-B). */
  banner?: ReactNode;
  /** Renders "Back" in the sheet (A3: back to the stage popover). */
  onBack?: () => void;
  /** Below 700 px: the full-screen sheet. */
  narrow?: boolean;
  /** The decision block (`DecisionBlock`) when the lead must decide; null otherwise. */
  decision?: ReactNode;
  /** Source language of the case (Review wording). */
  sourceLanguage?: string | null;
  textVersionTools?: TextVersionsTools;
  /** The row's plan chips (Details, and "Plan…" of a row outside the plan). */
  plan?: ReactNode;
  /** Current plan revision of the case (Details). */
  planRevision?: number;
  /** Assign dialog for this row ("Assign annotation review…", D25 "Assign a new review…"). */
  onAssign?: (row: DocumentRowView, task: AssignTaskKind, options?: { newReviewOfAccepted?: boolean }) => void;
  /** "Request correction…" (D26); offered when `canRequestCorrection` says so. */
  onRequestCorrection?: (row: DocumentRowView) => void;
  canRequestCorrection?: (row: DocumentRowView) => boolean;
  /** "Change final…" of a decided row without a final decision (the decision block opens on its compare content). */
  onChangeFinal?: (row: DocumentRowView) => void;
  canChangeFinal?: (row: DocumentRowView) => boolean;
  /** Route of a problem report. */
  reportRoute: (reportId: string) => Route;
  /** A row switch waits for the discard confirmation. */
  pendingSwitch?: PendingSwitch | null;
  /** Pseudonym of the signed-in lead ("Final: chosen by you"). */
  me?: string | null;
  now?: Date;
}

/** A submitted annotation on the current text can get an annotation review ("Assign annotation review…"). */
export function canAssignAnnotationReview(row: DocumentRowView): boolean {
  return row.work.some(item => item.task === "annotate" && item.status === "submitted" && item.moved_to_version == null);
}

/** D25: a new review of a translation the lead (or the import override) accepted without one. */
export function canAssignNewReview(row: DocumentRowView): boolean {
  return !row.is_source
    && !row.work.some(item => item.task === "translation_review" && item.status !== "submitted" && item.moved_to_version == null)
    && row.versions.some(version => version.is_newest_in_chain && !isDiscarded(row, version) && version.translation_status === "accepted"
      && (acceptanceOf(version)?.source === "lead" || acceptanceOf(version)?.source === "override"));
}

/** "v2", or "2 translations" with parallel roots (the heading's version). */
function headingVersion(row: DocumentRowView | null): string | null {
  if (!row) return null;
  const shown = displayedVersion(row);
  if (shown) return versionName(shown.version, shown.chain_name, false);
  const chains = chainNames(row).length;
  return chains > 1 ? `${chains} translations` : null;
}

/** Polite announcements of the panel (row switches, "First row" / "Last row"). */
function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    message,
    announce: (text: string) => {
      window.clearTimeout(timer.current);
      setMessage("");
      timer.current = window.setTimeout(() => setMessage(text), 0);
    },
  };
}

export function RowPanel(props: RowPanelProps): JSX.Element {
  const { rowKey, row, rows, stage, tab = "activity", onNavigate, onClose, returnFocusRef, narrow = false, onBack, focusRequest } = props;
  const name = `${caseOfTextKey(rowKey)} · ${languageOfTextKey(rowKey)}`;
  const version = headingVersion(row);
  const aside = useRef<HTMLElement>(null);
  const heading = useRef<HTMLElement>(null);
  const headingId = useId();
  const { message, announce } = useAnnouncer();
  const index = rows.findIndex(entry => rowKeyOf(entry) === rowKey);
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null;

  /** The row an entry point opened; after J / K (another row shown) Close returns to the shown row's name instead. */
  const openedFor = useRef(rowKey);
  const close = () => {
    const target = openedFor.current === rowKey ? returnFocusRef?.current : null;
    onClose();
    window.setTimeout(() => {
      const fallback = document.getElementById(documentsRowId(caseOfTextKey(rowKey), languageOfTextKey(rowKey), "header"));
      (target?.isConnected ? target : fallback)?.focus();
    }, 0);
  };
  const go = (delta: 1 | -1) => {
    const target = delta > 0 ? next : previous;
    if (!target) { announce(delta > 0 ? "Last row" : "First row"); return; }
    onNavigate({ key: rowKeyOf(target), stage, tab });
  };

  // The aside starts below the AppShell header (account and navigation stay reachable); once the header
  // scrolls away it reaches the top of the viewport.
  useLayoutEffect(() => {
    const element = aside.current;
    if (narrow || !element) return;
    const place = () => {
      const header = document.querySelector(".shell-header");
      element.style.setProperty("--row-panel-top", `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [narrow]);

  // Focus the heading on open and whenever another entry point opens the panel (not when the width crosses 700 px).
  useLayoutEffect(() => {
    openedFor.current = rowKey;
    if (!narrow) heading.current?.focus();
    // Only an open request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // A row switch is announced once the header shows the new row.
  const shown = useRef(rowKey);
  useEffect(() => {
    if (shown.current === rowKey) return;
    shown.current = rowKey;
    announce(`Showing ${name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  // J / K walk the visible rows (never while typing; not under a modal dialog).
  useShortcut(["j", "k"], event => { go(event.key.toLowerCase() === "j" ? 1 : -1); },
    { group: "Documents", description: "Next / previous row in the details panel", enabled: !narrow });
  // Escape closes only while focus is inside the panel; elsewhere the page's own Escape handling runs.
  useShortcut("Escape", event => {
    if (!aside.current || !(event.target instanceof Node) || !aside.current.contains(event.target)) return false;
    close();
  }, { allowInInputs: true, enabled: !narrow, root: aside });

  const navButton = (delta: 1 | -1) => {
    const target = delta > 0 ? next : previous;
    const label = delta > 0 ? "Next" : "Previous";
    return <Button size="sm" aria-disabled={target ? undefined : true} aria-keyshortcuts={delta > 0 ? "J" : "K"}
      aria-label={target ? `${label}: ${rowName(target)}` : `${label} row`} onClick={() => go(delta)}>{label}</Button>;
  };
  const headingText = <>{name}{version && <>{" "}<span className="row-panel-version">{version}</span></>}</>;
  const body = <RowPanelBody {...props} name={name} tab={tab} />;
  const status = <p className="visually-hidden" role="status" aria-live="polite">{message}</p>;

  if (narrow) {
    return <Dialog open title={`Details, ${name}`} className="row-panel-sheet" onClose={close} initialFocus={heading}
      returnFocus={() => returnFocusRef?.current ?? null}
      heading={<span ref={heading} id={headingId} tabIndex={-1} className="row-panel-heading-target">{headingText}</span>}>
      <div className="row-panel row-panel--sheet">
        <div className="row-panel-nav">
          <Button size="sm" onClick={() => (onBack ?? close)()}>Back</Button>
          {navButton(-1)}{navButton(1)}
        </div>
        {status}
        {body}
      </div>
    </Dialog>;
  }
  return <aside ref={aside} className="row-panel" aria-label={`Details, ${name}`}>
    <div className="row-panel-header">
      <h2 ref={heading as RefObject<HTMLHeadingElement>} id={headingId} tabIndex={-1} className="row-panel-heading row-panel-heading-target">{headingText}</h2>
      <div className="row-panel-nav">
        {navButton(-1)}{navButton(1)}
        <IconButton label="Close" icon={<IconClose />} variant="quiet" size="sm" onClick={close} />
      </div>
    </div>
    {status}
    {body}
  </aside>;
}

/** The panel's content below the header; the frame and the decision block stay mounted across row switches. */
function RowPanelBody(props: RowPanelProps & { name: string; tab: PanelTab }): JSX.Element {
  const { row, name, stage, tab, onNavigate, rowKey, pendingSwitch, decision, banner, sourceLanguage, plan, reportRoute, onRoute } = props;
  const tabsId = useId();
  const tabList = useRef<HTMLDivElement>(null);
  /** "Plan…" of a row outside the plan: Details with focus on its plan chips. */
  const [focusPlan, setFocusPlan] = useState(false);

  const confirm = pendingSwitch && <InlineConfirm title="Discard your unsaved choice?" headingLevel={3}
    message={`The consolidation you were setting up is not saved. Show ${pendingSwitch.name} anyway?`}
    confirmLabel="Discard" cancelLabel="Keep editing" onConfirm={pendingSwitch.onConfirm} onCancel={pendingSwitch.onCancel} />;
  if (!row) return <div className="row-panel-body">{confirm}{decision ?? <p>{`${name} is not in this list.`}</p>}</div>;

  const setStage = (value: PanelStage | undefined) => onNavigate({ key: rowKey, stage: value, tab: value ? "activity" : tab });
  const setTab = (value: PanelTab) => onNavigate({ key: rowKey, stage, tab: value });
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    const target = event.key === "ArrowRight" ? (position + 1) % TABS.length
      : event.key === "ArrowLeft" ? (position - 1 + TABS.length) % TABS.length
        : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    setTab(TABS[target][0]);
    tabList.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[target]?.focus();
  };
  const openReports = (row.problem_reports ?? []).filter(report => report.state === "open");
  const flags = <FlagsBanner row={row} projectKey={props.projectKey} name={name} query={props.query} onRoute={onRoute} />;
  const flagged = (row.flagged_unclear ?? 0) > 0;

  return <div className="row-panel-body">
    {confirm}
    <StageStrip row={row} sourceLanguage={sourceLanguage} stage={stage} onSelect={setStage} />
    {!isActiveRow(row) && <div className="row-panel-not-planned">
      <p><strong>{NOT_PLANNED}</strong>{plan != null && <>{" "}<Button size="sm" onClick={() => { setFocusPlan(true); setTab("details"); }}>Plan…</Button></>}</p>
    </div>}
    {decision}
    {(openReports.length > 0 || flagged || banner != null) && <div className="row-panel-banners">
      {openReports.length > 0 && <p className="row-panel-banner">
        {plural(openReports.length, "open problem report")}{" · "}
        <RouteLink route={reportRoute(openReports[0].report_id)} className="btn btn-secondary btn-sm" onNavigate={onRoute} aria-label={`Open problem report, ${openReports[0].title}`}>Open</RouteLink>
      </p>}
      {flags}
      {banner}
    </div>}
    <div ref={tabList} role="tablist" aria-label={`Details of ${name}`} className="row-panel-tabs">
      {TABS.map(([id, label], position) => <button key={id} type="button" role="tab" id={`${tabsId}-${id}`} aria-selected={tab === id}
        aria-controls={`${tabsId}-panel`} tabIndex={tab === id ? 0 : -1} className="row-panel-tab"
        onClick={() => setTab(id)} onKeyDown={event => onTabKey(event, position)}>
        {id === "versions" ? `${label} (${row.versions.length})` : label}
      </button>)}
    </div>
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="row-panel-tabpanel">
      <RowTabContent key={rowKey} {...props} row={row} setStage={setStage} focusPlan={focusPlan} onPlanFocused={() => setFocusPlan(false)} />
    </div>
  </div>;
}

/**
 * X5: "1 finding flagged: guidelines unclear · Open", linked to the (read-only) consolidation view at the
 * flagged group (`?group=` only when the row names one); nothing without flags.
 */
function FlagsBanner({ row, projectKey, name, query, onRoute }: { row: DocumentRowView; projectKey: string; name: string; query?: ProjectDocumentsQuery; onRoute: (route: Route) => void }): JSX.Element | null {
  const count = row.flagged_unclear ?? 0;
  if (count <= 0) return null;
  const text = `${count === 1 ? "1 finding" : `${count} findings`} flagged: guidelines unclear`;
  const roundId = row.flagged_round_id;
  return <p className="row-panel-banner">
    {text}
    {roundId && <>{" · "}<RouteLink route={{ name: "projectConsolidation", key: projectKey, roundId, ...(row.flagged_group_id ? { group: row.flagged_group_id } : {}),
      ...(query && Object.keys(query).length ? { documents: query } : {}) }}
      className="btn btn-secondary btn-sm" onNavigate={onRoute} aria-label={`Open flagged finding, ${name}`}>Open</RouteLink></>}
  </p>;
}

/** The selected tab of one row; keyed by the row, so a switch starts with "Loading {row}…" until its submissions arrive. */
function RowTabContent(props: RowPanelProps & {
  row: DocumentRowView; name: string; tab: PanelTab; setStage: (stage: PanelStage | undefined) => void; focusPlan: boolean; onPlanFocused: () => void;
}): JSX.Element {
  const { projectKey, row, name, stage, tab, rowKey, plan, reportRoute, onRoute, setStage } = props;
  const submissions = useRowSubmissions(projectKey, caseOfTextKey(rowKey), languageOfTextKey(rowKey), true);
  // A refreshed rows page with new activity on the row reloads its submissions.
  const activity = row.last_activity_at ?? "";
  const seenActivity = useRef(activity);
  const { reload } = submissions;
  useEffect(() => {
    if (seenActivity.current === activity) return;
    seenActivity.current = activity;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);
  // Until the row's submissions (or their failure) arrive; the hook's first state is not loading yet.
  const loading = !submissions.data && (submissions.loading || submissions.error == null);
  if (loading) return <p className="row-panel-loading">{`Loading ${name}…`}</p>;
  if (tab === "versions") return <TextVersions row={row} projectKey={projectKey} query={props.query} onNavigate={onRoute} tools={props.textVersionTools} now={props.now} />;
  if (tab === "details") return <RowDetails row={row} data={submissions.data} planRevision={props.planRevision} plan={plan} reportRoute={reportRoute} onRoute={onRoute}
    members={props.textVersionTools?.members} now={props.now} focusPlan={props.focusPlan} onPlanFocused={props.onPlanFocused} />;
  return <RowActivity row={row} projectKey={projectKey} submissions={submissions.data?.submissions ?? null} stage={stage} onStage={setStage}
    reportRoute={reportRoute} onNavigate={onRoute} actions={<StageActions {...props} row={row} />} me={props.me} now={props.now} />;
}

/** What the stage actions need: the row panel's props, or the cards' stage popover. */
export type StageActionsProps = Pick<RowPanelProps, "stage" | "onAssign" | "onRequestCorrection" | "canRequestCorrection" | "onChangeFinal" | "canChangeFinal" | "textVersionTools"> & {
  row: DocumentRowView;
};

/**
 * Admin actions of the filtered stage, or of every stage: Annotation "Reassign…" (one direct button per open
 * task, S3), "Assign annotation review…"; Review "Request correction…", "Assign a new review…"; Final
 * "Change final…" of a decided row. Also the actions of the cards' stage popover.
 */
export function StageActions({ row, stage, onAssign, onRequestCorrection, canRequestCorrection, onChangeFinal, canChangeFinal, textVersionTools }: StageActionsProps): JSX.Element | null {
  const show = (name: PanelStage) => !stage || stage === name;
  const documents = new Set(row.versions.map(version => version.document_id));
  const workIds = new Set(row.work.filter(item => item.task !== "translation_review" && item.status !== "submitted" && item.moved_to_version == null).map(item => item.assignment_id));
  const reassignable: AssignmentView[] = show("annotation") && textVersionTools
    ? textVersionTools.assignments.filter(assignment => workIds.has(assignment.id) && documents.has(assignment.document_id) && !assignment.revoked_at) : [];
  const review = show("annotation") && onAssign && canAssignAnnotationReview(row);
  const correction = show("review") && onRequestCorrection && canRequestCorrection?.(row);
  const newReview = show("review") && onAssign && canAssignNewReview(row);
  const changeFinal = show("final") && onChangeFinal && canChangeFinal?.(row);
  if (!reassignable.length && !review && !correction && !newReview && !changeFinal) return null;
  const personOf = (pseudonym: string) => {
    const display = textVersionTools?.members.find(member => member.pseudonym === pseudonym)?.display_name?.trim();
    return display ? `${display} (${pseudonym})` : pseudonym;
  };
  return <>
    {reassignable.map(assignment => <div key={assignment.id} className="row-panel-reassign">
      <span>{personOf(assignment.pseudonym)}</span>
      {textVersionTools && <AssignmentActions assignment={assignment} members={textVersionTools.members} onChanged={textVersionTools.onAssignmentsChanged} directReassign />}
    </div>)}
    {review && <Button size="sm" onClick={() => onAssign(row, "review")}>Assign annotation review…</Button>}
    {correction && <Button size="sm" onClick={() => onRequestCorrection(row)}>Request correction…</Button>}
    {newReview && <Button size="sm" onClick={() => onAssign(row, "translation_review", { newReviewOfAccepted: true })}>Assign a new review…</Button>}
    {changeFinal && <Button size="sm" onClick={() => onChangeFinal(row)}>Change final…</Button>}
  </>;
}

/** Details tab: plan, technical details (IDs, acceptance, discard) and the row's problem reports. */
function RowDetails({ row, data, planRevision, plan, reportRoute, onRoute, members, now, focusPlan = false, onPlanFocused }: {
  row: DocumentRowView; data: RowSubmissions | null; planRevision?: number; plan?: ReactNode; reportRoute: (reportId: string) => Route;
  onRoute: (route: Route) => void; members?: TextVersionsTools["members"]; now?: Date; focusPlan?: boolean; onPlanFocused?: () => void;
}): JSX.Element {
  const id = useId();
  const planGroup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusPlan) return;
    planGroup.current?.querySelector<HTMLElement>("button")?.focus();
    onPlanFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlan]);
  const reports = row.problem_reports ?? [];
  const personOf = (label: string) => members?.find(member => member.pseudonym === label)?.display_name?.trim() || label;
  return <div className="row-panel-details">
    {plan != null && <div ref={planGroup} className="row-panel-plan" role="group" aria-labelledby={`${id}-plan`}>
      <span id={`${id}-plan`} className="row-panel-plan-label">Plan</span>{plan}
    </div>}
    {reports.length > 0 && <section aria-labelledby={`${id}-reports`}>
      <h3 id={`${id}-reports`} className="row-panel-subheading">{`Problem reports (${reports.length})`}</h3>
      <ul className="row-activity-lines">{reports.map(report => <li key={report.report_id}>
        {report.title}{" · "}{personOf(report.reporter_label)}{" · "}<Time iso={report.created_at} now={now} />
        {" · "}Report: {REPORT_STATE_TEXT[report.state]}{" · "}Paused tasks: {report.active_hold_count}{" · "}
        <RouteLink route={reportRoute(report.report_id)} onNavigate={onRoute}>Open report</RouteLink>
      </li>)}</ul>
    </section>}
    <section aria-labelledby={`${id}-technical`}>
      <h3 id={`${id}-technical`} className="row-panel-subheading">Technical details</h3>
      <dl className="technical-details">
        <dt>Text ID</dt><dd>{row.case_id}</dd>
        {planRevision != null && <><dt>Plan revision</dt><dd>{planRevision}</dd></>}
        {row.versions.map(version => {
          const name = versionName(version.version, version.chain_name, row.parallel_roots);
          const acceptance = acceptanceOf(version);
          return <Fragment key={version.document_id}>
            <dt>{`Document ID, ${name}`}</dt><dd>{version.document_id}</dd>
            {acceptance && <><dt>{`Acceptance, ${name}`}</dt><dd>{acceptanceLabel(acceptance, now)}</dd></>}
            {isDiscarded(row, version) && <><dt>{`Discard, ${name}`}</dt><dd>{discardLabel(version, now)}</dd></>}
          </Fragment>;
        })}
        {(data?.submissions ?? []).map(item => <Fragment key={item.submission_id}>
          <dt>{`Submission ID, ${item.author_label}`}</dt>
          <dd>{`${item.submission_id}${item.round_id ? ` · round ${item.round_id}` : ""} · mode ${item.mode}`}</dd>
        </Fragment>)}
        {(data?.rounds ?? []).filter(round => !round.submitted).map(round => <Fragment key={round.round_id}>
          <dt>{`Round ID, ${round.author_label}`}</dt><dd>{`${round.round_id} · mode ${round.mode}`}</dd>
        </Fragment>)}
      </dl>
    </section>
  </div>;
}

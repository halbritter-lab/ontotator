import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api,
  type AssignmentView,
  type DocumentRowFilters,
  type CaseSummary,
  type CurrentUser,
  type DocumentRowView,
  type DocumentRowsPage,
  type DocumentRowsQuery,
  type DocumentRowsRequest,
  type Member,
  type NextStepView,
  type ProjectDocumentSummary,
  type ProjectSettings,
  type RowSubmissions,
  type TranslationReviewRecord,
  type VariantSummary,
} from "../api/client";
import { formatDateTime, labelFor, plural } from "../app/labels";
import { routeHref, type NavigateOptions, type ProjectDocumentsQuery, type Route } from "../app/router";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { submissionGuidelineLabel } from "../guidelines/submissionLabel";
import { Button, Checkbox, Dialog, EmptyState, InlineMessage, Select, StatusBadge, TextInput, Toast, Toolbar, useMediaQuery, useToast, type GroupSelectMode } from "../ui";
import { DecisionBar } from "../documents/DecisionBar";
import { DocumentCards } from "../documents/DocumentCards";
import { DocumentsTable, type HeaderSort, type TableSelection } from "../documents/DocumentsTable";
import { ExpandedRow, submissionsHeadingId, type ExpandedRowProps, type SelectFinalRequest } from "../documents/ExpandedRow";
import {
  barChanges, failureOf, FinalConfirm, keepRequest, selectionPayload, selectRequest, successMessage,
  type FinalConfirmFailure, type FinalConfirmRequest,
} from "../documents/FinalConfirm";
import { STEP_FILTER_GROUPS, STEP_LABELS, stepLabel } from "../documents/nextStepLabels";
import { PlanChips, PlanRowNotice, usePlanSaves } from "../documents/PlanChips";
import { useShortcut, useShortcutHint } from "../ui/shortcuts";
import { LeadCorrectionContext, type LeadCorrectionHost } from "../documents/LeadCorrectionPanel";
import { ResolveTranslation } from "../documents/ResolveTranslation";
import { SelectByIdsDialog } from "../documents/SelectByIdsDialog";
import { SelectionBar } from "../documents/SelectionBar";
import { acknowledgeableItems, type KeepRequest } from "../documents/SelectionNotice";
import { documentsGroupId, documentsRowId, isPlainClick, RouteLink, rowKeyOf, rowName } from "../documents/RowCells";
import { plannedStages, stageBlockHeadingId } from "../documents/StageBlocks";
import type { TextVersionsTools } from "../documents/TextVersions";
import { workText } from "../documents/labels";
import { MAX_SELECTION_CASES as MAX_SELECTION, textKeyOf, useTextSelection } from "../documents/useTextSelection";
import { useDocumentRows } from "../documents/useDocumentRows";
import { useRowSubmissions } from "../documents/useRowSubmissions";
import { clearVisits, recordDecision, rememberShown, retainedKeys, rowBadges, type RowBadge } from "../documents/visitState";
import { notifyFinalSelectionChanged } from "../variants/finalSelectionState";
import { AssignWorkDialog, type AssignWorkDialogProps } from "./AssignWorkDialog";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";
import { originLabels, reviewLanguages, translationStatusLabels } from "./variantMetadata";

export interface DocumentsPageProps {
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route, options?: NavigateOptions) => void;
  /** Lead access (`ProjectSummary.can_manage`); checked before anything loads. */
  canManage: boolean;
  canOverrideTranslationStatus?: boolean;
  currentUser?: Pick<CurrentUser, "username" | "pseudonym">;
}

/** Narrow viewports render cards instead of the table. */
export const NARROW_DOCUMENTS_QUERY = "(max-width: 700px)";

export const STATUS_OPTIONS: readonly (readonly [NonNullable<DocumentRowsQuery["status"]>, string])[] = [
  ["unassigned", "Unassigned"], ["open", "Open"], ["in_progress", "In progress"],
  ["submitted", "Submitted"], ["reopened", "Reopened"], ["held", "Paused"],
];
const TRANSLATION_STATUS_OPTIONS: readonly (readonly [string, string])[] = [
  ...Object.entries(translationStatusLabels), ["accepted_without_review", "Accepted without review"],
];
export const PLAN_OPTIONS: readonly (readonly [NonNullable<DocumentRowsQuery["plan"]>, string])[] = [
  ["review", "Review"], ["annotate", "Annotate"], ["review_and_annotate", "Review and annotate"], ["not_in_plan", "Not in plan"],
];
export const SORT_OPTIONS: readonly (readonly [NonNullable<DocumentRowsQuery["sort"]>, string])[] = [
  ["case", "Case ID"], ["import", "Import batch"], ["activity", "Last activity"],
];
const DECISIONS = new Set(["all", "report-or-pause", "confirm-final", "translation", "missing-final"]);
const SEGMENTS = new Set(["decision", "assign", "progress"]);
const STAGE_LABELS: Readonly<Record<string, string>> = { translation_review: "Translation review", annotation: "Annotation", final: "Final result", done: "Done" };
const DOCUMENT_FIELDS = [
  "language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final",
  "segment", "step", "stage", "owner", "plan", "paused", "sort", "page",
] as const;
/** The ID filter applies this long after the last keystroke (or at once on Enter and blur). */
export const ID_FILTER_DELAY_MS = 300;
/** The table's eight columns; "Select" and "Action" headers are visually hidden. */
const SKELETON_HEADERS: readonly (readonly [string, boolean])[] = [
  ["Select", true], ["Text", false], ["Review", false], ["Annotation", false], ["Final", false], ["Waiting on", false], ["Action", true], ["Last activity", false],
];
/** Server sorts: the Sort select offers the ascending ones; the Text and Last activity headers also set "-case" and "-activity" (VD10). */
const SORT_VALUES: ReadonlySet<string> = new Set(["case", "-case", "import", "activity", "-activity"]);

/** The Documents fields of a route (the page receives the whole route as `query`). */
function documentsQuery(query: ProjectDocumentsQuery): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) if (query[field] !== undefined && query[field] !== "") result[field] = query[field];
  if (query.open?.length) result.open = [...query.open];
  return result;
}

/** The known values of a comma-joined route filter: one value as is, several as a list (OR), none as undefined. */
function listFilter<Value extends string>(value: string | undefined, known: (item: string) => boolean): Value | Value[] | undefined {
  const values = [...new Set((value ?? "").split(",").filter(known))] as Value[];
  return values.length > 1 ? values : values[0];
}

/** The values of a list filter (one value or several). */
function valuesOf<Value>(value: Value | Value[] | null | undefined): Value[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/**
 * Server query for the rows endpoint; unknown values are dropped. `segment` wins over `decision`;
 * a decision filter wins over every `final` filter (the API takes one of them). `step`, `stage` and
 * `plan` are comma-joined in the route (Progress links) and sent as lists.
 */
export function rowsQuery(query: ProjectDocumentsQuery): DocumentRowsRequest {
  const result: DocumentRowsRequest = {};
  if (query.language) result.language = query.language;
  if (STATUS_OPTIONS.some(([value]) => value === query.status)) result.status = query.status as DocumentRowsQuery["status"];
  if (query.q) result.q = query.q;
  if (query.origin && Object.hasOwn(originLabels, query.origin)) result.origin = query.origin as DocumentRowsQuery["origin"];
  if (TRANSLATION_STATUS_OPTIONS.some(([value]) => value === query.translation_status)) result.translation_status = query.translation_status as DocumentRowsQuery["translation_status"];
  if (query.segment && SEGMENTS.has(query.segment)) result.segment = query.segment as DocumentRowsQuery["segment"];
  else if (query.decision && DECISIONS.has(query.decision)) result.decision = query.decision as DocumentRowsQuery["decision"];
  if (result.decision === undefined && (query.final === "none" || query.final === "any" || query.final === "missing")) result.final = query.final;
  const step = listFilter<NonNullable<DocumentRowsQuery["step"]>>(query.step, item => Object.hasOwn(STEP_LABELS, item));
  if (step !== undefined) result.step = step;
  const stage = listFilter<NonNullable<DocumentRowsQuery["stage"]>>(query.stage, item => Object.hasOwn(STAGE_LABELS, item));
  if (stage !== undefined) result.stage = stage;
  if (query.owner) result.owner = query.owner;
  const plan = listFilter<NonNullable<DocumentRowsQuery["plan"]>>(query.plan, item => PLAN_OPTIONS.some(([value]) => value === item));
  if (plan !== undefined) result.plan = plan;
  if (query.paused === "yes" || query.paused === "no") result.paused = query.paused;
  if (query.sort && query.sort !== "case" && SORT_VALUES.has(query.sort)) result.sort = query.sort as DocumentRowsQuery["sort"];
  if (query.case) result.case = query.case;
  const page = Number(query.page);
  if (Number.isInteger(page) && page > 1) result.page = page;
  return result;
}

/** The Documents filters for the selection summary and the batch assign dialog: every filter except paging, sort and retain. */
export function selectionFilters(request: DocumentRowsRequest): DocumentRowFilters {
  // The batch filters take one language and one origin, no Done tab and no facets yet (row-level
  // bulk: O0d); the route still holds at most one language and one origin and no Done tab.
  const { page: _page, sort: _sort, retain: _retain, language, origin, segment, review_state: _review, annotation_state: _annotation, final_state: _final, waiting_on: _waiting, ...filters } = request;
  const result: DocumentRowFilters = { ...filters };
  const [firstLanguage] = valuesOf(language);
  const [firstOrigin] = valuesOf(origin);
  if (firstLanguage !== undefined) result.language = firstLanguage;
  if (firstOrigin !== undefined) result.origin = firstOrigin;
  if (segment != null && segment !== "done") result.segment = segment;
  return result;
}

/** The batch dialog's case order: descending orders fall back to their ascending order. */
function batchSort(sort: DocumentRowsRequest["sort"]): "case" | "import" | "activity" {
  if (sort === "-case" || sort == null) return "case";
  return sort === "-activity" ? "activity" : sort;
}

/** "Selection is limited to 2000 cases. Selected the first 2000." (texts of at most 2000 cases, VD4) */
export const SELECTION_LIMITED = `Selection is limited to ${MAX_SELECTION} cases. Selected the first ${MAX_SELECTION}.`;

const caseOfKey = (key: string): string => key.slice(0, Math.max(0, key.lastIndexOf(":")));
const languageOfKey = (key: string): string => key.slice(key.lastIndexOf(":") + 1);
const nameOfKey = (key: string): string => `${caseOfKey(key)} · ${languageOfKey(key)}`;
const rowElement = (key: string, part: "disclosure" | "final-view" | "action"): HTMLElement | null =>
  document.getElementById(documentsRowId(caseOfKey(key), languageOfKey(key), part));

/** A row action that needs the row's submissions; it runs once they are loaded (Choose final…, Review changes…). */
export interface AutoAction { rowKey: string; kind: "choose_final" | "review_changes"; triggerId: string }
/**
 * Resolve options of a row: rule 4 "Resolve…" or rule 4a "Assign review or accept…". They render inside
 * the expanded row's Translation review block, or under the row when it has no such block (F5).
 */
interface RowPanel { rowKey: string; mode: "resolve" | "not_accepted" }
export type AssignTask = "translation_review" | "annotate" | "review";

/** Previous / Next; at either end an `aria-disabled` link that stays focusable (focus survives the page change). */
function PagingLink({ route, onNavigate, children }: { route: Route | null; onNavigate: (route: Route) => void; children: ReactNode }): JSX.Element {
  if (!route) return <a role="link" aria-disabled="true" tabIndex={0}>{children}</a>;
  return <a href={routeHref(route)} onClick={event => {
    if (!isPlainClick(event)) return;
    event.preventDefault(); onNavigate(route);
  }}>{children}</a>;
}

/** The open final-result confirmation; `revision` and `causes` are the row's state at open. */
interface ConfirmState {
  request: FinalConfirmRequest;
  revision: number;
  causes: string;
  busy: boolean;
  failure: FinalConfirmFailure | null;
}

type FocusTarget = { kind: "selected" | "kept" | "row"; rowKey: string } | { kind: "notice" };

/** The row's acknowledgeable cause ids as a comparable set. */
const causeSet = (row: DocumentRowView): string => acknowledgeableItems(row).map(item => item.cause_id).sort().join("\n");

/** The report of a paused task without an open report (rule 2): the step's report or the row's pause cause. */
function pausedReportId(row: DocumentRowView, step: NextStepView): string | null {
  if (step.report_id) return step.report_id;
  return [...row.issues, ...row.notes].find(item => item.code === "TASK_PAUSED_WITHOUT_REPORT" && item.report_id)?.report_id ?? null;
}

export function DocumentsPage(props: DocumentsPageProps): JSX.Element {
  if (!props.canManage) {
    return <section className="documents-page">
      <h1>Documents</h1>
      <EmptyState title="Documents is for project leads"
        action={<RouteLink route={{ name: "tasks" }} onNavigate={route => props.onNavigate(route)}>Go to My tasks</RouteLink>}>
        Your tasks for this project are under My tasks.
      </EmptyState>
    </section>;
  }
  return <LeadDocuments key={JSON.stringify([props.projectKey, props.currentUser?.username])} {...props} />;
}

function LeadDocuments({ projectKey, query: route, onNavigate, canOverrideTranslationStatus = false, currentUser }: DocumentsPageProps): JSX.Element {
  const narrow = useMediaQuery(NARROW_DOCUMENTS_QUERY);
  const query = documentsQuery(route);
  const request = rowsQuery(query);
  const requestIdentity = JSON.stringify(request);
  const filterIdentity = JSON.stringify({ ...request, page: undefined, case: undefined });
  // Visit state (Resolved / Changed badges) exists only under a decision or segment filter; it is keyed
  // by the filters without page and case, so paging keeps the badges and a filter change starts a new visit.
  const decisionActive = request.decision !== undefined || request.final === "missing" || request.segment !== undefined;
  const [retainState, setRetainState] = useState<{ identity: string; keys: readonly string[] } | null>(null);
  const retain = !decisionActive ? []
    : retainState?.identity === filterIdentity ? retainState.keys : retainedKeys(projectKey, filterIdentity);
  // `useDocumentRows` is typed with one value per filter; the client sends lists as repeated parameters.
  const rows = useDocumentRows(projectKey, (retain.length ? { ...request, retain: [...retain] } : request) as DocumentRowsQuery);
  const page: DocumentRowsPage | null = rows.page;

  // Live region: a repeated message is cleared first and set again on the next tick so it is re-announced.
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef("");
  const announceTimer = useRef<number | undefined>(undefined);
  const announce = (message: string) => {
    window.clearTimeout(announceTimer.current);
    if (message !== announced.current) { announced.current = message; setAnnouncement(message); return; }
    setAnnouncement("");
    announceTimer.current = window.setTimeout(() => setAnnouncement(message), 0);
  };
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  // Page data for upload and assignment tools (the rows endpoint does not carry it).
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [settingsError, setSettingsError] = useState<unknown>();
  const [inventory, setInventory] = useState<{ documents: ProjectDocumentSummary[]; cases: CaseSummary[]; assignments: AssignmentView[]; members: Member[] } | null>(null);
  const [inventoryError, setInventoryError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api.getProjectSettings(projectKey).then(value => { if (active) setSettings(value); }, failure => { if (active) setSettingsError(failure); });
    return () => { active = false; };
  }, [projectKey]);
  useEffect(() => {
    let active = true;
    setInventoryError(undefined);
    void Promise.all([api.listProjectDocuments(projectKey), api.listCases(projectKey), api.listAssignments(projectKey), api.listMembers(projectKey)])
      .then(([documents, cases, assignments, members]) => { if (active) setInventory({ documents, cases, assignments, members }); },
        failure => { if (active) setInventoryError(failure); });
    return () => { active = false; };
  }, [projectKey, revision]);

  // Announce the number of texts once the data for a changed filter arrives.
  const shownFilters = useRef<string | null>(null);
  useEffect(() => {
    if (!page) return;
    if (shownFilters.current !== null && shownFilters.current !== filterIdentity) announce(`${plural(page.group_count, "text")} shown`);
    shownFilters.current = filterIdentity;
    // Only a new page (never a query change alone) can carry the new count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Deep link `case` + `language`: that row is open until the lead collapses it.
  const deepKey = query.case && query.language ? `${query.case}:${query.language}` : null;
  const [collapsedDeepKey, setCollapsedDeepKey] = useState<string | null>(null);
  // Rows collapsed automatically because they became Resolved (until the lead opens them again
  // or the filter changes).
  const [autoCollapsedState, setAutoCollapsedState] = useState<{ identity: string; keys: ReadonlySet<string> } | null>(null);
  const autoCollapsed: ReadonlySet<string> = useMemo(
    () => (autoCollapsedState?.identity === requestIdentity ? autoCollapsedState.keys : new Set()), [autoCollapsedState, requestIdentity]);
  const setAutoCollapsed = (keys: ReadonlySet<string>) => setAutoCollapsedState({ identity: requestIdentity, keys });
  const openKeys = useMemo(() => {
    const keys = new Set(query.open ?? []);
    if (deepKey && collapsedDeepKey !== deepKey) keys.add(deepKey);
    for (const key of autoCollapsed) keys.delete(key);
    return keys;
  }, [query.open, deepKey, collapsedDeepKey, autoCollapsed]);
  const { open: _routeOpen, ...queryWithoutOpen } = query;
  const viewQuery: ProjectDocumentsQuery = { ...queryWithoutOpen, ...(openKeys.size ? { open: [...openKeys] } : {}) };

  const documentsRoute = (patch: ProjectDocumentsQuery): Route => {
    const next: Route = { name: "projectDocuments", key: projectKey };
    for (const [name, value] of Object.entries({ ...query, ...patch })) {
      if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) Object.assign(next, { [name]: value });
    }
    return next;
  };
  const changeFilter = (patch: ProjectDocumentsQuery) => onNavigate(documentsRoute({ ...patch, page: undefined, select: undefined }));

  // ID filter: typed locally, applied after a pause, on Enter or on blur (one push, not one per keystroke).
  const [idText, setIdText] = useState(query.q ?? "");
  const sentId = useRef(query.q);
  const idTimer = useRef<number | undefined>(undefined);
  const latestFilter = useRef({ changeFilter });
  latestFilter.current = { changeFilter };
  useEffect(() => {
    // An outside change (Clear filters, history) replaces the typed text; our own push does not.
    if (query.q === sentId.current) return;
    sentId.current = query.q;
    setIdText(query.q ?? "");
  }, [query.q]);
  useEffect(() => () => window.clearTimeout(idTimer.current), []);
  const applyId = (value: string) => {
    window.clearTimeout(idTimer.current);
    const next = value || undefined;
    // Already sent (or already the route's value): nothing to push.
    if (next === (sentId.current || undefined)) return;
    sentId.current = next;
    latestFilter.current.changeFilter({ q: next });
  };
  const typeId = (value: string) => {
    setIdText(value);
    window.clearTimeout(idTimer.current);
    idTimer.current = window.setTimeout(() => applyId(value), ID_FILTER_DELAY_MS);
  };
  const toggleRow = (key: string) => {
    const next = new Set(openKeys);
    if (next.has(key)) {
      next.delete(key);
      if (key === deepKey) setCollapsedDeepKey(key);
    } else {
      next.add(key);
      if (autoCollapsed.has(key)) setAutoCollapsed(new Set([...autoCollapsed].filter(item => item !== key)));
    }
    onNavigate(documentsRoute({ open: [...next] }), { replace: true });
  };
  const expandRow = (key: string) => { if (!openKeys.has(key)) toggleRow(key); };

  // Visit state: a filter change clears the other visits of the project.
  useEffect(() => { clearVisits(projectKey, filterIdentity); }, [projectKey, filterIdentity]);

  // Remember the matching rows of each new page, retain them in later requests and badge the
  // remembered rows that stopped matching; Resolved rows collapse once.
  const [badgeState, setBadgeState] = useState<{ identity: string; badges: ReadonlyMap<string, RowBadge> } | null>(null);
  const badges: ReadonlyMap<string, RowBadge> = badgeState?.identity === filterIdentity ? badgeState.badges : new Map();
  useEffect(() => {
    if (!page || !decisionActive) return;
    const rowsShown = page.groups.flatMap(group => group.rows);
    rememberShown(projectKey, filterIdentity, rowsShown);
    const keys = retainedKeys(projectKey, filterIdentity);
    if (keys.some(key => !retain.includes(key))) setRetainState({ identity: filterIdentity, keys });
    const next = rowBadges(projectKey, filterIdentity, rowsShown);
    const resolvedBefore = new Set([...badges].filter(([, badge]) => badge.tone === "success").map(([key]) => key));
    const collapse = [...next].filter(([key, badge]) => badge.tone === "success" && !resolvedBefore.has(key) && openKeys.has(key)).map(([key]) => key);
    setBadgeState({ identity: filterIdentity, badges: next });
    if (collapse.length) {
      setAutoCollapsed(new Set([...autoCollapsed, ...collapse]));
      if (deepKey && collapse.includes(deepKey)) setCollapsedDeepKey(deepKey);
      onNavigate(documentsRoute({ open: [...openKeys].filter(key => !collapse.includes(key)) }), { replace: true });
    }
    // Only a new page carries new row states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const pageRows = useMemo(() => page?.groups.flatMap(group => group.rows) ?? [], [page]);
  const groupOf = (caseId: string) => page?.groups.find(group => group.case_id === caseId);

  const refreshAll = () => { rows.reload(); setRevision(value => value + 1); };
  // Assign dialog: one row (task preselected) or the selected cases (selection bar).
  const [assignDialog, setAssignDialog] = useState<AssignWorkDialogProps | null>(null);
  /** Assign dialog for one row; `options.newReviewOfAccepted` marks a new review of an accepted translation (D25). */
  const onAssign = (row: DocumentRowView, task: AssignTask, options?: { newReviewOfAccepted?: boolean }) => {
    setAssignDialog({
      mode: "row", projectKey, row, task, newReviewOfAccepted: options?.newReviewOfAccepted,
      onClose: () => setAssignDialog(null),
      onAssigned: message => { setAssignDialog(null); showToast({ message }); announce(message); refreshAll(); },
    });
  };

  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);

  const textVersionTools = useMemo<TextVersionsTools | undefined>(() => {
    if (!inventory) return undefined;
    const variants = new Map<string, VariantSummary>(inventory.cases.flatMap(item => item.variants).map(variant => [variant.document_id, variant]));
    return {
      username: currentUser?.username ?? "",
      assignments: inventory.assignments,
      members: inventory.members,
      variants,
      requiredLanguages: documentId => reviewLanguages(documentId, variants),
      onAssignmentsChanged: refreshAll,
      onShowTranslationReviews: setReviewDocument,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, currentUser?.username, rows.reload]);

  // Deep link: focus the named row header (or the group header) once its data is shown.
  const focusedDeepLink = useRef<string | null>(null);
  useEffect(() => {
    if (!page || rows.stale || !query.case || !page.case_found) return;
    const identity = JSON.stringify([query.case, query.language ?? null]);
    if (focusedDeepLink.current === identity) return;
    focusedDeepLink.current = identity;
    const caseId = query.case;
    const group = page.groups.find(item => item.case_id === caseId);
    const candidates = [
      ...(query.language ? [documentsRowId(caseId, query.language, "disclosure")] : []),
      documentsGroupId(caseId),
      ...(group?.rows.map(item => documentsRowId(item.case_id, item.language, "disclosure")) ?? []),
    ];
    const target = candidates.map(id => document.getElementById(id)).find(Boolean);
    if (!target) return;
    target.scrollIntoView?.({ block: "center" });
    target.focus();
  }, [page, rows.stale, query.case, query.language]);

  const rowNotice = (row: DocumentRowView): string | null => {
    const named = row.pinned || rowKeyOf(row) === deepKey;
    if (!named) return null;
    if ((request.decision || request.segment === "decision") && !row.matches_decision) return "This no longer needs your decision.";
    if (request.segment && !row.matches_decision) return "This no longer matches the filter.";
    if (!request.decision && !request.segment && rowKeyOf(row) === deepKey && row.plan_row?.annotate !== false && !row.final && !row.missing_final.counts) {
      return `No final result. Not counted as a decision yet: ${row.missing_final.reason === "work_open" ? `work still open: ${workText(row.work)}` : "no submission"}.`;
    }
    return null;
  };
  // Final-result confirmations: one per page, everything captured at open.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const [success, setSuccess] = useState<{ text: string; next: string | null } | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const pendingSuccess = useRef<{ request: FinalConfirmRequest; before: DocumentRowsPage } | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  /** Container of the open confirmation ("is focus inside the confirmation?"). */
  const confirmBox = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Next row under a decision or segment filter ("Next decision:" / "Next:"). */
  const nextLabel = request.segment ? "Next" : "Next decision";
  const nextRowAfter = (rowKey: string): DocumentRowView | undefined => {
    if (request.segment) return pageRows.find(row => rowKeyOf(row) !== rowKey && row.in_plan && row.matches_decision && !row.retained);
    if (request.decision) return pageRows.find(row => rowKeyOf(row) !== rowKey && row.matches_decision && row.categories.length > 0);
    return undefined;
  };

  const restoreFocus = (request: FinalConfirmRequest) => (document.getElementById(request.triggerId) ?? rowElement(request.rowKey, "disclosure"))?.focus();
  const openConfirm = (request: FinalConfirmRequest, row: DocumentRowView) => {
    const current = confirmRef.current;
    if (current?.busy || current?.request.triggerId === request.triggerId) return;
    if (current) announce("Previous confirmation closed.");
    setSuccess(null);
    setConfirm({ request, revision: row.final?.revision ?? 0, causes: causeSet(row), busy: false, failure: null });
  };
  const cancelConfirm = () => {
    const current = confirmRef.current;
    if (!current || current.busy) return;
    restoreFocus(current.request);
    setConfirm(null);
  };
  const reviewAgain = () => {
    const current = confirmRef.current;
    if (!current) return;
    setConfirm(null);
    rows.reload();
    document.getElementById(submissionsHeadingId(current.request.caseId, current.request.language))?.focus();
  };
  const submitConfirm = () => {
    const current = confirmRef.current;
    if (!current || current.busy || !page) return;
    const { request } = current;
    const before = page;
    setConfirm({ ...current, busy: true, failure: null });
    api.selectFinalResult(projectKey, selectionPayload(request)).then(() => {
      notifyFinalSelectionChanged(projectKey);
      recordDecision(projectKey, request.rowKey);
      pendingSuccess.current = { request, before };
      setConfirm(value => (value?.request === request ? null : value));
      rows.reload();
    }, error => {
      setConfirm(value => (value?.request === request ? { ...value, busy: false, failure: failureOf(error) } : value));
    });
  };

  // A new rows page: report a pending success, and close the confirmation when its row's
  // selection revision or set of acknowledgeable causes changed (other refreshes keep it open).
  useEffect(() => {
    if (!page) return;
    const pending = pendingSuccess.current;
    if (pending && page !== pending.before) {
      pendingSuccess.current = null;
      const saved = pending.request;
      const text = [successMessage(saved), barChanges(pending.before.bar, page.bar)].filter(Boolean).join(" ");
      const next = nextRowAfter(saved.rowKey);
      announce(next ? `${text} ${nextLabel}: ${rowName(next)}.` : text);
      setSuccess({ text, next: next ? rowKeyOf(next) : null });
      setFocusTarget({ kind: saved.kind === "keep" ? "kept" : "selected", rowKey: saved.rowKey });
    }
    const current = confirmRef.current;
    if (!current || current.busy || current.failure) return;
    const row = pageRows.find(item => rowKeyOf(item) === current.request.rowKey);
    if (row && (row.final?.revision ?? 0) === current.revision && causeSet(row) === current.causes) return;
    // The confirmation is still in the DOM unless its row vanished; then focus already fell to the body.
    const active = document.activeElement;
    const inside = (confirmBox.current?.contains(active) ?? false) || active == null || active === document.body;
    setConfirm(null);
    if (!row) {
      if (inside) headingRef.current?.focus();
      announce(`${nameOfKey(current.request.rowKey)} is no longer shown. The confirmation was closed.`);
      return;
    }
    if (inside) restoreFocus(current.request);
    announce("The final result or its warnings changed. The confirmation was closed.");
    // Only a new page can change the confirmation's row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // A save whose reload failed: report it without the bar changes and say the list is not current.
  useEffect(() => {
    const pending = pendingSuccess.current;
    if (rows.error == null || !pending) return;
    pendingSuccess.current = null;
    const text = `${successMessage(pending.request)} The list could not be refreshed.`;
    announce(text);
    setSuccess({ text, next: null });
    setFocusTarget({ kind: "notice" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.error]);

  // Focus after a success (new Final row's View link, or the Submissions heading after Keep) or "Next decision".
  useEffect(() => {
    if (!focusTarget) return;
    setFocusTarget(null);
    if (focusTarget.kind === "notice") { successRef.current?.focus(); return; }
    if (focusTarget.kind === "row") { rowElement(focusTarget.rowKey, "disclosure")?.focus(); return; }
    const target = focusTarget.kind === "kept"
      ? document.getElementById(submissionsHeadingId(caseOfKey(focusTarget.rowKey), languageOfKey(focusTarget.rowKey)))
      : rowElement(focusTarget.rowKey, "final-view");
    (target ?? successRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  const nextDecisionRoute = (key: string) => documentsRoute({ open: [...new Set([...openKeys, key])] });
  const goToRow = (key: string) => {
    onNavigate(nextDecisionRoute(key), { replace: true });
    setFocusTarget({ kind: "row", rowKey: key });
  };

  // Plan chips: one shared queue and toast; a save refetches the rows (the next step updates in place).
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const latestReload = useRef(rows.reload);
  latestReload.current = rows.reload;
  const planSaves = usePlanSaves({ projectKey, onAnnounce: announce, onChanged: () => latestReload.current(), showToast });
  // A finished import closes the upload dialog: the imported cases arrive in the reloaded rows with their plan.
  const importDone = (message: string) => { setUploadOpen(false); showToast({ message }); announce(message); refreshAll(); };
  // Each new rows page: drop local chip flags the server has caught up with; restore focus after a save.
  useEffect(() => {
    if (page) planSaves.refreshed(page.groups);
    // Only a new page carries new plan revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Text selection (VD4, spec D17): a set of texts "{case}:{language}" that survives paging and filter changes.
  const selection = useTextSelection();
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [idsDialogOpen, setIdsDialogOpen] = useState(false);
  const [allFiltered, setAllFiltered] = useState<{ identity: string; keys: readonly string[] } | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectionError, setSelectionError] = useState<unknown>();
  // A user action changed the selection: announce the new count once the state is applied.
  const announceSelection = useRef(false);
  useEffect(() => {
    if (!announceSelection.current) return;
    announceSelection.current = false;
    announce(selection.keys.size ? `${plural(selection.keys.size, "text")} in ${plural(selection.cases.size, "case")} selected` : "Selection cleared.");
    // Only a selection change is announced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.keys]);
  const applyLimit = (truncated: boolean) => setLimitNote(truncated ? SELECTION_LIMITED : null);
  const tableSelection: TableSelection = {
    keys: selection.keys,
    caseState: selection.caseState,
    select: (key: string, mode: GroupSelectMode, order: readonly string[]) => {
      announceSelection.current = true;
      applyLimit(selection.select(key, mode, order).truncated);
    },
    selectCase: (caseKeys: readonly string[], mode: GroupSelectMode, order: readonly string[]) => {
      announceSelection.current = true;
      applyLimit(selection.selectCase(caseKeys, mode, order).truncated);
    },
  };
  const clearSelection = () => {
    announceSelection.current = true;
    selection.clear(); setLimitNote(null); setAllFiltered(null);
  };
  /** Selects every text of the given cases (Select the skipped cases); the row keys come from the server. */
  const selectCases = (caseIds: readonly string[]) => {
    void api.documentRowKeys(projectKey, { case_ids: [...caseIds] }).then(result => {
      announceSelection.current = true;
      applyLimit(selection.replace(result.keys.map(textKeyOf)).truncated);
    }, (failure: unknown) => setSelectionError(failure));
  };
  // Header checkbox: every text matching the current filters, across pages (server list, at most 2000 cases).
  const filteredTotal = page?.group_count ?? 0;
  const allSelected = allFiltered !== null && allFiltered.identity === filterIdentity && allFiltered.keys.length > 0 && allFiltered.keys.every(key => selection.keys.has(key));
  const selectAllLabel = filteredTotal > MAX_SELECTION
    ? `Select the first ${MAX_SELECTION} of ${filteredTotal} filtered cases` : `Select all ${plural(filteredTotal, "filtered case")}`;
  const filters = useMemo(() => selectionFilters(request), [requestIdentity]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleAll = async () => {
    if (selectingAll) return;
    setSelectionError(undefined);
    if (allSelected) {
      announceSelection.current = true;
      selection.remove(allFiltered.keys); setAllFiltered(null); setLimitNote(null);
      return;
    }
    const identity = filterIdentity;
    const { page: _page, sort, retain: _retain, ...rowFilters } = request;
    setSelectingAll(true);
    try {
      const result = await api.documentRowKeys(projectKey, { filters: rowFilters, sort: sort ?? "case" });
      const keys = result.keys.map(textKeyOf);
      announceSelection.current = true;
      applyLimit(selection.add(keys).truncated || result.truncated);
      setAllFiltered({ identity, keys });
    } catch (failure: unknown) {
      setSelectionError(failure);
    } finally {
      setSelectingAll(false);
    }
  };
  const selectByIds = (keys: readonly string[], mode: "replace" | "add") => {
    setIdsDialogOpen(false);
    announceSelection.current = true;
    applyLimit((mode === "replace" ? selection.replace(keys) : selection.add(keys)).truncated);
    setAllFiltered(null);
  };
  const openAssignCases = () => {
    // The batch dialog still assigns whole cases (row-level batch assignment: AssignWorkDialog, not this WP).
    const caseIds = [...selection.cases];
    if (!caseIds.length) return;
    setAssignDialog({
      mode: "cases", projectKey, caseIds, sort: batchSort(request.sort), filters,
      onClose: () => setAssignDialog(null),
      onAssigned: (message, skipped) => {
        // The planned work is done for this selection; the skipped cases stay one click away.
        setAssignDialog(null);
        selection.clear(); setLimitNote(null); setAllFiltered(null);
        const rest = [...new Set(skipped)];
        showToast({
          message,
          ...(rest.length ? {
            actionLabel: `Select the ${plural(rest.length, "skipped case")}`,
            onAction: () => selectCases(rest),
          } : {}),
        });
        announce(message);
        refreshAll();
      },
    });
  };
  useShortcutHint(["Shift + ↓", "Shift + ↑"], "Move to the next or previous row and select it", { group: "Selection", enabled: !narrow && !!page?.groups.length });
  useShortcutHint(["Space"], "Select or deselect the focused row", { group: "Selection", enabled: !!page?.groups.length });

  // Row actions.
  const [autoAction, setAutoAction] = useState<AutoAction | null>(null);
  const [rowPanel, setRowPanel] = useState<RowPanel | null>(null);
  /** The rendered Resolve options (in the Translation review block or under the row). */
  const panelBox = useRef<HTMLDivElement>(null);
  /** Row whose Translation review heading takes focus once its Resolve options render in that block. */
  const [slotFocus, setSlotFocus] = useState<string | null>(null);
  const hasTranslationBlock = (row: DocumentRowView) => plannedStages(row).includes("translation_review");
  const panelInBlock = (row: DocumentRowView) => openKeys.has(rowKeyOf(row)) && hasTranslationBlock(row);
  const openPanel = (row: DocumentRowView, mode: RowPanel["mode"]) => {
    const key = rowKeyOf(row);
    setRowPanel({ rowKey: key, mode });
    if (!hasTranslationBlock(row)) { setSlotFocus(null); return; }
    setSlotFocus(key);
    expandRow(key);
  };
  // Runs after the options' own heading focus (child effects first): the block heading wins.
  useEffect(() => {
    if (!slotFocus) return;
    if (rowPanel?.rowKey !== slotFocus) { setSlotFocus(null); return; }
    const heading = document.getElementById(stageBlockHeadingId(caseOfKey(slotFocus), languageOfKey(slotFocus), "translation_review"));
    const box = panelBox.current;
    if (!heading || !box || !heading.closest(".stage-block")?.contains(box)) return;
    heading.focus();
    setSlotFocus(null);
  });
  const reportRoute = (reportId: string, extra: { section?: "decide"; action?: "resume" }): Route => ({
    name: "projectProblemReport", key: projectKey, reportId, ...extra, ...(Object.keys(viewQuery).length ? { documents: viewQuery } : {}),
  });
  const onAction = (row: DocumentRowView, step: NextStepView) => {
    const key = rowKeyOf(row);
    const triggerId = documentsRowId(row.case_id, row.language, "action");
    switch (step.action) {
      case "assign_translation_review": void onAssign(row, "translation_review"); return;
      case "assign_annotation": void onAssign(row, "annotate"); return;
      case "choose_final":
      case "review_changes":
        setAutoAction({ rowKey: key, kind: step.action, triggerId });
        expandRow(key);
        return;
      case "decide_report":
        if (step.report_id) onNavigate(reportRoute(step.report_id, { section: "decide" })); else expandRow(key);
        return;
      case "resume_task": {
        const reportId = pausedReportId(row, step);
        if (reportId) onNavigate(reportRoute(reportId, { action: "resume" })); else expandRow(key);
        return;
      }
      case "resolve": openPanel(row, "resolve"); return;
      case "accept_or_review": openPanel(row, "not_accepted"); return;
      // "Plan…" opens the plan popover in the Action cell; from elsewhere the expansion's Plan line.
      case "plan": expandRow(key); return;
      default: return;
    }
  };
  const closePanel = (key: string) => {
    setRowPanel(null);
    window.setTimeout(() => (rowElement(key, "action") ?? rowElement(key, "disclosure"))?.focus(), 0);
  };
  // Escape inside the options (or their Translation review block) closes them; a discard confirmation
  // inside handles its own Escape first (registered later).
  useShortcut("Escape", event => {
    const box = panelBox.current;
    const scope = box?.closest(".stage-block") ?? box;
    if (!rowPanel || !scope || !(event.target instanceof Node) || !scope.contains(event.target)) return false;
    closePanel(rowPanel.rowKey);
  }, { allowInInputs: true, enabled: rowPanel != null });

  const confirmElement = (state: ConfirmState) => <FinalConfirm key={state.request.triggerId} ref={confirmBox} request={state.request} busy={state.busy}
    failure={state.failure} onConfirm={submitConfirm} onCancel={cancelConfirm} onReview={reviewAgain} />;

  const renderExpanded = (row: DocumentRowView, options?: { layout: "table" | "list" }) => {
    const notice = rowNotice(row);
    const own = confirm?.request.rowKey === rowKeyOf(row) ? confirm : null;
    return <>
      {notice && <p className="documents-row-notice">{notice}</p>}
      <div className="documents-expanded-plan"><span className="documents-expanded-plan-label">Plan</span>
        <PlanChips row={row} groupRevision={groupOf(row.case_id)?.plan_revision ?? 1} saves={planSaves} size={narrow ? "card" : "table"} /></div>
      <ExpandedRowLoader row={row} refresh={page} projectKey={projectKey} query={viewQuery} onNavigate={route => onNavigate(route)}
        adjudicatorNotAnnotator={page?.adjudicator_not_annotator ?? false} onAnnounce={announce} textVersionTools={textVersionTools}
        onOpenConfirm={request => openConfirm(request, row)}
        renderConfirm={submission => (own && own.request.kind !== "keep" && own.request.submissionId === submission.submission_id ? confirmElement(own) : null)}
        keepConfirm={own?.request.kind === "keep" ? confirmElement(own) : undefined}
        confirmBusy={confirm?.busy ?? false} layout={options?.layout}
        planRevision={planSaves.revisionOf(row.case_id, groupOf(row.case_id)?.plan_revision ?? 1)} onAssign={onAssign}
        autoAction={autoAction?.rowKey === rowKeyOf(row) ? autoAction : null} onAutoActionDone={() => setAutoAction(null)}
        translationSlot={rowPanel?.rowKey === rowKeyOf(row) && panelInBlock(row) ? resolvePanel(row, rowPanel) : undefined} />
    </>;
  };

  // "Correct the translation yourself…" in the Translation review block (F1): the lead's own correction.
  const correctionHost = useMemo<LeadCorrectionHost>(() => ({ projectKey, onNavigate: route => onNavigate(route) }), [projectKey, onNavigate]);

  const resolvePanel = (row: DocumentRowView, panel: RowPanel): JSX.Element => {
    const key = rowKeyOf(row);
    const groupRevision = groupOf(row.case_id)?.plan_revision ?? 1;
    return <div ref={panelBox}>
      <ResolveTranslation key={panel.mode} mode={panel.mode} row={row} projectKey={projectKey}
        revision={planSaves.revisionOf(row.case_id, groupRevision)}
        onAssignReview={() => { setRowPanel(null); void onAssign(row, "translation_review"); }}
        onNavigate={route => onNavigate(route)}
        onDone={(message, saved) => {
          planSaves.noteRevision(saved.caseId, saved.revision);
          announce(message);
          rows.reload();
          closePanel(key);
        }}
        onChanged={(caseId, revision) => { planSaves.noteRevision(caseId, revision); rows.reload(); }}
        onAnnounce={announce}
        onCancel={() => closePanel(key)} />
    </div>;
  };

  const renderRowNotice = (row: DocumentRowView): ReactNode | null => {
    const key = rowKeyOf(row);
    const panel = rowPanel?.rowKey === key ? rowPanel : null;
    if (!panel && !planSaves.noticeOf(row)) return null;
    return <>
      <PlanRowNotice row={row} saves={planSaves} />
      {panel && !panelInBlock(row) && resolvePanel(row, panel)}
    </>;
  };

  const rowBadge = (row: DocumentRowView) => {
    const badge = badges.get(rowKeyOf(row));
    return badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>;
  };

  const languages = [...new Set([...(settings?.languages ?? []), ...pageRows.map(row => row.language), ...(query.language ? [query.language] : [])])];
  const status = STATUS_OPTIONS.some(([value]) => value === query.status) ? query.status! : "";
  const origin = query.origin && Object.hasOwn(originLabels, query.origin) ? query.origin : "";
  const translationStatus = TRANSLATION_STATUS_OPTIONS.some(([value]) => value === query.translation_status) ? query.translation_status! : "";
  // Several values (from a Progress link) show as one extra option naming them all.
  const stepValues = valuesOf(request.step), planValues = valuesOf(request.plan);
  const step = stepValues.join(","), plan = planValues.join(",");
  const finalFilter = request.final === "none" || request.final === "any" ? request.final : "";
  const stageValues = valuesOf(request.stage);
  const alsoFiltered = [
    ...(stageValues.length ? [`Stage ${stageValues.map(value => STAGE_LABELS[value]).join(" or ")}`] : []),
    ...(request.paused ? [request.paused === "yes" ? "Paused" : "Not paused"] : []),
  ];
  const sort = request.sort ?? "case";
  const moreActive = status !== "" || origin !== "" || translationStatus !== "" || finalFilter !== "" || sort !== "case";
  // "More filters" is the lead's to open and close; it opens by itself only when one of its filters becomes active.
  const [moreOpen, setMoreOpen] = useState(moreActive);
  useEffect(() => { if (moreActive) setMoreOpen(true); }, [moreActive]);
  const showAll: Route = { name: "projectDocuments", key: projectKey };
  const navigateLink = (target: Route) => onNavigate(target);
  const hasFilters = Object.keys(request).some(name => name !== "page" && name !== "sort");

  const emptyState = (): JSX.Element => {
    const showAllLink = <RouteLink route={showAll} onNavigate={navigateLink}>Show all texts</RouteLink>;
    if (request.segment === "assign") return <EmptyState title="Nothing to assign" action={showAllLink} />;
    if (request.segment === "progress") return <EmptyState title="Nothing in progress" action={showAllLink} />;
    if (request.segment === "decision" || request.decision) return <EmptyState title="Nothing needs your decision" action={showAllLink} />;
    if (request.plan === "not_in_plan") return <EmptyState title="Every language version is in the plan." action={showAllLink} />;
    if (!hasFilters) return <EmptyState title="No texts yet">Upload texts to start.</EmptyState>;
    return <EmptyState title="No documents" action={showAllLink}>Try another filter.</EmptyState>;
  };

  let content: JSX.Element;
  if (!page && rows.error != null) {
    content = <div className="documents-error"><ErrorNotice error={rows.error} /><Button onClick={rows.retry}>Retry</Button></div>;
  } else if (!page) {
    content = <DocumentsSkeleton />;
  } else {
    let body: JSX.Element;
    if (query.case && !page.case_found) {
      body = <EmptyState title={`Text ${query.case} not found`} action={<RouteLink route={showAll} onNavigate={navigateLink}>Show all texts</RouteLink>} />;
    } else if (page.groups.length === 0) {
      body = emptyState();
    } else if (narrow) {
      body = <DocumentCards page={page} projectKey={projectKey} query={viewQuery} selection={tableSelection} onToggleRow={toggleRow} planSaves={planSaves}
        renderRowNotice={renderRowNotice} renderExpanded={renderExpanded} rowBadge={rowBadge} onAction={onAction} onNavigate={navigateLink} busy={rows.loading} />;
    } else {
      body = <DocumentsTable page={page} projectKey={projectKey} query={viewQuery} selection={tableSelection} planSaves={planSaves}
        onToggleRow={toggleRow} renderRowNotice={renderRowNotice} renderExpanded={renderExpanded} rowBadge={rowBadge} onAction={onAction} onNavigate={navigateLink} busy={rows.loading}
        sort={request.sort} onSort={(next: HeaderSort) => changeFilter({ sort: next === "case" ? undefined : next })} />;
    }
    // Sticky above the table; below 700 px after the cards, so it can stick to the bottom of the viewport.
    const selectionBar = <SelectionBar projectKey={projectKey} keys={selection.keys} filters={filters} refresh={page} narrow={narrow} limitNote={limitNote}
      onClear={clearSelection} onAssign={openAssignCases} showToast={showToast} onAnnounce={announce} onChanged={() => latestReload.current()}
      onRevisions={revisions => { for (const [caseId, value] of Object.entries(revisions)) planSaves.noteRevision(caseId, value); }} />;
    // While another filter or page loads, the previous page stays (busy) so the bar and paging links keep focus.
    content = <>
      {rows.error != null && <InlineMessage tone="error">Could not refresh · <Button size="sm" onClick={rows.retry}>Retry</Button></InlineMessage>}
      <DecisionBar bar={page.bar} query={query} projectKey={projectKey} onNavigate={navigateLink} updatedAt={rows.updatedAt} onRefresh={refreshAll} />
      <div className="documents-selection-tools">
        {page.groups.length > 0 && <Checkbox id="documents-select-all" className="checkbox-target" label={selectAllLabel} checked={allSelected}
          aria-busy={selectingAll || undefined} onChange={() => { void toggleAll(); }} />}
        <Button variant="quiet" size="sm" onClick={() => setIdsDialogOpen(true)}>Select by case IDs…</Button>
      </div>
      {selectionError !== undefined && <ErrorNotice error={selectionError} />}
      {!narrow && selectionBar}
      <h2 className="visually-hidden">Texts</h2>
      {body}
      {narrow && selectionBar}
      <Toast toast={toast} onDismiss={dismissToast} />
      {page.page_count > 1 && <nav className="documents-paging" aria-label="Pages" aria-busy={rows.stale || undefined}>
        <PagingLink route={page.page > 1 ? documentsRoute({ page: page.page - 1 > 1 ? String(page.page - 1) : undefined }) : null} onNavigate={navigateLink}>Previous</PagingLink>
        <span>Page {page.page} of {page.page_count}</span>
        <PagingLink route={page.page < page.page_count ? documentsRoute({ page: String(page.page + 1) }) : null} onNavigate={navigateLink}>Next</PagingLink>
      </nav>}
    </>;
  }

  return <section className="documents-page">
    <div className="documents-heading">
      <h1 ref={headingRef} tabIndex={-1}>Documents</h1>
      <Button variant="quiet" aria-disabled={settings ? undefined : true} onClick={() => { if (settings) setUploadOpen(true); }}>Upload texts…</Button>
    </div>
    <Toolbar label="Document filters" className="filter-bar documents-filters">
      <Select id="documents-language" label="Language" value={query.language ?? ""} onChange={event => changeFilter({ language: event.target.value || undefined })}>
        <option value="">All languages</option>{languages.map(value => <option key={value} value={value}>{value}</option>)}
      </Select>
      <Select id="documents-step" label="Next step" value={step} onChange={event => changeFilter({ step: event.target.value || undefined })}>
        <option value="">Any next step</option>
        {stepValues.length > 1 && <option value={step}>{stepValues.map(stepLabel).join(" or ")}</option>}
        {STEP_FILTER_GROUPS.map(([group, codes]) => <optgroup key={group} label={group}>
          {codes.map(code => <option key={code} value={code}>{stepLabel(code)}</option>)}
        </optgroup>)}
      </Select>
      <Select id="documents-plan" label="Plan" value={plan} onChange={event => changeFilter({ plan: event.target.value || undefined })}>
        <option value="">Any plan</option>
        {planValues.length > 1 && <option value={plan}>{planValues.map(value => PLAN_OPTIONS.find(([option]) => option === value)?.[1] ?? value).join(" or ")}</option>}
        {PLAN_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <TextInput id="documents-prefix" label="Case ID" value={idText} onChange={event => typeId(event.target.value)} onBlur={() => applyId(idText)}
        onKeyDown={event => { if (event.key === "Enter") applyId(idText); }} />
      {alsoFiltered.length > 0 && <p className="muted documents-also-filtered">{`Also filtered: ${alsoFiltered.join(" · ")}`}</p>}
      <details className="documents-more-filters" open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}>
        <summary>More filters</summary>
        <div className="documents-more-filters-body">
          <Select id="documents-final" label="Final result" value={finalFilter} onChange={event => changeFilter({ final: event.target.value || undefined })}>
            <option value="">Any</option><option value="none">None</option><option value="any">Has a final result</option>
          </Select>
          <Select id="documents-origin" label="Origin" value={origin} onChange={event => changeFilter({ origin: event.target.value || undefined })}>
            <option value="">All origins</option>{Object.entries(originLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select id="documents-translation-status" label="Translation status" value={translationStatus} onChange={event => changeFilter({ translation_status: event.target.value || undefined })}>
            <option value="">All translation statuses</option>{TRANSLATION_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select id="documents-status" label="Status" value={status} onChange={event => changeFilter({ status: event.target.value || undefined })}>
            <option value="">All statuses</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select id="documents-sort" label="Sort" value={sort} onChange={event => changeFilter({ sort: event.target.value === "case" ? undefined : event.target.value })}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
      </details>
    </Toolbar>
    {settingsError !== undefined && <ErrorNotice error={settingsError} />}
    {inventoryError !== undefined && <ErrorNotice error={inventoryError} />}
    {success && <div ref={successRef} tabIndex={-1} className="notice notice-success documents-success">
      <div className="notice-content">
        {success.text}
        {success.next && <> <a href={routeHref(nextDecisionRoute(success.next))} onClick={event => {
          if (!isPlainClick(event)) return;
          event.preventDefault(); goToRow(success.next!);
        }}>{nextLabel}: {nameOfKey(success.next)}</a></>}
      </div>
    </div>}
    <LeadCorrectionContext.Provider value={correctionHost}>{content}</LeadCorrectionContext.Provider>
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    <Dialog open={uploadOpen} title="Upload texts" size="lg" onClose={() => setUploadOpen(false)}>
      {uploadOpen && settings && <UploadPanel key={projectKey} projectKey={projectKey} languages={settings.languages ?? []} canOverrideTranslationStatus={canOverrideTranslationStatus}
        annotateAcceptedOnly={settings.annotate_accepted_translations_only ?? true} onImported={importDone} />}
    </Dialog>
    {reviewDocument !== null && <ReviewHistory key={reviewDocument} projectKey={projectKey} documentId={reviewDocument} onClose={() => setReviewDocument(null)} />}
    {assignDialog && <AssignWorkDialog {...assignDialog} />}
    {idsDialogOpen && <SelectByIdsDialog projectKey={projectKey} current={selection.cases} onClose={() => setIdsDialogOpen(false)} onSelect={selectByIds} />}
  </section>;
}

/** Skeleton rows while the first page loads. */
function DocumentsSkeleton(): JSX.Element {
  return <div className="data-table-scroll">
    <table aria-label="Documents" aria-busy="true" className="data-table density-compact documents-table documents-skeleton">
      <thead><tr>{SKELETON_HEADERS.map(([header, hidden]) => <th key={header} scope="col">{hidden ? <span className="visually-hidden">{header}</span> : header}</th>)}</tr></thead>
      <tbody>{[0, 1, 2, 3, 4].map(index => <tr key={index} className="documents-skeleton-row">
        {SKELETON_HEADERS.map(([header]) => <td key={header}><span className="documents-skeleton-bar" aria-hidden="true" /></td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

interface ExpandedRowLoaderProps {
  row: DocumentRowView;
  /** The current rows page; a new page (refetch) reloads this row's submissions. */
  refresh: DocumentRowsPage | null;
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
  adjudicatorNotAnnotator: boolean;
  onAnnounce: (message: string) => void;
  textVersionTools?: TextVersionsTools;
  layout?: ExpandedRowProps["layout"];
  planRevision?: ExpandedRowProps["planRevision"];
  onAssign?: ExpandedRowProps["onAssign"];
  translationSlot?: ExpandedRowProps["translationSlot"];
  /** Opens a final-result confirmation built from this row and its loaded submissions. */
  onOpenConfirm: (request: FinalConfirmRequest) => void;
  renderConfirm: ExpandedRowProps["renderConfirm"];
  keepConfirm?: ExpandedRowProps["keepConfirm"];
  confirmBusy: boolean;
  /** A row action to run once the submissions are loaded. */
  autoAction: AutoAction | null;
  onAutoActionDone: () => void;
}

/** Loads the submissions of an open row and reloads them whenever the rows refresh. */
function ExpandedRowLoader({ row, refresh, projectKey, onOpenConfirm, autoAction, onAutoActionDone, ...props }: ExpandedRowLoaderProps): JSX.Element {
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, true);
  const mounted = useRef(false);
  const { reload } = submissions;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    reload();
    // Only a new rows page triggers the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  const data: RowSubmissions | null = submissions.data;
  // "Choose final…": one eligible submission opens its "Use as final"; several focus Submissions.
  // "Review changes…": the Keep confirmation for every acknowledgeable cause.
  useEffect(() => {
    if (!autoAction || !data || submissions.loading) return;
    onAutoActionDone();
    if (autoAction.kind === "review_changes") {
      const causes = acknowledgeableItems(row).map(item => item.cause_id);
      if (row.final && causes.length) { onOpenConfirm(keepRequest(row, data, causes, autoAction.triggerId)); return; }
    } else {
      const eligible = data.submissions.filter(item => item.submission_id !== row.final?.submission_id && item.is_latest_in_round !== false
        && !(props.adjudicatorNotAnnotator && item.is_me));
      if (eligible.length === 1) { onOpenConfirm(selectRequest(row, data, eligible[0], autoAction.triggerId)); return; }
    }
    document.getElementById(submissionsHeadingId(row.case_id, row.language))?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAction, data, submissions.loading]);
  const onSelectFinal = (request: SelectFinalRequest) => onOpenConfirm(selectRequest(row, data, request.submission, request.triggerId));
  const onKeep = (request: KeepRequest) =>
    onOpenConfirm(keepRequest(row, data, request.causeIds, request.triggerId));
  return <ExpandedRow row={row} projectKey={projectKey} submissions={submissions} onSelectFinal={onSelectFinal} onKeep={onKeep} {...props} />;
}

function ReviewHistory({ projectKey, documentId, onClose }: { projectKey: string; documentId: string; onClose: () => void }): JSX.Element {
  const [records, setRecords] = useState<TranslationReviewRecord[] | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api.listTranslationReviews(projectKey, documentId).then(value => { if (active) setRecords(value); }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey, documentId]);
  return <Dialog open title={`Translation reviews: ${documentId}`} size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
    {error !== undefined && <ErrorNotice error={error} />}{records === null && error === undefined && <p role="status">Loading reviews …</p>}
    {records?.length === 0 && <p>No one has reviewed this translation yet.</p>}
    {records && <ol className="review-history">{records.map(record => <li key={record.id}>
      <p><strong>{labelFor(decisionLabels, record.decision)}</strong> by {record.reviewer_pseudonym} · <time dateTime={record.created_at}>{formatDateTime(record.created_at)}</time></p>
      <p className="cell-secondary review-guideline">{submissionGuidelineLabel(record.guideline_version, record.guideline_withdrawn, null)}</p>
      <p className="cell-secondary">{[record.reviewer_qualification, record.reviewer_languages.length ? `reads ${record.reviewer_languages.join(", ")}` : ""].filter(Boolean).join(" · ")}</p>
      <p>{record.status_before === record.status_after ? `Translation status stayed ${labelFor(translationStatusLabels, record.status_after)}.` : `Translation status changed from ${labelFor(translationStatusLabels, record.status_before)} to ${labelFor(translationStatusLabels, record.status_after)}.`}</p>
      <p>{record.clinical_change ? "Clinical change" : "No clinical change"}{record.categories.length ? `: ${record.categories.map(category => labelFor(categoryLabels, category)).join(", ")}` : ""}</p>
      {record.rationale && <p>{record.rationale}</p>}{record.created_variant_id && <p>Created variant: {record.created_variant_id}</p>}
    </li>)}</ol>}
  </Dialog>;
}

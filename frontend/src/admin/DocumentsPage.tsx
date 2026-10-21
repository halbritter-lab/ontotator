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
  type TranslationReviewRecord,
  type VariantSummary,
} from "../api/client";
import { formatDateTime, labelFor, plural } from "../app/labels";
import { DOCUMENT_FIELDS, routeHref, type NavigateOptions, type ProjectDocumentsQuery, type Route } from "../app/router";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { submissionGuidelineLabel } from "../guidelines/submissionLabel";
import { Button, Checkbox, Dialog, EmptyState, FilterChip, InlineMessage, StatusBadge, tabId, Toast, Toolbar, useMediaQuery, useToast, type GroupSelectMode } from "../ui";
import { DocumentsTabs, TabEmptyState } from "../documents/DocumentsTabs";
import { DocumentsSearch, LiveRegion, type DocumentsSearchHandle, type LiveRegionHandle } from "../documents/DocumentsSearch";
import { activeTab, chipsOf, clearAllPatch, filtersActive, listOf, rowsRequest, tabCount } from "../documents/filterModel";
import { FilterPopover } from "../documents/FilterPopover";
import { DocumentCards } from "../documents/DocumentCards";
import { DocumentsTable, type HeaderSort, type TableSelection } from "../documents/DocumentsTable";
import { ExpandedRow, type ExpandedRowProps } from "../documents/ExpandedRow";
import { panelStep } from "../documents/finalPanelText";
import type { MenuItem } from "../ui/MenuButton";
import { TranslationCorrectionAction } from "../variants/TranslationCorrectionAction";
import { FinalPanel, type PanelSection } from "../documents/FinalPanel";
import { HandleTextChangeDialog } from "../documents/HandleTextChangeDialog";
import { CarryDialog, carrySourceOfFinal, carrySourceOfStep, type CarrySource } from "../documents/CarryDialog";
import { PlanChips, PlanRowNotice, usePlanSaves } from "../documents/PlanChips";
import { useShortcut, useShortcutHint } from "../ui/shortcuts";
import { ResolveTranslation } from "../documents/ResolveTranslation";
import { SelectByIdsDialog } from "../documents/SelectByIdsDialog";
import { SelectionBar } from "../documents/SelectionBar";
import { documentsGroupId, documentsRowId, isPlainClick, type DocumentsRowPart, RouteLink, rowKeyOf, rowName } from "../documents/RowCells";
import type { TextVersionsTools } from "../documents/TextVersions";
import { workText } from "../documents/labels";
import { caseOfTextKey, languageOfTextKey, MAX_SELECTION_CASES as MAX_SELECTION, textKeyOf, useTextSelection } from "../documents/useTextSelection";
import { useDocumentRows } from "../documents/useDocumentRows";
import { notifyDocumentsChanged } from "../documents/documentsEvents";
import { useRowSubmissions } from "../documents/useRowSubmissions";
import { clearVisits, recordDecision, rememberShown, retainedKeys, rowBadges, type RowBadge } from "../documents/visitState";
import { notifyFinalSelectionChanged } from "../variants/finalSelectionState";
import { AssignWorkDialog, type AssignWorkDialogProps } from "./AssignWorkDialog";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";
import { reviewLanguages, translationStatusLabels } from "./variantMetadata";

export interface DocumentsPageProps {
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route, options?: NavigateOptions) => void;
  /** Lead access (`ProjectSummary.can_manage`); checked before anything loads. */
  canManage: boolean;
  canOverrideTranslationStatus?: boolean;
  currentUser?: Pick<CurrentUser, "username" | "pseudonym">;
}

/** Below 700 px the page renders cards instead of the table (the same breakpoint as popover sheets and the side panel). */
export const NARROW_DOCUMENTS_QUERY = "(max-width: 699px)";

export { ID_FILTER_DELAY_MS } from "../documents/DocumentsSearch";
/** The table's eight columns; "Select" and "Action" headers are visually hidden. */
const SKELETON_HEADERS: readonly (readonly [string, boolean])[] = [
  ["Select", true], ["Text", false], ["Review", false], ["Annotation", false], ["Final", false], ["Waiting on", false], ["Action", true], ["Last activity", false],
];
/** ID of the tab panel around the table (the Documents tabs control it). */
const PANEL_ID = "documents-panel";

/** The Documents fields of a route (the page receives the whole route as `query`). */
function documentsQuery(query: ProjectDocumentsQuery): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) if (query[field] !== undefined && query[field] !== "") result[field] = query[field];
  if (query.open?.length) result.open = [...query.open];
  return result;
}

/** The Documents filters for the selection summary and the batch assign dialog: every filter except paging, sort and retain. */
export function selectionFilters(request: DocumentRowsRequest): DocumentRowFilters {
  const { page: _page, sort: _sort, retain: _retain, ...filters } = request;
  return filters;
}

/** The batch dialog's case order: descending orders fall back to their ascending order. */
function batchSort(sort: DocumentRowsRequest["sort"]): "case" | "import" | "activity" {
  if (sort === "-case" || sort == null) return "case";
  return sort === "-activity" ? "activity" : sort;
}

/** "Selection is limited to 2000 cases. Selected the first 2000." (texts of at most 2000 cases, VD4) */
export const SELECTION_LIMITED = `Selection is limited to ${MAX_SELECTION} cases. Selected the first ${MAX_SELECTION}.`;

const rowElement = (key: string, part: DocumentsRowPart): HTMLElement | null =>
  document.getElementById(documentsRowId(caseOfTextKey(key), languageOfTextKey(key), part));

/**
 * Resolve options of a row: rule 4 "Resolve…" or rule 4a "Assign review or accept…". They render inline
 * under the row (documents overview Change 13); focus goes to their heading (F5).
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
  const request = rowsRequest(query);
  const requestIdentity = JSON.stringify(request);
  const filterIdentity = JSON.stringify({ ...request, page: undefined, case: undefined });
  // Visit state (Resolved / Changed badges) exists only under a decision or segment filter; it is keyed
  // by the filters without page and case, so paging keeps the badges and a filter change starts a new visit.
  const decisionActive = request.decision !== undefined || request.final === "missing" || request.segment !== undefined;
  const [retainState, setRetainState] = useState<{ identity: string; keys: readonly string[] } | null>(null);
  const retain = !decisionActive ? []
    : retainState?.identity === filterIdentity ? retainState.keys : retainedKeys(projectKey, filterIdentity);
  // Visit baseline for NEW (VD6): once per mount (the component is keyed by project and user), not on refetch, tab or
  // filter change. The first rows request waits for it (or its failure), so NEW never compares against an older baseline.
  const [visitRecorded, setVisitRecorded] = useState(false);
  const visited = useRef(false);
  useEffect(() => {
    if (visited.current) return;
    visited.current = true;
    void api.recordDocumentsVisit(projectKey).catch(() => { /* NEW then compares against the previous baseline. */ })
      .finally(() => setVisitRecorded(true));
  }, [projectKey]);
  // `useDocumentRows` is typed with one value per filter; the client sends lists as repeated parameters.
  const rows = useDocumentRows(projectKey, (retain.length ? { ...request, retain: [...retain] } : request) as DocumentRowsQuery, { enabled: visitRecorded });
  const page: DocumentRowsPage | null = rows.page;

  // The page's one polite live region (its own component: an announcement re-renders only the region).
  const liveRegion = useRef<LiveRegionHandle>(null);
  const announce = (message: string) => liveRegion.current?.announce(message);

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
  const deepLanguages = listOf(query.language);
  const deepKey = query.case && deepLanguages.length === 1 ? `${query.case}:${deepLanguages[0]}` : null;
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

  // The latest requested Documents query: a navigation applies asynchronously (App `requestRoute`, last wins), so two
  // navigations of one commit (the panel's advance and the badge collapse in their effects) build on each other, not on
  // this render's query. After that commit the route is the base again.
  const requested = useRef<ProjectDocumentsQuery | null>(null);
  const documentsQueryOf = (patch: ProjectDocumentsQuery): ProjectDocumentsQuery => {
    const next: ProjectDocumentsQuery = {};
    for (const [name, value] of Object.entries({ ...(requested.current ?? query), ...patch })) {
      if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) Object.assign(next, { [name]: value });
    }
    return next;
  };
  const documentsRoute = (patch: ProjectDocumentsQuery): Route => ({ name: "projectDocuments", key: projectKey, ...documentsQueryOf(patch) });
  /** Navigates within the page; later navigations of the same commit start from this one. */
  const navigateDocuments = (patch: ProjectDocumentsQuery, options?: NavigateOptions) => {
    const next = documentsQueryOf(patch);
    requested.current = next;
    queueMicrotask(() => { if (requested.current === next) requested.current = null; });
    const route: Route = { name: "projectDocuments", key: projectKey, ...next };
    if (options) onNavigate(route, options); else onNavigate(route);
  };
  const changeFilter = (patch: ProjectDocumentsQuery) => navigateDocuments({ ...patch, page: undefined, select: undefined });

  // Search: its own component, so a keystroke re-renders only the field.
  const search = useRef<DocumentsSearchHandle>(null);

  // Chips: after a removal focus moves to the next chip (now at the removed chip's index) or the search field.
  const chipList = useRef<HTMLDivElement>(null);
  const [chipFocus, setChipFocus] = useState<number | null>(null);
  const people = useMemo(() => new Map((inventory?.members ?? []).filter(member => member.display_name?.trim())
    .map(member => [member.pseudonym, member.display_name.trim()] as const)), [inventory]);
  const chips = chipsOf(query, people);
  const chipIdentity = chips.map(chip => chip.id).join("\n");
  useEffect(() => {
    if (chipFocus === null) return;
    setChipFocus(null);
    const buttons = chipList.current?.querySelectorAll<HTMLButtonElement>("button.ui-filter-chip");
    const chip = buttons?.[chipFocus];
    if (chip) chip.focus(); else search.current?.focus();
    // Only a changed chip list (the route after the removal) moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipIdentity]);
  const removeChip = (index: number) => {
    setChipFocus(index);
    changeFilter(chips[index].patch);
  };
  const clearAll = () => {
    search.current?.reset();
    changeFilter(clearAllPatch(query));
    search.current?.focus();
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
    navigateDocuments({ open: [...next] }, { replace: true });
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
      navigateDocuments({ open: [...openKeys].filter(key => !collapse.includes(key)) }, { replace: true });
    }
    // Only a new page carries new row states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const pageRows = useMemo(() => page?.groups.flatMap(group => group.rows) ?? [], [page]);
  const groupOf = (caseId: string) => page?.groups.find(group => group.case_id === caseId);

  const latestReload = useRef(rows.reload);
  latestReload.current = rows.reload;
  const refreshAll = () => { rows.reload(); setRevision(value => value + 1); notifyDocumentsChanged(); };
  /** Refetch after an own action; the navigation counter reloads too ("documents-changed"). */
  const reloadAfterAction = () => { latestReload.current(); notifyDocumentsChanged(); };
  // Assign dialog: one row (task preselected) or the selected cases (selection bar).
  const [assignDialog, setAssignDialog] = useState<AssignWorkDialogProps | null>(null);
  /** Assign dialog for one row; `options.newReviewOfAccepted` marks a new review of an accepted translation (D25). */
  const onAssign = (row: DocumentRowView, task: AssignTask, options?: { newReviewOfAccepted?: boolean; reviewReason?: "source_changed" }) => {
    setAssignDialog({
      mode: "row", projectKey, row, task, newReviewOfAccepted: options?.newReviewOfAccepted, reviewReason: options?.reviewReason,
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
      ...(query.language ? [documentsRowId(caseId, query.language, "header"), documentsRowId(caseId, query.language, "disclosure")] : []),
      documentsGroupId(caseId),
      ...(group?.rows.flatMap(item => [documentsRowId(item.case_id, item.language, "header"), documentsRowId(item.case_id, item.language, "disclosure")]) ?? []),
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
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Plan chips: one shared queue and toast; a save refetches the rows (the next step updates in place).
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const planSaves = usePlanSaves({ projectKey, onAnnounce: announce, onChanged: () => reloadAfterAction(), showToast });
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
    ? `Select the first ${MAX_SELECTION} of ${filteredTotal} filtered cases`
    : filteredTotal === 1 ? "Select the filtered case" : `Select all ${filteredTotal} filtered cases`;
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
      const added = selection.add(keys);
      applyLimit(added.truncated || result.truncated);
      // Only the texts that fit under the case cap: the header shows checked and its next click clears them.
      setAllFiltered({ identity, keys: keys.filter(key => added.selected.has(key)) });
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
  const [rowPanel, setRowPanel] = useState<RowPanel | null>(null);
  /** The rendered Resolve options under the row. */
  const panelBox = useRef<HTMLDivElement>(null);
  const openPanel = (row: DocumentRowView, mode: RowPanel["mode"]) => {
    setRowPanel({ rowKey: rowKeyOf(row), mode });
  };
  /** Row whose expansion opens Text versions (the panel's Text versions link). */
  const [revealFor, setRevealFor] = useState<string | null>(null);
  // Links away from the page never carry the open panel (a row action from the panel closes it first).
  const { panel: _panel, ...linkQuery } = viewQuery;
  const reportRoute = (reportId: string, extra: { section?: "decide"; action?: "resume" }): Route => ({
    name: "projectProblemReport", key: projectKey, reportId, ...extra, ...(Object.keys(linkQuery).length ? { documents: linkQuery } : {}),
  });
  // Text-change dialogs; they read the current row, so a reload after a conflict shows the new state.
  const [textChange, setTextChange] = useState<{ kind: "handle"; rowKey: string; step: NextStepView } | { kind: "carry"; rowKey: string; source: CarrySource } | null>(null);
  const lastTextChangeRow = useRef<DocumentRowView | null>(null);
  const textChangeOnPage = textChange ? pageRows.find(entry => rowKeyOf(entry) === textChange.rowKey) ?? null : null;
  if (textChangeOnPage) lastTextChangeRow.current = textChangeOnPage;
  // A refresh that drops the row (it left the filter or page) keeps the dialog on the row's last state.
  const textChangeRow = textChangeOnPage
    ?? (textChange && lastTextChangeRow.current && rowKeyOf(lastTextChangeRow.current) === textChange.rowKey ? lastTextChangeRow.current : null);
  const textChangeDone = (message: string) => { setTextChange(null); showToast({ message }); announce(message); reloadAfterAction(); };
  const textChangeDialog = !textChange || !textChangeRow ? null : textChange.kind === "handle" ? (() => {
    const step = (textChangeRow.steps ?? []).find(entry => entry.action === "handle_text_change" && entry.assignment_id === textChange.step.assignment_id) ?? textChange.step;
    // The paused task's report: the step's, the row's pause cause or a report on that assignment.
    const reportId = pausedReportId(textChangeRow, step)
      ?? [...textChangeRow.issues, ...textChangeRow.notes].find(item => item.assignment_id === step.assignment_id && item.report_id)?.report_id ?? null;
    return <HandleTextChangeDialog projectKey={projectKey} row={textChangeRow} step={step}
      onClose={() => setTextChange(null)} onDone={textChangeDone} onReload={() => rows.reload()}
      onDecideReport={reportId ? () => { setTextChange(null); onNavigate(reportRoute(reportId, { section: "decide" })); } : undefined} />;
  })() : <CarryDialog projectKey={projectKey} row={textChangeRow} source={textChange.source}
    onClose={() => setTextChange(null)} onDone={textChangeDone} onReload={() => rows.reload()}
    onFromScratch={() => { const row = textChangeRow; setTextChange(null); reloadAfterAction(); onAssign(row, "annotate"); }} />;
  const onAction = (row: DocumentRowView, step: NextStepView) => {
    const key = rowKeyOf(row);
    switch (step.action) {
      case "assign_translation_review": void onAssign(row, "translation_review"); return;
      case "assign_annotation": void onAssign(row, "annotate"); return;
      case "choose_final":
      case "review_changes":
        setRowPanel(null);
        openFinalPanel(key);
        return;
      // Text changes (V5): one dialog per old-version item; the "+n" menu lists one entry per person.
      case "handle_text_change": setTextChange({ kind: "handle", rowKey: key, step }); return;
      case "carry_text_change": setTextChange({ kind: "carry", rowKey: key, source: carrySourceOfStep(row, step) }); return;
      case "assign_source_review": void onAssign(row, "translation_review", { reviewReason: "source_changed" }); return;
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
  // Final-result side panel (V6): route parameter `panel={case}:{language}`, so Back and the editor return to it.
  const panelKey = query.panel && query.panel.includes(":") ? query.panel : null;
  /** "Change final…": the panel opens on its compare content (until it closes; a reload shows the decided state). */
  const [changeFinalKey, setChangeFinalKey] = useState<string | null>(null);
  function openFinalPanel(key: string, options: { changeFinal?: boolean } = {}) {
    setChangeFinalKey(options.changeFinal ? key : null);
    navigateDocuments({ panel: key }, { replace: true });
  }
  /** Closes the panel in one navigation with `patch` (e.g. an expanded row); the dialog returns focus (`panelReturnFocus`). */
  const closeFinalPanel = (patch: ProjectDocumentsQuery = {}) => {
    setChangeFinalKey(null);
    navigateDocuments({ ...patch, panel: undefined }, { replace: true });
  };
  /** Focus after the panel: the shown row's action, else its row header, else the page heading. */
  const panelReturnFocus = () => (panelKey ? rowElement(panelKey, "action") ?? rowElement(panelKey, "header") : null) ?? headingRef.current;
  const expandedWith = (key: string): ProjectDocumentsQuery => ({ open: [...new Set([...openKeys, key])] });
  const panelSection = (row: DocumentRowView, section: PanelSection) => {
    const key = rowKeyOf(row);
    if (section === "versions") setRevealFor(key);
    closeFinalPanel(expandedWith(key));
  };
  const finalPanel = panelKey ? <FinalPanel projectKey={projectKey} rowKey={panelKey} page={page} query={viewQuery} refreshError={rows.error}
    username={currentUser?.username ?? ""} changeFinal={changeFinalKey === panelKey} returnFocus={panelReturnFocus}
    onClose={() => closeFinalPanel()}
    onDecided={key => { notifyFinalSelectionChanged(projectKey); recordDecision(projectKey, key); reloadAfterAction(); }}
    onAdvance={key => openFinalPanel(key)}
    onReload={() => rows.reload()}
    onNavigate={route => onNavigate(route)}
    onRowAction={(row, step) => { closeFinalPanel(); onAction(row, step); }}
    onAssign={row => { closeFinalPanel(); onAssign(row, "review"); }}
    // Interim (O7 replaces it with the carry dialog): the expansion opens Text versions.
    onCarry={(row, target) => {
      const source = carrySourceOfFinal(row, target);
      closeFinalPanel();
      if (source) setTextChange({ kind: "carry", rowKey: rowKeyOf(row), source });
    }}
    onSection={panelSection}
    onConsolidationStarted={row => {
      closeFinalPanel();
      const message = `Consolidation started for ${rowName(row)}.`;
      showToast({ message }); announce(message); refreshAll();
    }} /> : null;
  // Escape inside the options closes them; a discard confirmation inside handles its own Escape first (registered later).
  useShortcut("Escape", event => {
    const scope = panelBox.current;
    if (!rowPanel || !scope || !(event.target instanceof Node) || !scope.contains(event.target)) return false;
    closePanel(rowPanel.rowKey);
  }, { allowInInputs: true, enabled: rowPanel != null });

  // Lead actions that are no step, in the row's "+n" menu (also reachable without opening the expansion; annotation
  // review and consolidation stay in the final-result panel and the expansion).
  const [correctionFor, setCorrectionFor] = useState<{ row: DocumentRowView; variant: VariantSummary } | null>(null);
  /** The accepted newest translation a correction can be requested for (Text versions offers the same). */
  const correctionVariant = (row: DocumentRowView): VariantSummary | null => {
    if (row.is_source || !textVersionTools) return null;
    const newest = row.versions.find(version => version.is_newest_in_chain && version.translation_status === "accepted" && !version.discarded);
    return newest ? textVersionTools.variants.get(newest.document_id) ?? null : null;
  };
  const closeCorrection = () => { setCorrectionFor(null); reloadAfterAction(); };
  const rowExtras = (row: DocumentRowView): MenuItem[] => {
    const key = rowKeyOf(row);
    const items: MenuItem[] = [];
    if (row.final && !panelStep(row)) items.push({ id: "change-final", label: "Change final…", onSelect: () => openFinalPanel(key, { changeFinal: true }) });
    const variant = correctionVariant(row);
    if (variant) items.push({ id: "request-correction", label: "Request translation correction…", onSelect: () => setCorrectionFor({ row, variant }) });
    return items;
  };

  const renderExpanded = (row: DocumentRowView) => {
    const notice = rowNotice(row);
    const key = rowKeyOf(row);
    return <>
      {notice && <p className="documents-row-notice">{notice}</p>}
      <ExpandedRowLoader row={row} projectKey={projectKey} query={viewQuery} onNavigate={route => onNavigate(route)}
        textVersionTools={textVersionTools} me={currentUser?.pseudonym ?? null}
        plan={<PlanChips row={row} groupRevision={groupOf(row.case_id)?.plan_revision ?? 1} saves={planSaves} size={narrow ? "card" : "table"} />}
        planRevision={planSaves.revisionOf(row.case_id, groupOf(row.case_id)?.plan_revision ?? 1)} onAssign={onAssign}
        revealTextVersions={revealFor === key} onTextVersionsRevealed={() => setRevealFor(null)} headingLevel={narrow ? 5 : 3} />
    </>;
  };

  const resolvePanel = (row: DocumentRowView, panel: RowPanel): JSX.Element => {
    const key = rowKeyOf(row);
    const groupRevision = groupOf(row.case_id)?.plan_revision ?? 1;
    return <div ref={panelBox}>
      <ResolveTranslation key={panel.mode} mode={panel.mode} row={row} projectKey={projectKey} headingLevel={narrow ? 5 : 3}
        revision={planSaves.revisionOf(row.case_id, groupRevision)}
        onAssignReview={() => { setRowPanel(null); void onAssign(row, "translation_review"); }}
        onNavigate={route => onNavigate(route)}
        onDone={(message, saved) => {
          planSaves.noteRevision(saved.caseId, saved.revision);
          announce(message);
          reloadAfterAction();
          closePanel(key);
        }}
        onChanged={(caseId, revision) => { planSaves.noteRevision(caseId, revision); reloadAfterAction(); }}
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
      {panel && resolvePanel(row, panel)}
    </>;
  };

  const rowBadge = (row: DocumentRowView) => {
    const badge = badges.get(rowKeyOf(row));
    return badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>;
  };

  const tab = activeTab(query);
  const showAll: Route = { name: "projectDocuments", key: projectKey };
  const navigateLink = (target: Route) => onNavigate(target);
  const sourceLanguages = useMemo(() => new Set(pageRows.filter(row => row.is_source).map(row => row.language)), [pageRows]);

  /** No rows: the tab is empty (tab counts ignore facets and search), or the filters exclude every row of the tab. */
  const emptyState = (bar: DocumentRowsPage["bar"]): JSX.Element => {
    if (tabCount(bar, tab) === 0) return <TabEmptyState tab={tab} projectKey={projectKey} onNavigate={navigateLink} />;
    return <EmptyState title="No texts match these filters." action={<Button size="sm" onClick={clearAll}>Clear all</Button>} />;
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
      body = emptyState(page.bar);
    } else if (narrow) {
      body = <DocumentCards page={page} projectKey={projectKey} query={viewQuery} selection={tableSelection} onToggleRow={toggleRow} planSaves={planSaves}
        renderRowNotice={renderRowNotice} renderExpanded={renderExpanded} rowBadge={rowBadge} onAction={onAction} onNavigate={navigateLink} busy={rows.loading} rowExtras={rowExtras} />;
    } else {
      body = <DocumentsTable page={page} projectKey={projectKey} query={viewQuery} selection={tableSelection} planSaves={planSaves}
        onToggleRow={toggleRow} renderRowNotice={renderRowNotice} renderExpanded={renderExpanded} rowBadge={rowBadge} onAction={onAction} onNavigate={navigateLink} busy={rows.loading} rowExtras={rowExtras}
        sort={request.sort} onSort={(next: HeaderSort) => changeFilter({ sort: next === "case" ? undefined : next })} />;
    }
    // Sticky above the table; below 700 px after the cards, so it can stick to the bottom of the viewport.
    const selectionBar = <SelectionBar projectKey={projectKey} keys={selection.keys} filters={filters} refresh={page} narrow={narrow} limitNote={limitNote}
      onClear={clearSelection} onAssign={openAssignCases} showToast={showToast} onAnnounce={announce} onChanged={() => reloadAfterAction()}
      onRevisions={revisions => { for (const [caseId, value] of Object.entries(revisions)) planSaves.noteRevision(caseId, value); }} />;
    // While another filter or page loads, the previous page stays (busy) so the bar and paging links keep focus.
    content = <>
      {rows.error != null && <InlineMessage tone="error">Could not refresh · <Button size="sm" onClick={rows.retry}>Retry</Button></InlineMessage>}
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
    {page && <DocumentsTabs bar={page.bar} query={query} projectKey={projectKey} panelId={PANEL_ID} onNavigate={navigateLink} updatedAt={rows.updatedAt} onRefresh={refreshAll} />}
    <Toolbar label="Document filters" className="documents-filters">
      <DocumentsSearch ref={search} q={query.q} onApply={q => changeFilter({ q })} />
      <FilterPopover query={query} bar={page?.bar ?? null} sourceLanguages={sourceLanguages} onChange={changeFilter} onClearAll={clearAll} people={people} />
      {chips.length > 0 && <div ref={chipList} className="documents-filter-chips">
        {chips.map((chip, index) => <FilterChip key={chip.id} label={chip.label} onRemove={() => removeChip(index)} />)}
      </div>}
      {filtersActive(query) && <Button size="sm" variant="quiet" onClick={clearAll}>Clear all</Button>}
      {page && filtersActive(query) && <p className="documents-filter-count">{`${page.bar.shown} of ${tabCount(page.bar, tab)}`}</p>}
    </Toolbar>
    {settingsError !== undefined && <ErrorNotice error={settingsError} />}
    {inventoryError !== undefined && <ErrorNotice error={inventoryError} />}
    <div id={PANEL_ID} {...(page ? { role: "tabpanel", "aria-labelledby": tabId(PANEL_ID, tab) } : {})}>{content}</div>
    <LiveRegion ref={liveRegion} />
    <Dialog open={uploadOpen} title="Upload texts" size="lg" onClose={() => setUploadOpen(false)}>
      {uploadOpen && settings && <UploadPanel key={projectKey} projectKey={projectKey} languages={settings.languages ?? []} canOverrideTranslationStatus={canOverrideTranslationStatus}
        annotateAcceptedOnly={settings.annotate_accepted_translations_only ?? true} onImported={importDone} />}
    </Dialog>
    {reviewDocument !== null && <ReviewHistory key={reviewDocument} projectKey={projectKey} documentId={reviewDocument} onClose={() => setReviewDocument(null)} />}
    {assignDialog && <AssignWorkDialog {...assignDialog} />}
    {textChangeDialog}
    {finalPanel}
    {correctionFor && textVersionTools && <Dialog open title={`Request translation correction · ${rowName(correctionFor.row)}`} size="md"
      onClose={closeCorrection} footer={<Button onClick={closeCorrection}>Close</Button>}
      returnFocus={() => rowElement(rowKeyOf(correctionFor.row), "action") ?? rowElement(rowKeyOf(correctionFor.row), "header")}>
      <TranslationCorrectionAction projectKey={projectKey} variant={correctionFor.variant} username={textVersionTools.username}
        requiredLanguages={textVersionTools.requiredLanguages(correctionFor.variant.document_id)} defaultOpen inDialog />
    </Dialog>}
    {idsDialogOpen && <SelectByIdsDialog projectKey={projectKey} current={selection.cases} onClose={() => setIdsDialogOpen(false)} onSelect={selectByIds} />}
  </section>;
}

/** Skeleton rows while the first page loads. */
function DocumentsSkeleton(): JSX.Element {
  return <div className="data-table-scroll">
    <table aria-busy="true" className="data-table density-compact documents-table documents-skeleton">
      <caption className="visually-hidden">Documents</caption>
      <thead><tr>{SKELETON_HEADERS.map(([header, hidden]) => <th key={header} scope="col">{hidden ? <span className="visually-hidden">{header}</span> : header}</th>)}</tr></thead>
      <tbody>{[0, 1, 2, 3, 4].map(index => <tr key={index} className="documents-skeleton-row">
        {SKELETON_HEADERS.map(([header]) => <td key={header}><span className="documents-skeleton-bar" aria-hidden="true" /></td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

interface ExpandedRowLoaderProps {
  row: DocumentRowView;
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
  textVersionTools?: TextVersionsTools;
  me: ExpandedRowProps["me"];
  plan: ExpandedRowProps["plan"];
  planRevision?: ExpandedRowProps["planRevision"];
  onAssign?: ExpandedRowProps["onAssign"];
  headingLevel?: ExpandedRowProps["headingLevel"];
  revealTextVersions: boolean;
  onTextVersionsRevealed: () => void;
}

/** Submissions of a row, reloaded when a refreshed rows page reports new activity on the row. */
function useRefreshedSubmissions(projectKey: string, row: DocumentRowView) {
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, true);
  const mounted = useRef(false);
  const { reload } = submissions;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    reload();
    // Only new activity on the row triggers the reload (not every background refresh of the page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.last_activity_at]);
  return submissions;
}

/** The slim expansion of an open row with its submissions (history times, consolidation, technical details). */
function ExpandedRowLoader({ row, projectKey, ...props }: ExpandedRowLoaderProps): JSX.Element {
  const submissions = useRefreshedSubmissions(projectKey, row);
  return <ExpandedRow row={row} projectKey={projectKey} submissions={submissions} {...props} />;
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

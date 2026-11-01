/**
 * Typed client for the Ontotator API. The session lives in an HttpOnly cookie;
 * writes carry the session's CSRF token.
 */

import type { components, operations } from "./generated";
import { attachmentFilename, type DownloadPayload } from "./download";
export type { DownloadPayload } from "./download";

export type ProjectDocumentSummary = components["schemas"]["ProjectDocumentSummary"];
type VariantMetadataKeys = "case_id" | "external_id" | "version" | "origin" | "translation_status" | "status_reason" | "accepted_without_review";
/** Legacy editor navigation also composes reduced WorkspaceService summaries. */
export type DocumentSummary = Omit<ProjectDocumentSummary, VariantMetadataKeys> & Partial<Pick<ProjectDocumentSummary, VariantMetadataKeys>>;
export type ProjectSettings = components["schemas"]["ProjectSettings"];
export type UploadView = components["schemas"]["UploadView"];
export type UploadCreated = components["schemas"]["UploadCreated"];
export type UploadStatus = NonNullable<NonNullable<operations["list_uploads_api_v1_projects__key__uploads_get"]["parameters"]["query"]>["status"]>[number];
export type ImportPlan = components["schemas"]["ImportPlan"];
export type JobView = components["schemas"]["JobView"];
export type ProjectProgress = components["schemas"]["ProjectProgress"];
export type ProgressLedeView = components["schemas"]["ProgressLedeView"];
export type ProgressStageView = components["schemas"]["ProgressStageView"];
export type ProgressStagesView = components["schemas"]["ProgressStagesView"];
export type ProgressWorkloadView = components["schemas"]["ProgressWorkloadView"];
export type ExportKind = components["schemas"]["ExportRequest"]["kind"];
export type ExportCreated = components["schemas"]["ExportCreated"];
export interface ProjectDocumentFilters { language?: string; status?: string; q?: string; origin?: string; translation_status?: string }
export type StatusOverride = components["schemas"]["StatusOverride"];
export type ReviewInputsRequest = components["schemas"]["ReviewInputsRequest"];
export type EditorProposal = components["schemas"]["EditorProposal"];
export type ProposalSetView = components["schemas"]["ProposalSetView"];
export type AnnotationSnapshot = components["schemas"]["AnnotationSnapshot"];
export type Modifier = components["schemas"]["Modifier"];
/** A text segment in Unicode code points. */
export interface SegmentPayload { start: number; end: number }
/** Payload of the `add_modifier` command (backend `AddModifierCommand`). */
export interface AddModifierPayload { command: "add_modifier"; annotation_id: string; term_id: string; segments?: SegmentPayload[] }
/** Payload of `set_modifier_segments`; `[]` removes the modifier's text span. */
export interface SetModifierSegmentsPayload { command: "set_modifier_segments"; annotation_id: string; term_id: string; segments: SegmentPayload[] }
/** Payload of `remove_modifier`. */
export interface RemoveModifierPayload { command: "remove_modifier"; annotation_id: string; term_id: string }
/** Payload of `convert_to_modifier` (old data, R3). */
export interface ConvertToModifierPayload { command: "convert_to_modifier"; annotation_id: string; target_annotation_id: string; link_span?: boolean }
export type FinalPreflight = components["schemas"]["FinalPreflight"];
export type FinalSelectionView = components["schemas"]["FinalSelectionView"];
export type FinalExportRequest = components["schemas"]["FinalExportRequest"];
export type DocumentRowsPage = components["schemas"]["DocumentRowsPage"];
export type DocumentRowView = components["schemas"]["DocumentRowView"];
export type DocumentGroupView = components["schemas"]["DocumentGroupView"];
export type DocumentVersionView = components["schemas"]["DocumentVersionView"];
export type DecisionBarView = components["schemas"]["DecisionBarView"];
export type RowItemView = components["schemas"]["RowItemView"];
export type FinalSelectionSummary = components["schemas"]["FinalSelectionSummary"];
export type RowSubmissions = components["schemas"]["RowSubmissions"];
export type RowSubmissionView = components["schemas"]["RowSubmissionView"];
export type RowRoundView = components["schemas"]["RowRoundView"];
export type OpenTranslationReviewView = components["schemas"]["OpenTranslationReviewView"];
// Final-result panel of one Documents row (documents overview V6, V9, VD16)
export type FinalPanelView = components["schemas"]["FinalPanelView"];
export type FinalPanelSubmissionView = components["schemas"]["FinalPanelSubmissionView"];
export type AgreementView = components["schemas"]["AgreementView"];
// Next step per Documents row (lead workflow L1)
export type NextStepView = components["schemas"]["NextStepView"];
export type StepOwnerView = components["schemas"]["StepOwnerView"];
export type StepDetailView = components["schemas"]["StepDetailView"];
export type DocumentCaseIds = components["schemas"]["DocumentCaseIds"];
// Stage cells and version marker per Documents row (documents overview O0c)
export type StageCellView = components["schemas"]["StageCellView"];
export type StageCellDetailView = components["schemas"]["StageCellDetailView"];
export type RowStagesView = components["schemas"]["RowStagesView"];
export type VersionMarkerView = components["schemas"]["VersionMarkerView"];
// Work plan (lead workflow L0)
export type PersonRefView = components["schemas"]["PersonRefView"];
export type PlanFlagsView = components["schemas"]["PlanFlagsView"];
export type ConsequencesView = components["schemas"]["ConsequencesView"];
export type WithdrawnTaskView = components["schemas"]["WithdrawnTaskView"];
export type OpenReportView = components["schemas"]["OpenReportView"];
/** Request fields with server defaults stay optional for callers. */
type Defaulted<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type PlanRowPatch = Defaulted<components["schemas"]["PlanRowPatch"], "confirm">;
export type PlanRowResult = components["schemas"]["PlanRowResult"];
export type LanguageChangeRequest = Partial<components["schemas"]["LanguageChangeView"]>;
export type BulkPlanRequest = Omit<components["schemas"]["BulkPlanRequest"], "languages" | "confirm"> & { languages?: Record<string, LanguageChangeRequest>; confirm?: boolean };
export type BulkPreview = components["schemas"]["BulkPreview"];
export type BulkResult = components["schemas"]["BulkResult"];
export type PlanRowsSet = Defaulted<components["schemas"]["PlanRowsSet"], "undo" | "confirm">;
export type UndoView = components["schemas"]["UndoView"];
export type CaseIdLookupResult = components["schemas"]["CaseIdLookupResult"];
export type AnnotationTargetPreview = components["schemas"]["AnnotationTargetPreview"];
export type DiscardRequest = Defaulted<components["schemas"]["DiscardRequest"], "confirm">;
export type DiscardResult = components["schemas"]["DiscardResult"];
// Annotation-mode change after submissions, and its restore
export type RowChangeView = components["schemas"]["RowChangeView"];
export type ModeChangeTarget = components["schemas"]["ModeChangeTarget"];
export type ModeChangeRequest = components["schemas"]["ModeChangeRequest"];
export type ModeChangePreview = components["schemas"]["ModeChangePreview"];
export type ModeChangeView = components["schemas"]["ModeChangeView"];
export type ModeChangeList = components["schemas"]["ModeChangeList"];
export type ModeChangeResult = components["schemas"]["ModeChangeResult"];
export type UploadWorkPlan = components["schemas"]["UploadWorkPlan"];
// Batch assignment and selection summary (lead workflow L1b)
export type DocumentRowFilters = components["schemas"]["DocumentRowFilters"];
/** `case_ids` stays required for callers (`[]` when sending `rows`, VD21); the server takes exactly one non-empty selection. */
export type BatchAssignRequest = Defaulted<Omit<components["schemas"]["BatchAssignRequest"], "case_ids"> & { case_ids: string[] }, "sort" | "filters" | "usernames" | "review_accepted_translation" | "rows">;
export type BatchAssignBody = BatchAssignRequest & Defaulted<Pick<components["schemas"]["BatchAssignBody"], "expected_preview_digest" | "confirm_language" | "confirm_unreviewed_translation">, "confirm_language" | "confirm_unreviewed_translation">;
export type BatchSkipView = components["schemas"]["BatchSkipView"];
/** `unreviewed_translation` stays optional for callers and older fixtures (it defaults to false). */
export type BatchTargetView = Defaulted<components["schemas"]["BatchTargetView"], "unreviewed_translation">;
export type BatchPersonView = components["schemas"]["BatchPersonView"];
export type BatchPreview = Omit<components["schemas"]["BatchPreview"], "targets"> & { targets: BatchTargetView[] };
export type BatchAssignResult = components["schemas"]["BatchAssignResult"];
export type AssignableStepView = components["schemas"]["AssignableStepView"];
export type SelectionSummary = components["schemas"]["SelectionSummary"];
/** A text of a case: one Documents row (documents overview VD4). */
export type RowRefView = components["schemas"]["RowRefView"];
/** A selection: whole cases (case IDs) or single texts (`rows`, VD21). */
export type RowSelection = readonly string[] | { readonly rows: readonly RowRefView[] };
export type DocumentRowKeysRequest = Defaulted<components["schemas"]["DocumentRowKeysRequest"], "sort">;
export type DocumentRowKeys = components["schemas"]["DocumentRowKeys"];
export type DocumentsVisitView = components["schemas"]["DocumentsVisitView"];
export type DocumentsSummaryView = components["schemas"]["DocumentsSummaryView"];
/** Optional work-plan part of an upload commit (absent: the old body is sent). */
export type CommitUploadPlan = Partial<Pick<components["schemas"]["CommitUpload"], "plan_languages" | "plan_cases" | "accept_external_review">>;
type RowsParameters = Omit<NonNullable<operations["document_rows_api_v1_projects__key__document_rows_get"]["parameters"]["query"]>, "retain">;
type CaseIdsParameters = NonNullable<operations["document_case_ids_api_v1_projects__key__document_rows_case_ids_get"]["parameters"]["query"]>;
/** Repeatable filters (`language`, `origin`, `step`, `stage`, `plan`, stage states, `waiting_on`, `flags`, `proposals`) with one value each. */
type SingleFilters<Query> = { [Name in keyof Query]: NonNullable<Query[Name]> extends readonly (infer Item)[] ? Item | null : Query[Name] };
/** Repeatable filters with one value or several (OR); sent as repeated parameters. */
type RepeatableFilters<Query> = { [Name in keyof Query]: NonNullable<Query[Name]> extends readonly (infer Item)[] ? Item | Item[] | null : Query[Name] };
/** Filters of the Documents read API, one value per filter; `retain` keys are "{case_id}:{language}". */
export type DocumentRowsQuery = SingleFilters<RowsParameters> & { retain?: readonly string[]; selected?: readonly RowRefView[] };
/** Filters of the filtered case IDs (the Documents filters without page and retain), one value per filter. */
export type DocumentCaseIdsQuery = SingleFilters<CaseIdsParameters>;
/** Documents rows request: every repeatable filter may hold several values (FD10, documents overview facets). */
export type DocumentRowsRequest = RepeatableFilters<RowsParameters> & { retain?: readonly string[]; selected?: readonly RowRefView[] };
/** Filtered case IDs request: every repeatable filter may hold several values (FD10, documents overview facets). */
export type DocumentCaseIdsRequest = RepeatableFilters<CaseIdsParameters>;
/** One Progress count's Documents query (FD11). */
export type DocumentLinkQuery = components["schemas"]["DocumentLinkQuery"];

/** Documents filters as query parameters: arrays repeat, empty values are omitted. */
function filterParams(filters: Readonly<Record<string, unknown>>, skip: readonly string[] = []): URLSearchParams {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (skip.includes(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== "") query.append(name, String(item));
    }
  }
  return query;
}

function isCaseIds(selection: RowSelection): selection is readonly string[] {
  return Array.isArray(selection);
}
export type SubmissionHistorySummary = components['schemas']['SubmissionHistorySummary'];
export type SubmissionHistoryDetail = components['schemas']['SubmissionHistoryDetail'];
export type OpenWorkspaceRequest = components["schemas"]["OpenWorkspaceRequest"];
export type OpenWorkspaceResponse = components["schemas"]["OpenWorkspaceResponse"];
export type WorkRoundView = components["schemas"]["WorkRoundView"];
export type RoundInputView = components["schemas"]["RoundInputView"];
export type RoundSourceView = components["schemas"]["RoundSourceView"];
// Consolidation view (acceptance fixes 2026-10-21, WP-E)
export type ConsolidationView = components["schemas"]["ConsolidationView"];
/** Payload of `resolveConsolidationGroup` (backend `ResolveCommand`; the envelope payload is untyped in the OpenAPI). */
export interface ConsolidationResolvePayload {
  input_ids: string[];
  action: "keep" | "choose" | "leave_out";
  /** Only with `choose`. Omit `note_from_input_id` to keep the span member's note; `null` drops it. */
  choice?: {
    term_id: string;
    span_from_input_id: string;
    axes: Record<string, string | null>;
    note_from_input_id?: string | null;
    /** Omitted: the span member's modifiers. */
    modifiers?: { term_id: string; segments: SegmentPayload[] }[];
  };
  note?: string | null;
  guidelines_unclear?: boolean;
  /** A cons-… annotation id; only with `leave_out` on a `modifier_as_finding` group. */
  attach_to?: string;
}
/** Payload of `annotateConsolidationGroup` (backend `AnnotateCommand`); omit `note` to keep it. */
export interface ConsolidationAnnotatePayload {
  input_ids: string[];
  note?: string | null;
  guidelines_unclear: boolean;
}
/** Payload of `reopenConsolidationGroup` (backend `ReopenCommand`). */
export interface ConsolidationReopenPayload {
  input_ids: string[];
}
export type ConsolidationGroupView = components["schemas"]["ConsolidationGroupView"];
export type ConsolidationMemberView = components["schemas"]["ConsolidationMemberView"];
export type ConsolidationModifierView = components["schemas"]["ConsolidationModifierView"];
export type ConsolidationPersonView = components["schemas"]["ConsolidationPersonView"];
// Carried review (editor-carried-review plan)
export type AssignmentSubmissionView = components["schemas"]["AssignmentSubmissionView"];
export type SourceObligationView = components["schemas"]["SourceObligationView"];
export type CorrectionAssignmentRequest = components["schemas"]["CorrectionAssignmentRequest"];
export type LeadCorrectionRequest = components["schemas"]["LeadCorrectionRequest"];
export type ResolveSourceObligationRequest = components["schemas"]["ResolveSourceObligationRequest"];
export type ProblemReportRequest = components["schemas"]["ProblemReportRequest"];
export type ProblemActionRequest = components["schemas"]["ProblemActionRequest"];
export type ProblemReportView = components["schemas"]["ProblemReportView"];
export type ReportEventView = components["schemas"]["ReportEventView"];
export type ReportHoldView = components["schemas"]["ReportHoldView"];
export type AffectedTask = components["schemas"]["AffectedTask"];
export type PauseCandidate = components["schemas"]["PauseCandidate"];
export type ActiveHoldView = components["schemas"]["ActiveHoldView"];
export type CreateRoundRequest = components["schemas"]["CreateRoundRequest"];
export type StartConsolidationRequest = components["schemas"]["StartConsolidationRequest"];
export type StartConsolidationResponse = components["schemas"]["StartConsolidationResponse"];
export type MutationEnvelope = components["schemas"]["MutationEnvelope"];
export type Draft = components["schemas"]["Draft"];
export type Submission = components["schemas"]["Submission"];
export type SearchRequest = components["schemas"]["SearchRequest"];
export type SearchResult = components["schemas"]["SearchResult"];
export type SearchCandidate = components["schemas"]["SearchCandidate"];
export type TreeNode = components["schemas"]["TreeNode"];
export type TreeLevel = components["schemas"]["TreeLevel"];
export type TreeTermDetail = components["schemas"]["TreeTermDetail"];
export type TreeOpenRequest = components["schemas"]["TreeOpenRequest"];
export type TreeOpenResponse = components["schemas"]["TreeOpenResponse"];
export type TreeNodeRequest = components["schemas"]["TreeNodeRequest"];
export type TreeNodeResponse = components["schemas"]["TreeNodeResponse"];
export type AxisDefinition = components["schemas"]["AxisDefinition"];
export type AxesValues = Record<string, string | null>;
export type Axes = AxesValues;
export type LayerDefinition = components["schemas"]["LayerDefinition"];
export type TaskScope = components["schemas"]["TaskScope"];
export type AnnotationTypeDefinition = components["schemas"]["AnnotationTypeDefinition"];
export type OntologyDefinition = components["schemas"]["OntologyDefinition"];
export type Preferences = components["schemas"]["Preferences"];
export type PreferencesUpdate = components["schemas"]["PreferencesUpdate"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type TaskSummary = components["schemas"]["TaskSummary"];
export type AssignmentWorkspace = components["schemas"]["AssignmentOpenResponse"];
export type AssignmentOpenRequest = components["schemas"]["AssignmentOpenRequest"];
export type CaseSummary = components["schemas"]["CaseSummary"];
export type CaseDetail = components["schemas"]["CaseDetail"];
export type VariantSummary = components["schemas"]["VariantSummary"];
export type VariantText = components["schemas"]["VariantText"];
export type VersionRef = components["schemas"]["VersionRef"];
export type TextLayerEntry = components["schemas"]["TextLayerEntry"];
export type AnnotationVersion = components["schemas"]["AnnotationVersion"];
export type ReviewWorkspace = components["schemas"]["ReviewWorkspace"];
export type TranslationReviewRecord = components["schemas"]["TranslationReviewRecord"];
export type ReanchorItem = components["schemas"]["ReanchorItem"];
export type PendingReanchorRef = components["schemas"]["PendingReanchorRef"];
export type ReanchorResolution = components["schemas"]["ReanchorResolution"];
export type TranslationReviewDraftRequest = components["schemas"]["DraftRequest"];
export type TranslationReviewDraftResponse = components["schemas"]["DraftResponse"];
export type TranslationReviewSubmitRequest = components["schemas"]["SubmitRequest"];
export type CaseFilters = NonNullable<operations["list_cases_api_v1_projects__key__cases_get"]["parameters"]["query"]>;
/** The logged-in user; `csrf_token` goes back in `X-CSRF-Token` with every write. */
export type CurrentUser = components["schemas"]["CurrentUser"];
export type SessionState = components["schemas"]["SessionState"];
export type Profile = components["schemas"]["Profile"];
/** Version and Git commit of the running app, for the Help page. */
export type About = components["schemas"]["About"];
/** PATCH distinguishes omitted defaults from explicit null/false values. */
export type OwnProfilePatch = Partial<components["schemas"]["ProfilePatch"]>;
export type PasswordChange = components["schemas"]["PasswordChange"];
export type AdminUser = components["schemas"]["AdminUser"];
export type CreateUserRequest = components["schemas"]["CreateUserRequest"];
export type CreatedUser = components["schemas"]["CreatedUser"];
export type AuditEvent = components["schemas"]["AuditEventView"];
export type CodeResponse = components["schemas"]["CodeResponse"];
export type AdminUserPatch = Partial<components["schemas"]["PatchUserRequest"]>;
export type TaskProfile = components["schemas"]["TaskProfile"];
export type TemplateInfo = components["schemas"]["TemplateInfo"];
export type ProjectSettingsPatch = Partial<components["schemas"]["ProjectSettingsChange"]>;
export type GuidelineSummary = components["schemas"]["GuidelineSummary"];
export type GuidelineListing = components["schemas"]["GuidelineListing"];
export type GuidelineDocument = components["schemas"]["GuidelineDocument"];
export type GuidelineNotice = components["schemas"]["GuidelineNoticeView"];
export type GuidelinePublishInput = { file: File; changeNote: string; expectedLatestVersion: number | null };
export type GuidelineWithdrawBody = { reason: string | null; expected_latest_version: number };
export type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
export type ProjectPin = components["schemas"]["ProjectPin"];
export type RepinReport = components["schemas"]["RepinReport"];
export type Member = components["schemas"]["Member"];
export type MemberCandidate = components["schemas"]["MemberCandidate"];
export type OpenTasksView = components["schemas"]["OpenTasksView"];
export type AssignmentView = components["schemas"]["AssignmentView"];
export type AssignmentRow = components["schemas"]["AssignmentRowRequest"];
export type AssignRequest = Defaulted<components["schemas"]["AssignRequest"], "confirm_unreviewed_translation">;
export type AssignResponse = components["schemas"]["AssignResponse"];
export type ProposalRequest = components["schemas"]["ProposalRequest"];
export type ProposalResponse = components["schemas"]["ProposalResponse"];
export type ReassignRequest = Defaulted<components["schemas"]["ReassignRequest"], "confirm_unreviewed_translation">;
export type TextChangePreviewRequest = components["schemas"]["TextChangePreviewRequest"];
export type TextChangePreview = components["schemas"]["TextChangePreview"];
export type CarryPerson = components["schemas"]["CarryPerson"];
export type MoveToVersionRequest = Defaulted<components["schemas"]["MoveToVersionRequest"], "confirm_unreviewed_translation">;
export type MoveToVersionResponse = components["schemas"]["MoveToVersionResponse"];
export type TextChangeResolutionRequest = components["schemas"]["TextChangeResolutionRequest"];
export type CarryRequest = Defaulted<components["schemas"]["CarryRequest"], "confirm_unreviewed_translation">;
export type CarryResponse = components["schemas"]["CarryResponse"];
export type TermLookup = { layer_id: string; term_id: string };
export type TermLabel = TermLookup & { label: string | null };

export type OntologyTranslation = components["schemas"]["OntologyTranslation"];
export type AdminOntology = components["schemas"]["AdminOntology"];
export type OntologyUploadResult = components["schemas"]["OntologyUploadResult"];

export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  /** Null for a stored release this server has not parsed yet. */
  term_count: number | null;
  path?: string | null;
  status?: "loaded" | "stored" | "failed";
  error?: string | null;
  /** The languages the ontology can be searched in besides English. */
  translations?: OntologyTranslation[];
}

type ApiErrorDetails = string | Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: ApiErrorDetails;

  constructor(status: number, message: string, code?: string, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** DEMO ONLY: a one-click login offered by a loopback demo stack. */
export interface DemoLogin {
  username: string;
  password: string;
  label: string;
}

/** 401 (not logged in, session ended, failed login) or 403 (not allowed, CSRF, origin). */
export class AuthError extends ApiError {
  constructor(message = "Not allowed", details?: ApiErrorDetails, code = "FORBIDDEN", status = 403) {
    super(status, message, code, details);
    this.name = "AuthError";
  }
}

/** True if the error means the request had no valid session (not a refused login). */
export function isSessionExpired(err: unknown): boolean {
  return err instanceof AuthError && err.status === 401 && err.code === "NOT_AUTHENTICATED";
}

/** True if the server refused a write for a stale CSRF token (another tab logged in again). */
export function isCsrfRejected(err: unknown): boolean {
  return err instanceof AuthError && err.status === 403 && err.code === "CSRF_FAILED";
}

/** True if a request failed only for want of a valid session; retrying after a new login may work. */
export function isSessionProblem(err: unknown): boolean {
  return isSessionExpired(err) || isCsrfRejected(err);
}

type Listener = () => void;

function signal() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(): void {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // a broken listener must not break the API call
        }
      }
    },
  };
}

const sessionExpired = signal();
const csrfRejected = signal();
const sessionRestored = signal();

/** Subscribe to "the session has ended" (a 401 outside `/api/v1/auth/`). Returns an unsubscribe function. */
export const onSessionExpired = sessionExpired.subscribe;
/** Subscribe to "a write was refused for a stale CSRF token". Returns an unsubscribe function. */
export const onCsrfRejected = csrfRejected.subscribe;
/** Subscribe to "the same user has a valid session again": refused saves may be retried. */
export const onSessionRestored = sessionRestored.subscribe;
/** Announce that the same user has a valid session again (called by the login gate). */
export const notifySessionRestored = sessionRestored.notify;

export class ConflictError extends ApiError {
  constructor(message = "Revision conflict detected", code = "REVISION_CONFLICT", details?: ApiErrorDetails) {
    super(409, message, code, details);
    this.name = "ConflictError";
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, code = "VALIDATION_ERROR", details?: ApiErrorDetails) {
    super(422, message, code, details);
    this.name = "ValidationError";
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
}

/**
 * The request never reached the server (offline, DNS, connection reset). Extends TypeError, what `fetch`
 * throws, so `isNetworkError` (editor autosave) keeps recognising it.
 */
export class NetworkError extends TypeError {
  constructor(readonly cause: unknown) { super("Connection lost. Try again."); this.name = "NetworkError"; }
}

export class ApiClient {
  private readonly baseUrl: string;
  /** The session's CSRF token, sent with every write (index D-h). */
  private csrfToken: string | null = null;
  /** From the last `me()`: whether the server offers demo logins; null before it answered. */
  private demoLoginsOffered: boolean | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
  }

  async listAssignments(key: string, filter: { document_id?: string } = {}): Promise<AssignmentView[]> {
    const query = filter.document_id ? `?document_id=${encodeURIComponent(filter.document_id)}` : "";
    return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments${query}`, { method: "GET" });
  }
  async createAssignments(key: string, body: AssignRequest): Promise<AssignResponse> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments`, { method: "POST", body: JSON.stringify(body) }); }
  async proposeDistribution(key: string, body: ProposalRequest): Promise<ProposalResponse> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments/proposal`, { method: "POST", body: JSON.stringify(body) }); }
  async previewAssignmentBatch(key: string, body: BatchAssignRequest): Promise<BatchPreview> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments/batch/preview`, { method: "POST", body: JSON.stringify(body) }); }
  async commitAssignmentBatch(key: string, body: BatchAssignBody): Promise<BatchAssignResult> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments/batch`, { method: "POST", body: JSON.stringify(body) }); }
  /** Assignable steps of a selection of cases (case IDs) or texts (`{ rows }`). */
  async selectionSummary(key: string, selection: RowSelection, filters?: DocumentRowFilters): Promise<SelectionSummary> {
    const chosen = isCaseIds(selection) ? { case_ids: selection } : { rows: selection.rows };
    return this.request(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/selection-summary`, { method: "POST", body: JSON.stringify(filters === undefined ? chosen : { ...chosen, filters }) });
  }
  /** Text keys matching the Documents filters in list order (at most 2000 cases); with `case_ids` only texts of these cases. */
  async documentRowKeys(key: string, body: DocumentRowKeysRequest = {}): Promise<DocumentRowKeys> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/keys`, { method: "POST", body: JSON.stringify(body) }); }
  /** Record an opening of Documents (lead only); returns the NEW baseline (start of the previous visit). */
  async recordDocumentsVisit(key: string): Promise<DocumentsVisitView> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/documents/visit`, { method: "POST" }); }
  /** Navigation counter: rows needing the lead's decision, undecided rows included (lead only). */
  async documentsSummary(key: string): Promise<DocumentsSummaryView> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/documents/summary`, { method: "GET" }); }
  async reassign(id: number, body: ReassignRequest): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/reassign`, { method: "POST", body: JSON.stringify(body) }); }
  async reopenAssignment(id: number, reason?: string): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/reopen`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async revokeAssignment(id: number, reason?: string): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }); }
  /** Remove an unsubmitted annotate assignment; its draft is discarded (lead only). */
  async removeAssignment(id: number): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/remove`, { method: "POST" }); }
  /** Counts of a move or carry to the row's newest version, without writing (lead only). */
  async previewTextChange(key: string, body: TextChangePreviewRequest): Promise<TextChangePreview> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/text-changes/preview`, { method: "POST", body: JSON.stringify(body) }); }
  /** "Move to v2": freeze the draft, continue on the target, revoke the old assignment (lead only). */
  async moveToVersion(id: number, body: MoveToVersionRequest): Promise<MoveToVersionResponse> { return this.request(`/api/v1/assignments/${id}/move-to-version`, { method: "POST", body: JSON.stringify(body) }); }
  /** "Let X finish on v1" or "Withdraw" for open work on an old version (lead only). */
  async resolveTextChange(id: number, body: TextChangeResolutionRequest): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/text-change-resolution`, { method: "POST", body: JSON.stringify(body) }); }
  /** "Carry to v2…": the author, someone else (handover) or dismiss (lead only). */
  async carrySubmission(key: string, submissionId: string, body: CarryRequest): Promise<CarryResponse> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/submissions/${encodeURIComponent(submissionId)}/carry`, { method: "POST", body: JSON.stringify(body) }); }

  async listTemplates(): Promise<TemplateInfo[]> { return this.request("/api/v1/projects/templates", { method: "GET" }); }
  async createProject(body: CreateProjectRequest): Promise<ProjectSettings> { return this.request("/api/v1/projects/", { method: "POST", body: JSON.stringify(body) }); }
  async getProjectSettings(key: string): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/settings`, { method: "GET" }); }
  async updateProjectSettings(key: string, change: ProjectSettingsPatch): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/settings`, { method: "PATCH", body: JSON.stringify(change) }); }
  async updatePins(key: string, pins: ProjectPin[]): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/pins`, { method: "PUT", body: JSON.stringify(pins) }); }
  /** The dry run of moving to these releases: rewritten and flagged draft terms. */
  async previewPins(key: string, pins: ProjectPin[]): Promise<RepinReport> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/pins/preview`, { method: "POST", body: JSON.stringify(pins) }); }
  /** Apply a previewed move; refused with REPIN_REPORT_STALE when the report changed since. */
  async applyPins(key: string, pins: ProjectPin[], reportSha256: string): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/pins/apply`, { method: "POST", body: JSON.stringify({ pins, report_sha256: reportSha256 }) }); }
  /** Move to the newest translation files (issue 254); TRANSLATIONS_CURRENT when nothing is newer. */
  async refreshTranslations(key: string): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/translations/refresh`, { method: "POST" }); }
  async updateProjectProfile(key: string, profile: TaskProfile): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/profile`, { method: "PUT", body: JSON.stringify(profile) }); }
  async listMembers(key: string): Promise<Member[]> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/members`, { method: "GET" }); }
  async listMemberCandidates(key: string, query: string): Promise<MemberCandidate[]> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/member-candidates?q=${encodeURIComponent(query)}`, { method: "GET" }); }
  async setMemberRoles(key: string, username: string, roles: string[], revoke = false): Promise<Member> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/members/${encodeURIComponent(username)}`, { method: "PUT", body: JSON.stringify({ roles, revoke_assignments: revoke }) }); }
  async listGuidelines(key: string): Promise<GuidelineListing> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/guidelines`, { method: "GET" }); }
  async getGuideline(key: string, version: number): Promise<GuidelineDocument> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/guidelines/${version}`, { method: "GET" }); }
  async publishGuideline(key: string, input: GuidelinePublishInput): Promise<GuidelineSummary> {
    const body = new FormData();
    body.append("file", input.file);
    body.append("change_note", input.changeNote);
    // An empty value means "no version exists yet" (first upload).
    body.append("expected_latest_version", input.expectedLatestVersion === null ? "" : String(input.expectedLatestVersion));
    return this.request(`/api/v1/projects/${encodeURIComponent(key)}/guidelines`, { method: "POST", body });
  }
  async withdrawGuideline(key: string, version: number, body: GuidelineWithdrawBody): Promise<GuidelineSummary> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/guidelines/${version}/withdraw`, { method: "POST", body: JSON.stringify(body) }); }
  async recordGuidelineRead(key: string, version: number, event: "notified" | "opened"): Promise<void> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/guidelines/${version}/reads`, { method: "POST", body: JSON.stringify({ event }) }); }
  async listProjectDocuments(key: string, filters: ProjectDocumentFilters = {}): Promise<ProjectDocumentSummary[]> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
    return this.request<ProjectDocumentSummary[]>(`/api/v1/projects/${encodeURIComponent(key)}/documents${query.size ? `?${query}` : ""}`, { method: "GET" });
  }

  /**
   * Lead-only Documents rows; empty filters are omitted, list filters and `retain` repeat. `selected` (Show selected,
   * too long for a URL) lists exactly these texts, so only `page` and `sort` still apply.
   */
  async listDocumentRows(key: string, filters: DocumentRowsRequest = {}): Promise<DocumentRowsPage> {
    if (filters.selected) {
      const body = { rows: filters.selected, page: filters.page ?? 1, sort: filters.sort ?? "case" };
      return this.request<DocumentRowsPage>(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/selected`, { method: "POST", body: JSON.stringify(body) });
    }
    const query = filterParams(filters, ["retain"]);
    for (const item of filters.retain ?? []) query.append("retain", item);
    return this.request<DocumentRowsPage>(`/api/v1/projects/${encodeURIComponent(key)}/document-rows${query.size ? `?${query}` : ""}`, { method: "GET" });
  }

  /** Case IDs matching the Documents filters, in list order (at most 2000). */
  async listDocumentCaseIds(key: string, filters: DocumentCaseIdsRequest = {}): Promise<DocumentCaseIds> {
    const query = filterParams(filters);
    return this.request<DocumentCaseIds>(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/case-ids${query.size ? `?${query}` : ""}`, { method: "GET" });
  }

  async getRowSubmissions(key: string, caseId: string, language: string): Promise<RowSubmissions> {
    return this.request<RowSubmissions>(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/${encodeURIComponent(caseId)}/${encodeURIComponent(language)}/submissions`, { method: "GET" });
  }

  /** Final-result panel of one row: submissions, agreement, label rule, causes (leads only). */
  async finalPanel(key: string, caseId: string, language: string): Promise<FinalPanelView> {
    return this.request<FinalPanelView>(`/api/v1/projects/${encodeURIComponent(key)}/document-rows/${encodeURIComponent(caseId)}/${encodeURIComponent(language)}/final-panel`, { method: "GET" });
  }


  async createUpload(key: string, kind: "t1" | "text", files: readonly File[], language?: string): Promise<UploadCreated> {
    const body = new FormData(); body.append("kind", kind);
    for (const file of files) body.append("files[]", file);
    if (language) body.append("language", language);
    return this.request<UploadCreated>(`/api/v1/projects/${encodeURIComponent(key)}/uploads`, { method: "POST", body });
  }

  /** The newest uploads; `statuses` keeps only those states (`?status=` repeated). */
  async listUploads(key: string, statuses: readonly UploadStatus[] = []): Promise<UploadView[]> {
    const query = new URLSearchParams();
    for (const status of statuses) query.append("status", status);
    const suffix = statuses.length ? `?${query}` : "";
    return this.request<UploadView[]>(`/api/v1/projects/${encodeURIComponent(key)}/uploads${suffix}`, { method: "GET" });
  }

  async getUpload(key: string, id: number): Promise<UploadView> {
    return this.request<UploadView>(`/api/v1/projects/${encodeURIComponent(key)}/uploads/${id}`, { method: "GET" });
  }

  async commitUpload(key: string, id: number, planSha256: string, overrides?: readonly StatusOverride[], plan?: CommitUploadPlan): Promise<UploadCreated> {
    return this.request<UploadCreated>(`/api/v1/projects/${encodeURIComponent(key)}/uploads/${id}/commit`, { method: "POST", body: JSON.stringify({ plan_sha256: planSha256, ...(overrides === undefined ? {} : { status_overrides: overrides }), ...(plan ?? {}) }) });
  }

  async patchWorkPlan(key: string, caseId: string, language: string, body: PlanRowPatch): Promise<PlanRowResult> {
    return this.request<PlanRowResult>(`/api/v1/projects/${encodeURIComponent(key)}/work-plans/${encodeURIComponent(caseId)}/${encodeURIComponent(language)}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  async previewWorkPlans(key: string, body: BulkPlanRequest): Promise<BulkPreview> {
    return this.request<BulkPreview>(`/api/v1/projects/${encodeURIComponent(key)}/work-plans/bulk/preview`, { method: "POST", body: JSON.stringify(body) });
  }

  async saveWorkPlans(key: string, body: BulkPlanRequest): Promise<BulkResult> {
    return this.request<BulkResult>(`/api/v1/projects/${encodeURIComponent(key)}/work-plans/bulk`, { method: "PUT", body: JSON.stringify(body) });
  }

  /** Exact flags per row; `undo: true` restores an Undo payload exactly (D22). */
  async setWorkPlanRows(key: string, body: PlanRowsSet): Promise<BulkResult> {
    return this.request<BulkResult>(`/api/v1/projects/${encodeURIComponent(key)}/work-plans/rows`, { method: "PUT", body: JSON.stringify(body) });
  }

  async annotationTargetPreview(key: string, annotationsPerText: number): Promise<AnnotationTargetPreview> {
    return this.request<AnnotationTargetPreview>(`/api/v1/projects/${encodeURIComponent(key)}/work-plans/annotation-target-preview?annotations_per_text=${annotationsPerText}`, { method: "GET" });
  }

  async lookupCaseIds(key: string, ids: readonly string[]): Promise<CaseIdLookupResult> {
    return this.request<CaseIdLookupResult>(`/api/v1/projects/${encodeURIComponent(key)}/case-ids/lookup`, { method: "POST", body: JSON.stringify({ ids }) });
  }

  async discardVariant(key: string, documentId: string, body: DiscardRequest): Promise<DiscardResult> {
    return this.request<DiscardResult>(`/api/v1/projects/${encodeURIComponent(key)}/variants/${encodeURIComponent(documentId)}/discard`, { method: "POST", body: JSON.stringify(body) });
  }

  /** What changing a locked text's annotation mode discards and revokes (lead only, no write). */
  async previewModeChange(key: string, body: ModeChangeTarget): Promise<ModeChangePreview> {
    return this.request<ModeChangePreview>(`/api/v1/projects/${encodeURIComponent(key)}/annotation-mode-changes/preview`, { method: "POST", body: JSON.stringify(body) });
  }

  /** Change the mode: discard (mark) the listed submissions, revoke the text's assignments (lead only). */
  async changeMode(key: string, body: ModeChangeRequest): Promise<ModeChangeResult> {
    return this.request<ModeChangeResult>(`/api/v1/projects/${encodeURIComponent(key)}/annotation-mode-changes`, { method: "POST", body: JSON.stringify(body) });
  }

  /** The text's mode changes, newest first (lead only). */
  async listModeChanges(key: string, caseId: string, language: string): Promise<ModeChangeList> {
    const query = new URLSearchParams({ case_id: caseId, language });
    return this.request<ModeChangeList>(`/api/v1/projects/${encodeURIComponent(key)}/annotation-mode-changes?${query.toString()}`, { method: "GET" });
  }

  /** Undo a mode change: the discarded work counts again (lead only). */
  async restoreModeChange(key: string, changeId: number, expectedRevision: number): Promise<ModeChangeResult> {
    return this.request<ModeChangeResult>(`/api/v1/projects/${encodeURIComponent(key)}/annotation-mode-changes/${changeId}/restore`, { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision }) });
  }

  async discardUpload(key: string, id: number): Promise<UploadView> {
    return this.request<UploadView>(`/api/v1/projects/${encodeURIComponent(key)}/uploads/${id}/discard`, { method: "POST" });
  }

  async getJob(id: number): Promise<JobView> {
    return this.request<JobView>(`/api/v1/jobs/${id}`, { method: "GET" });
  }

  async getProgress(key: string): Promise<ProjectProgress> {
    return this.request<ProjectProgress>(`/api/v1/projects/${encodeURIComponent(key)}/progress`, { method: "GET" });
  }

  async startExport(key: string, kind: ExportKind): Promise<ExportCreated> {
    return this.request<ExportCreated>(`/api/v1/projects/${encodeURIComponent(key)}/exports`, { method: "POST", body: JSON.stringify({ kind }) });
  }

  async downloadJob(id: number): Promise<DownloadPayload> {
    const response = await this.requestResponse(`/api/v1/jobs/${id}/download`, { method: "GET" });
    return { blob: await response.blob(), filename: attachmentFilename(response.headers.get("Content-Disposition")) };
  }

  async adminListUsers(): Promise<AdminUser[]> {
    return this.request<AdminUser[]>("/api/v1/admin/users/", { method: "GET" });
  }

  async adminCreateUser(body: CreateUserRequest): Promise<CreatedUser> {
    return this.request<CreatedUser>("/api/v1/admin/users/", { method: "POST", body: JSON.stringify(body) });
  }

  async adminIssueResetCode(username: string): Promise<CodeResponse> {
    return this.request<CodeResponse>(`/api/v1/admin/users/${encodeURIComponent(username)}/reset-code`, { method: "POST" });
  }

  async adminAnonymiseUser(username: string, confirmUsername: string): Promise<AdminUser> {
    return this.request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(username)}/anonymise`, { method: "POST", body: JSON.stringify({ confirm_username: confirmUsername }) });
  }

  async adminUserAudit(username: string): Promise<AuditEvent[]> {
    return this.request<AuditEvent[]>(`/api/v1/admin/users/${encodeURIComponent(username)}/audit`, { method: "GET" });
  }

  async adminUpdateUser(username: string, change: AdminUserPatch): Promise<AdminUser> {
    return this.request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify(change) });
  }

  async adminListOntologies(): Promise<AdminOntology[]> {
    return this.request<AdminOntology[]>("/api/v1/admin/ontologies/", { method: "GET" });
  }

  async adminUploadOntologies(files: readonly File[]): Promise<OntologyUploadResult[]> {
    const body = new FormData();
    for (const file of files) body.append("files[]", file);
    return this.request<OntologyUploadResult[]>("/api/v1/admin/ontologies/upload-results", { method: "POST", body });
  }

  async listMyTasks(): Promise<TaskSummary[]> {
    return this.request<TaskSummary[]>("/api/v1/me/tasks", { method: "GET" });
  }

  async openAssignment(id: number, request?: AssignmentOpenRequest): Promise<AssignmentWorkspace> {
    return this.request<AssignmentWorkspace>(`/api/v1/assignments/${id}/open`, {
      method: "POST", ...(request === undefined ? {} : { body: JSON.stringify(request) }),
    });
  }

  async listCases(projectKey: string, filters: CaseFilters = {}): Promise<CaseSummary[]> {
    const query = new URLSearchParams();
    for (const name of ["language", "origin", "status"] as const) {
      const value = filters[name];
      if (value !== undefined && value !== null) query.set(name, value);
    }
    return this.request<CaseSummary[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/cases${query.size ? `?${query}` : ""}`, { method: "GET" });
  }

  async getCase(projectKey: string, caseId: string): Promise<CaseDetail> {
    return this.request<CaseDetail>(`/api/v1/projects/${encodeURIComponent(projectKey)}/cases/${encodeURIComponent(caseId)}`, { method: "GET" });
  }

  async getVariantMetadata(projectKey: string, documentId: string): Promise<VariantSummary> {
    return this.request<VariantSummary>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/variant`, { method: "GET" });
  }

  async getVariantText(projectKey: string, documentId: string): Promise<VariantText> {
    return this.request<VariantText>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/text`, { method: "GET" });
  }

  async listAnnotationVersions(projectKey: string, documentId: string, assignmentId?: number): Promise<VersionRef[]> {
    const query = new URLSearchParams();
    if (assignmentId !== undefined) query.set("assignment", String(assignmentId));
    return this.request<VersionRef[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/annotation-versions${query.size ? `?${query}` : ""}`, { method: "GET" });
  }

  async listTextLayers(key: string, documentId: string): Promise<TextLayerEntry[]> {
    const body = await this.request<components["schemas"]["TextLayers"]>(`/api/v1/projects/${encodeURIComponent(key)}/documents/${encodeURIComponent(documentId)}/layers`, { method: "GET" });
    return body.entries;
  }

  async finalExportPreflight(projectKey: string): Promise<FinalPreflight> {
    return this.request<FinalPreflight>(`/api/v1/projects/${encodeURIComponent(projectKey)}/exports/final/preflight`, { method: "POST" });
  }
  async getWorkflowWarnings(projectKey: string): Promise<FinalPreflight> {
    return this.request<FinalPreflight>(`/api/v1/projects/${encodeURIComponent(projectKey)}/workflow-warnings`, { method: "GET" });
  }
  async selectFinalResult(projectKey: string, payload: components["schemas"]["FinalSelectionRequest"]): Promise<FinalSelectionView> {
    return this.request<FinalSelectionView>(`/api/v1/projects/${encodeURIComponent(projectKey)}/final-selections`, { method: "PUT", body: JSON.stringify(payload) });
  }
  async startFinalExport(projectKey: string, payload: FinalExportRequest): Promise<{ job_id: number }> {
    return this.request<{ job_id: number }>(`/api/v1/projects/${encodeURIComponent(projectKey)}/exports/final`, { method: "POST", body: JSON.stringify(payload) });
  }

  async listSubmissionHistory(projectKey: string, documentId: string): Promise<SubmissionHistorySummary[]> {
    return this.request<SubmissionHistorySummary[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/submissions`, { method: 'GET' });
  }

  async getSubmissionHistory(projectKey: string, documentId: string, submissionId: string): Promise<SubmissionHistoryDetail> {
    return this.request<SubmissionHistoryDetail>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/submissions/${encodeURIComponent(submissionId)}`, { method: 'GET' });
  }

  async getAnnotationVersion(projectKey: string, documentId: string, kind: VersionRef["kind"], id: string): Promise<AnnotationVersion> {
    return this.request<AnnotationVersion>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/annotation-versions/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: "GET" });
  }

  async getReanchorItems(projectKey: string, documentId: string): Promise<ReanchorItem[]> {
    return this.request<ReanchorItem[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/reanchor-items`, { method: "GET" });
  }

  async getAssignmentMetadata(assignmentId: number): Promise<AssignmentView> {
    return this.request<AssignmentView>(`/api/v1/assignments/${assignmentId}`, { method: "GET" });
  }

  async openTranslationReview(assignmentId: number): Promise<ReviewWorkspace> {
    return this.request<ReviewWorkspace>(`/api/v1/translation-reviews/${assignmentId}`, { method: "GET" });
  }

  async saveTranslationReviewDraft(assignmentId: number, body: TranslationReviewDraftRequest): Promise<TranslationReviewDraftResponse> {
    return this.request<TranslationReviewDraftResponse>(`/api/v1/translation-reviews/${assignmentId}/draft`, { method: "PUT", body: JSON.stringify(body) });
  }

  async submitTranslationReview(assignmentId: number, expectedRevision: TranslationReviewSubmitRequest["expected_revision"]): Promise<TranslationReviewRecord> {
    return this.request<TranslationReviewRecord>(`/api/v1/translation-reviews/${assignmentId}/submit`, { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision } satisfies TranslationReviewSubmitRequest) });
  }

  async listTranslationReviews(projectKey: string, documentId: string): Promise<TranslationReviewRecord[]> {
    return this.request<TranslationReviewRecord[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/translation-reviews`, { method: "GET" });
  }

  async exportTranslationReviews(projectKey: string): Promise<ExportCreated> {
    return this.request<ExportCreated>(`/api/v1/projects/${encodeURIComponent(projectKey)}/exports/translation-reviews`, { method: "POST" });
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  getCsrfToken(): string | null {
    return this.csrfToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await this.requestResponse(endpoint, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** JSON and binary endpoints share authentication and error decoding. */
  private async requestResponse(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers ?? {});

    const method = (options.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && this.csrfToken && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", this.csrfToken);
    }

    if (
      options.body &&
      !(options.body instanceof FormData) &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    // Only an answer to a request sent with the current token speaks for the current session;
    // a late 401 for a request sent before a new login must not end the new session.
    const sent = this.csrfToken;
    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, credentials: "same-origin" });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new NetworkError(cause);
    }

    if (!response.ok) {
      let code: string | undefined;
      let details: ApiErrorDetails | undefined;
      let message = `API request failed with status ${response.status}`;

      try {
        const errorJson = await response.json();
        if (errorJson && typeof errorJson === "object") {
          code = (errorJson.code as string) || undefined;
          details = errorJson.details || errorJson.detail || undefined;
          if (details) {
            message = typeof details === "string" ? details : String(details.message ?? message);
          }
        }
      } catch {
        // Response body was not JSON
      }

      if (response.status === 401) {
        // A failed login or code redemption is no expiry.
        if (!endpoint.startsWith("/api/v1/auth/") && this.csrfToken === sent) sessionExpired.notify();
        throw new AuthError(message, details, code ?? "NOT_AUTHENTICATED", 401);
      }
      if (response.status === 403) {
        if (code === "CSRF_FAILED" && this.csrfToken === sent) csrfRejected.notify();
        throw new AuthError(message, details, code);
      }
      if (response.status === 409) {
        throw new ConflictError(message, code, details);
      }
      if (response.status === 422) {
        throw new ValidationError(message, code, details);
      }

      throw new ApiError(response.status, message, code, details);
    }

    return response;
  }

  /**
   * The logged-in user of this browser's session; an `AuthError` 401 without one. Stores the CSRF token.
   * Asks `/auth/session`, which answers 200 without a session too, so an anonymous visit logs no
   * failed request (issue 198); the answer also says whether demo logins are offered.
   */
  async me(): Promise<CurrentUser> {
    const state = await this.request<SessionState>("/api/v1/auth/session", { method: "GET" });
    this.demoLoginsOffered = state.demo_logins;
    if (!state.user) throw new AuthError("Log in to continue.", undefined, "NOT_AUTHENTICATED", 401);
    this.setCsrfToken(state.user.csrf_token);
    return state.user;
  }

  /** Raw transport; metadata lifetime and deduplication belong to the workspace. */
  async getProposalSet(projectKey: string, setId: number, signal?: AbortSignal): Promise<ProposalSetView> {
    return this.request<ProposalSetView>(`/api/v1/projects/${encodeURIComponent(projectKey)}/proposal-sets/${setId}`, { method: "GET", signal });
  }

  async getAbout(): Promise<About> {
    return this.request<About>("/api/v1/about", { method: "GET" });
  }

  async getProfile(): Promise<Profile> {
    return this.request<Profile>("/api/v1/me/profile", { method: "GET" });
  }

  async updateOwnProfile(change: OwnProfilePatch): Promise<Profile> {
    return this.request<Profile>("/api/v1/me/profile", {
      method: "PATCH", body: JSON.stringify(change),
    });
  }

  async changePassword(current: string, next: string): Promise<void> {
    const change: PasswordChange = { current_password: current, new_password: next };
    return this.request<void>("/api/v1/me/password", {
      method: "POST", body: JSON.stringify(change),
    });
  }

  /** Log in; the server sets the session cookie. Stores the CSRF token. */
  async login(username: string, password: string): Promise<CurrentUser> {
    const user = await this.request<CurrentUser>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setCsrfToken(user.csrf_token);
    return user;
  }

  /**
   * DEMO ONLY: one-click accounts of a loopback demo stack (ONTOTATOR_DEMO_LOGINS_FILE).
   * The server answers 404 unless they are configured; that and any other failure give none.
   * After `me()` learnt that none are offered, no request is sent.
   */
  async demoLogins(): Promise<DemoLogin[]> {
    if (this.demoLoginsOffered === false) return [];
    try {
      const body = await this.request<{ accounts?: DemoLogin[] }>("/api/v1/auth/demo-logins", { method: "GET" });
      return Array.isArray(body?.accounts) ? body.accounts : [];
    } catch {
      return [];
    }
  }

  /** Set the password with a setup or reset code, then log in. Stores the CSRF token. */
  async redeemCode(username: string, code: string, newPassword: string): Promise<CurrentUser> {
    const user = await this.request<CurrentUser>("/api/v1/auth/redeem-code", {
      method: "POST",
      body: JSON.stringify({ username, code, new_password: newPassword }),
    });
    this.setCsrfToken(user.csrf_token);
    return user;
  }

  /** End this session; the server deletes the cookie. */
  async logout(): Promise<void> {
    try {
      await this.request<void>("/api/v1/auth/logout", { method: "POST" });
    } finally {
      this.setCsrfToken(null);
    }
  }

  async getPreferences(): Promise<Preferences> {
    return this.request<Preferences>("/api/v1/preferences", { method: "GET" });
  }

  /** Partial update: omitted fields are kept on the server, modes merge per package. */
  async updatePreferences(change: PreferencesUpdate): Promise<Preferences> {
    return this.request<Preferences>("/api/v1/preferences", {
      method: "PUT",
      body: JSON.stringify(change),
    });
  }

  /**
   * The projects the logged-in user can see, with their roles and working
   * modes.
   */
  async listProjects(): Promise<ProjectSummary[]> {
    return this.request<ProjectSummary[]>("/api/v1/projects", {
      method: "GET",
    });
  }

  async listDocuments(
    projectKey: string,
    params?: { annotator_id?: string; mode?: string }
  ): Promise<DocumentSummary[]> {
    const searchParams = new URLSearchParams();
    if (params?.annotator_id) {
      searchParams.set("annotator_id", params.annotator_id);
    }
    if (params?.mode) {
      searchParams.set("mode", params.mode);
    }
    const qs = searchParams.toString();
    return this.request<DocumentSummary[]>(
      `/api/v1/projects/${encodeURIComponent(projectKey)}/documents${
        qs ? `?${qs}` : ""
      }`,
      {
        method: "GET",
      }
    );
  }


  async getReviewInputs(
    req: ReviewInputsRequest
  ): Promise<AnnotationSnapshot[]> {
    return this.request<AnnotationSnapshot[]>("/api/v1/workspaces/review-inputs", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async openWorkspace(
    req: OpenWorkspaceRequest
  ): Promise<OpenWorkspaceResponse> {
    return this.request<OpenWorkspaceResponse>("/api/v1/workspaces/open", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async applyCommand(
    workspaceId: string,
    envelope: MutationEnvelope
  ): Promise<Draft> {
    return this.request<Draft>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/commands`,
      {
        method: "POST",
        body: JSON.stringify(envelope),
      }
    );
  }

  async resolveReanchor(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request<Draft>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/reanchor-resolutions`, {
      method: "POST", body: JSON.stringify(envelope),
    });
  }

  async recordDecision(
    workspaceId: string,
    envelope: MutationEnvelope
  ): Promise<Draft> {
    return this.request<Draft>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/decisions`,
      {
        method: "POST",
        body: JSON.stringify(envelope),
      }
    );
  }

  async submitWorkspace(
    workspaceId: string,
    envelope: MutationEnvelope
  ): Promise<Submission> {
    return this.request<Submission>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/submit`,
      {
        method: "POST",
        body: JSON.stringify(envelope),
      }
    );
  }

  async readSubmission(
    workspaceId: string,
    submissionId: string
  ): Promise<Submission> {
    return this.request<Submission>(
      `/api/v1/workspaces/${encodeURIComponent(
        workspaceId
      )}/submissions/${encodeURIComponent(submissionId)}`,
      {
        method: "GET",
      }
    );
  }

  async startWorkRound(assignmentId: number, body: CreateRoundRequest): Promise<WorkRoundView> {
    return this.request(`/api/v1/assignments/${assignmentId}/rounds`, { method: "POST", body: JSON.stringify(body) });
  }

  async listWorkRounds(assignmentId: number): Promise<WorkRoundView[]> {
    return this.request(`/api/v1/assignments/${assignmentId}/rounds`, { method: "GET" });
  }

  async listRoundInputs(roundId: string): Promise<RoundInputView[]> {
    return this.request(`/api/v1/rounds/${encodeURIComponent(roundId)}/inputs`, { method: "GET" });
  }

  /** Assign the consolidator and start the consolidation round in one step (lead only); choosing yourself grants the Consolidator role. */
  async startConsolidation(key: string, body: StartConsolidationRequest): Promise<StartConsolidationResponse> {
    return this.request(`/api/v1/projects/${encodeURIComponent(key)}/consolidations`, { method: "POST", body: JSON.stringify(body) });
  }

  async getConsolidation(roundId: string): Promise<ConsolidationView> {
    return this.request<ConsolidationView>(`/api/v1/rounds/${encodeURIComponent(roundId)}/consolidation`, { method: "GET" });
  }

  /** Resolve one consolidation group; `envelope.payload` is a `ConsolidationResolvePayload`. */
  async resolveConsolidationGroup(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/consolidation-groups/resolve`, { method: "POST", body: JSON.stringify(envelope) });
  }

  /** Change note and "Guidelines unclear" of a resolved group; `envelope.payload` is a `ConsolidationAnnotatePayload`. */
  async annotateConsolidationGroup(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/consolidation-groups/annotate`, { method: "POST", body: JSON.stringify(envelope) });
  }

  /** Delete a group's decisions and consolidated findings; `envelope.payload` is a `ConsolidationReopenPayload`. */
  async reopenConsolidationGroup(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/consolidation-groups/reopen`, { method: "POST", body: JSON.stringify(envelope) });
  }
  /** R-10: every group open again, matches taken over again; one mutation. */
  async reopenAllConsolidationGroups(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/consolidation-groups/reopen-all`, { method: "POST", body: JSON.stringify(envelope) });
  }
  /** R-10: restores the decisions before "Reopen all decisions…", only directly after it. */
  async undoReopenAllConsolidationGroups(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/consolidation-groups/undo-reopen-all`, { method: "POST", body: JSON.stringify(envelope) });
  }

  async listRoundSources(assignmentId: number): Promise<RoundSourceView[]> {
    return this.request(`/api/v1/assignments/${assignmentId}/round-sources`, { method: "GET" });
  }

  // Carried review (editor-carried-review plan)
  async clearRoundInputResolution(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/round-input-resolutions/clear`, { method: "POST", body: JSON.stringify(envelope) });
  }

  async listAssignmentSubmissions(assignmentId: number): Promise<AssignmentSubmissionView[]> {
    return this.request(`/api/v1/assignments/${assignmentId}/submissions`, { method: "GET" });
  }

  async assignTranslationCorrection(projectKey: string, documentId: string, body: CorrectionAssignmentRequest): Promise<AssignmentView> {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/translation-correction-assignment`, { method: "POST", body: JSON.stringify(body) });
  }

  /** F1: the lead reviews a rejected or queried version themselves. */
  async startLeadCorrection(projectKey: string, documentId: string, body: LeadCorrectionRequest): Promise<AssignmentView> {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}/lead-correction`, { method: "POST", body: JSON.stringify(body) });
  }

  async listSourceObligations(assignmentId: number): Promise<SourceObligationView[]> {
    return this.request(`/api/v1/translation-reviews/${assignmentId}/source-obligations`, { method: "GET" });
  }

  async createProblemReport(assignmentId: number, body: ProblemReportRequest): Promise<ProblemReportView> {
    return this.request(`/api/v1/assignments/${assignmentId}/problem-reports`, { method: "POST", body: JSON.stringify(body) });
  }

  async listProblemReports(projectKey: string, documentId?: string): Promise<ProblemReportView[]> {
    const query = documentId === undefined ? "" : `?${new URLSearchParams({ document_id: documentId })}`;
    return this.request(`/api/v1/projects/${encodeURIComponent(projectKey)}/problem-reports${query}`, { method: "GET" });
  }

  async listTaskProblemReports(projectKey: string, assignmentId: number): Promise<ProblemReportView[]> {
    const query = new URLSearchParams({ assignment_id: String(assignmentId) });
    return this.request(`/api/v1/projects/${encodeURIComponent(projectKey)}/problem-reports?${query}`, { method: "GET" });
  }

  async getProblemReport(reportId: string): Promise<ProblemReportView> {
    return this.request(`/api/v1/problem-reports/${encodeURIComponent(reportId)}`, { method: "GET" });
  }

  /** The reporter opened their report: clears "Answer to your report"; returns the fresh view. */
  async markProblemReportSeen(reportId: string): Promise<ProblemReportView> {
    return this.request(`/api/v1/problem-reports/${encodeURIComponent(reportId)}/seen`, { method: "POST" });
  }

  async listPauseCandidates(reportId: string): Promise<PauseCandidate[]> {
    return this.request(`/api/v1/problem-reports/${encodeURIComponent(reportId)}/pause-candidates`, { method: "GET" });
  }

  async actOnProblemReport(reportId: string, body: ProblemActionRequest): Promise<ProblemReportView> {
    return this.request(`/api/v1/problem-reports/${encodeURIComponent(reportId)}/actions`, { method: "POST", body: JSON.stringify(body) });
  }

  async resolveSourceObligation(assignmentId: number, causeId: string, body: ResolveSourceObligationRequest): Promise<TranslationReviewRecord> {
    return this.request(`/api/v1/translation-reviews/${assignmentId}/source-obligations/${encodeURIComponent(causeId)}/resolve`, { method: "POST", body: JSON.stringify(body) });
  }

  async openWorkRound(roundId: string): Promise<OpenWorkspaceResponse> {
    return this.request(`/api/v1/rounds/${encodeURIComponent(roundId)}/open`, { method: "POST" });
  }

  async resolveRoundInput(workspaceId: string, envelope: MutationEnvelope): Promise<Draft> {
    return this.request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/round-input-resolutions`, { method: "POST", body: JSON.stringify(envelope) });
  }

  async searchOntology(req: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    return this.request<SearchResult>("/api/v1/search", {
      method: "POST",
      body: JSON.stringify(req),
      ...(signal ? { signal } : {}),
    });
  }

  /** Start a walk through the ontology tree at a term. The server logs what it shows. */
  async openTree(req: TreeOpenRequest): Promise<TreeOpenResponse> {
    return this.request<TreeOpenResponse>("/api/v1/terms/tree/open", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  /** A shown node: its details; with `expand` its children; with `via_parent_id` the path through that parent. */
  async loadTreeNode(req: TreeNodeRequest): Promise<TreeNodeResponse> {
    return this.request<TreeNodeResponse>("/api/v1/terms/tree/node", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async resolveTermLabels(projectKey: string, terms: TermLookup[]): Promise<TermLabel[]> {
    return this.request<TermLabel[]>("/api/v1/terms/labels", {
      method: "POST",
      body: JSON.stringify({ project_key: projectKey, terms }),
    });
  }

  async listOntologies(): Promise<OntologyInfo[]> {
    return this.request<OntologyInfo[]>("/api/v1/ontologies", {
      method: "GET",
    });
  }

  async listPackageOntologies(projectKey: string): Promise<OntologyInfo[]> {
    return this.request<OntologyInfo[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/ontologies`, {
      method: "GET",
    });
  }

}

export const api = new ApiClient();

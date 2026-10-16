/**
 * Typed client for the Ontocurator API. The session lives in an HttpOnly cookie;
 * writes carry the session's CSRF token.
 */

import type { components, operations } from "./generated";
import { attachmentFilename, type DownloadPayload } from "./download";
export type { DownloadPayload } from "./download";

export type ProjectDocumentSummary = components["schemas"]["ProjectDocumentSummary"];
type VariantMetadataKeys = "case_id" | "external_id" | "version" | "origin" | "translation_status" | "status_reason";
/** Legacy editor navigation also composes reduced WorkspaceService summaries. */
export type DocumentSummary = Omit<ProjectDocumentSummary, VariantMetadataKeys> & Partial<Pick<ProjectDocumentSummary, VariantMetadataKeys>>;
export type ProjectSettings = components["schemas"]["ProjectSettings"];
export type UploadView = components["schemas"]["UploadView"];
export type UploadCreated = components["schemas"]["UploadCreated"];
export type ImportPlan = components["schemas"]["ImportPlan"];
export type JobView = components["schemas"]["JobView"];
export type ProjectProgress = components["schemas"]["ProjectProgress"];
export type ExportKind = components["schemas"]["ExportRequest"]["kind"];
export type ExportCreated = components["schemas"]["ExportCreated"];
export interface ProjectDocumentFilters { language?: string; status?: string; q?: string }
export type ReviewInputsRequest = components["schemas"]["ReviewInputsRequest"];
export type EditorProposal = components["schemas"]["EditorProposal"];
export type ProposalSetView = components["schemas"]["ProposalSetView"];
export type AnnotationSnapshot = components["schemas"]["AnnotationSnapshot"];
export type OpenWorkspaceRequest = components["schemas"]["OpenWorkspaceRequest"];
export type OpenWorkspaceResponse = components["schemas"]["OpenWorkspaceResponse"];
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
export type AnnotationVersion = components["schemas"]["AnnotationVersion"];
export type ReviewWorkspace = components["schemas"]["ReviewWorkspace"];
export type TranslationReviewRecord = components["schemas"]["TranslationReviewRecord"];
export type ReanchorItem = components["schemas"]["ReanchorItem"];
export type TranslationReviewDraftRequest = components["schemas"]["DraftRequest"];
export type TranslationReviewDraftResponse = components["schemas"]["DraftResponse"];
export type TranslationReviewSubmitRequest = components["schemas"]["SubmitRequest"];
export type CaseFilters = NonNullable<operations["list_cases_api_v1_projects__key__cases_get"]["parameters"]["query"]>;
/** The logged-in user; `csrf_token` goes back in `X-CSRF-Token` with every write. */
export type CurrentUser = components["schemas"]["CurrentUser"];
export type Profile = components["schemas"]["Profile"];
/** PATCH distinguishes omitted defaults from explicit null/false values. */
export type OwnProfilePatch = Partial<components["schemas"]["ProfilePatch"]>;
export type PasswordChange = components["schemas"]["PasswordChange"];
export type AdminUser = components["schemas"]["AdminUser"];
export type CreateUserRequest = components["schemas"]["CreateUserRequest"];
export type CreatedUser = components["schemas"]["CreatedUser"];
export type CodeResponse = components["schemas"]["CodeResponse"];
export type AdminUserPatch = Partial<components["schemas"]["PatchUserRequest"]>;
export type TaskProfile = components["schemas"]["TaskProfile"];
export type TemplateInfo = components["schemas"]["TemplateInfo"];
export type ProjectSettingsPatch = Partial<components["schemas"]["ProjectSettingsChange"]>;
export type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
export type ProjectPin = components["schemas"]["ProjectPin"];
export type Member = components["schemas"]["Member"];
export type AssignmentView = components["schemas"]["AssignmentView"];
export type AssignmentRow = components["schemas"]["AssignmentRowRequest"];
export type AssignRequest = components["schemas"]["AssignRequest"];
export type AssignResponse = components["schemas"]["AssignResponse"];
export type ProposalRequest = components["schemas"]["ProposalRequest"];
export type ProposalResponse = components["schemas"]["ProposalResponse"];
export type ReassignRequest = components["schemas"]["ReassignRequest"];
export type TermLookup = { layer_id: string; term_id: string };
export type TermLabel = TermLookup & { label: string | null };

export type OntologyTranslation = components["schemas"]["OntologyTranslation"];
export type AdminOntology = components["schemas"]["AdminOntology"];
export type OntologyUploadResult = components["schemas"]["OntologyUploadResult"];

export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  term_count: number;
  path?: string | null;
  status?: "loaded" | "failed";
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

export class ApiClient {
  private readonly baseUrl: string;
  /** The session's CSRF token, sent with every write (index D-h). */
  private csrfToken: string | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
  }

  async listAssignments(key: string): Promise<AssignmentView[]> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments`, { method: "GET" }); }
  async createAssignments(key: string, body: AssignRequest): Promise<AssignResponse> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments`, { method: "POST", body: JSON.stringify(body) }); }
  async proposeDistribution(key: string, body: ProposalRequest): Promise<ProposalResponse> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/assignments/proposal`, { method: "POST", body: JSON.stringify(body) }); }
  async reassign(id: number, body: ReassignRequest): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/reassign`, { method: "POST", body: JSON.stringify(body) }); }
  async reopenAssignment(id: number, reason?: string): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/reopen`, { method: "POST", body: JSON.stringify({ reason }) }); }
  async revokeAssignment(id: number, reason?: string): Promise<AssignmentView> { return this.request(`/api/v1/assignments/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }); }

  async listTemplates(): Promise<TemplateInfo[]> { return this.request("/api/v1/projects/templates", { method: "GET" }); }
  async createProject(body: CreateProjectRequest): Promise<ProjectSettings> { return this.request("/api/v1/projects/", { method: "POST", body: JSON.stringify(body) }); }
  async getProjectSettings(key: string): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/settings`, { method: "GET" }); }
  async updateProjectSettings(key: string, change: ProjectSettingsPatch): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/settings`, { method: "PATCH", body: JSON.stringify(change) }); }
  async updatePins(key: string, pins: ProjectPin[]): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/pins`, { method: "PUT", body: JSON.stringify(pins) }); }
  async updateProjectProfile(key: string, profile: TaskProfile): Promise<ProjectSettings> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/profile`, { method: "PUT", body: JSON.stringify(profile) }); }
  async listMembers(key: string): Promise<Member[]> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/members`, { method: "GET" }); }
  async setMemberRoles(key: string, username: string, roles: string[], revoke = false): Promise<Member> { return this.request(`/api/v1/projects/${encodeURIComponent(key)}/members/${encodeURIComponent(username)}`, { method: "PUT", body: JSON.stringify({ roles, revoke_assignments: revoke }) }); }
  async listProjectDocuments(key: string, filters: ProjectDocumentFilters = {}): Promise<ProjectDocumentSummary[]> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
    return this.request<ProjectDocumentSummary[]>(`/api/v1/projects/${encodeURIComponent(key)}/documents${query.size ? `?${query}` : ""}`, { method: "GET" });
  }


  async createUpload(key: string, kind: "t1" | "text", files: readonly File[], language?: string): Promise<UploadCreated> {
    const body = new FormData(); body.append("kind", kind);
    for (const file of files) body.append("files[]", file);
    if (language) body.append("language", language);
    return this.request<UploadCreated>(`/api/v1/projects/${encodeURIComponent(key)}/uploads`, { method: "POST", body });
  }

  async listUploads(key: string): Promise<UploadView[]> {
    return this.request<UploadView[]>(`/api/v1/projects/${encodeURIComponent(key)}/uploads`, { method: "GET" });
  }

  async getUpload(key: string, id: number): Promise<UploadView> {
    return this.request<UploadView>(`/api/v1/projects/${encodeURIComponent(key)}/uploads/${id}`, { method: "GET" });
  }

  async commitUpload(key: string, id: number, planSha256: string): Promise<UploadCreated> {
    return this.request<UploadCreated>(`/api/v1/projects/${encodeURIComponent(key)}/uploads/${id}/commit`, { method: "POST", body: JSON.stringify({ plan_sha256: planSha256 }) });
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
    const response = await fetch(url, { ...options, headers, credentials: "same-origin" });

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

  /** The logged-in user of this browser's session; 401 without one. Stores the CSRF token. */
  async me(): Promise<CurrentUser> {
    const user = await this.request<CurrentUser>("/api/v1/auth/me", { method: "GET" });
    this.setCsrfToken(user.csrf_token);
    return user;
  }

  /** Raw transport; metadata lifetime and deduplication belong to the workspace. */
  async getProposalSet(projectKey: string, setId: number, signal?: AbortSignal): Promise<ProposalSetView> {
    return this.request<ProposalSetView>(`/api/v1/projects/${encodeURIComponent(projectKey)}/proposal-sets/${setId}`, { method: "GET", signal });
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

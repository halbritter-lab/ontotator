/**
 * Typed client for the Ontocurator API. The session lives in an HttpOnly cookie;
 * writes carry the session's CSRF token.
 */

import type { components } from "./generated";

export type DocumentSummary = components["schemas"]["DocumentSummary"];
export type ReviewInputsRequest = components["schemas"]["ReviewInputsRequest"];
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
/** The logged-in user; `csrf_token` goes back in `X-CSRF-Token` with every write. */
export type CurrentUser = components["schemas"]["CurrentUser"];
export type TermLookup = { layer_id: string; term_id: string };
export type TermLabel = TermLookup & { label: string | null };

export type OntologyTranslation = components["schemas"]["OntologyTranslation"];

export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  term_count: number;
  path?: string | null;
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

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** The logged-in user of this browser's session; 401 without one. Stores the CSRF token. */
  async me(): Promise<CurrentUser> {
    const user = await this.request<CurrentUser>("/api/v1/auth/me", { method: "GET" });
    this.setCsrfToken(user.csrf_token);
    return user;
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

/**
 * Typed client for HPO Annotation Editor local API.
 */

import type { components } from "./generated";

export type PackageManifest = components["schemas"]["PackageManifest"];
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
export type AxisDefinition = components["schemas"]["AxisDefinition"];
export type AxesConfig = components["schemas"]["AxesConfig"];
export type AxesValues = Record<string, string | null>;
export type Axes = AxesValues;
export type LayerDefinition = components["schemas"]["LayerDefinition"];
export type TaskScope = components["schemas"]["TaskScope"];
export type AnnotationTypeDefinition = components["schemas"]["AnnotationTypeDefinition"];
export type OntologyDefinition = components["schemas"]["OntologyDefinition"];
export type Preferences = components["schemas"]["Preferences"];
export type PreferencesUpdate = components["schemas"]["PreferencesUpdate"];
export type EffectiveSettings = components["schemas"]["EffectiveSettings"];
export type ProvisioningStatus = components["schemas"]["ProvisioningStatus"];
export type ProvisioningNotice = components["schemas"]["ProvisioningNotice"];
export type TermLookup = { layer_id: string; term_id: string };
export type TermLabel = TermLookup & { label: string | null };

export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  term_count: number;
  path?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;

  constructor(status: number, message: string, code?: string, details?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AuthError extends ApiError {
  constructor(message = "Unauthorized or invalid session token", details?: string, code = "FORBIDDEN") {
    super(403, message, code, details);
    this.name = "AuthError";
  }
}

/** Why the browser lost its session: the server restarted (new key) or none was given. */
export type SessionLostReason = "invalid" | "missing";

const SESSION_CODES: Record<string, SessionLostReason> = {
  SESSION_TOKEN_INVALID: "invalid",
  SESSION_TOKEN_MISSING: "missing",
};

function sessionLostReason(code: string | undefined, message: string): SessionLostReason | null {
  if (code && SESSION_CODES[code]) return SESSION_CODES[code];
  // Older servers sent no code; recognise their messages.
  if (/Invalid session token/i.test(message)) return "invalid";
  if (/Missing Bearer/i.test(message)) return "missing";
  return null;
}

/** Why the error means the page's access key is no longer accepted, or null. */
export function sessionLostReasonOf(err: unknown): SessionLostReason | null {
  return err instanceof AuthError ? sessionLostReason(err.code, err.message) : null;
}

/** True if the error means the page's access key is no longer accepted. */
export function isSessionLostError(err: unknown): boolean {
  return sessionLostReasonOf(err) !== null;
}

type SessionLostListener = (reason: SessionLostReason) => void;
const sessionLostListeners = new Set<SessionLostListener>();

/** Subscribe to "session lost" notifications from any API call. Returns an unsubscribe function. */
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

function notifySessionLost(reason: SessionLostReason): void {
  for (const listener of [...sessionLostListeners]) {
    try {
      listener(reason);
    } catch {
      // a broken listener must not break the API call
    }
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Revision conflict detected", code = "REVISION_CONFLICT", details?: string) {
    super(409, message, code, details);
    this.name = "ConflictError";
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, code = "VALIDATION_ERROR", details?: string) {
    super(422, message, code, details);
    this.name = "ValidationError";
  }
}

let activeSessionToken: string | null = null;
let launchPackageId: string | null = null;
const TOKEN_KEY = "hpo-editor-token";

/**
 * Parse a launch fragment such as `#token=T&package_id=P` (as emitted by the CLI).
 */
export function parseLaunchHash(hash: string): { token: string | null; packageId: string | null } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { token: null, packageId: null };
  const params = new URLSearchParams(raw);
  return {
    token: params.get("token") || null,
    packageId: params.get("package_id") || null,
  };
}

/**
 * Read session token (and optional package_id) from the URL hash, strip the
 * fragment from the address bar, and cache the token in memory and in
 * sessionStorage (tab-scoped, survives reloads, never persisted across sessions).
 */
export function initSessionToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    // Older builds persisted the token in localStorage; never keep it there.
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }

  const { token, packageId } = parseLaunchHash(window.location.hash);
  if (token || packageId) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  if (packageId) launchPackageId = packageId;
  if (token) {
    activeSessionToken = token;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // storage unavailable
    }
    return token;
  }

  try {
    activeSessionToken ??= window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
  return activeSessionToken;
}

/**
 * Interpret what a user pasted to reconnect: a full Ontocurator link
 * (`http://127.0.0.1:8000/#token=...`), just the fragment, or a bare access key.
 */
export function parseTokenInput(text: string): { token: string | null; packageId: string | null } {
  const value = text.trim();
  if (!value) return { token: null, packageId: null };
  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) return parseLaunchHash(value.slice(hashIndex));
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return { token: null, packageId: null };
  if (value.includes("=")) return parseLaunchHash(value);
  return { token: value, packageId: null };
}

/** Package id passed via the launch URL (`#...&package_id=P`), consumed once. */
export function takeLaunchPackageId(): string | null {
  const id = launchPackageId;
  launchPackageId = null;
  return id;
}

export function getActiveSessionToken(): string | null {
  return activeSessionToken;
}

export function setActiveSessionToken(token: string | null): void {
  activeSessionToken = token;
  if (!token || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

/** Extract a filename from a Content-Disposition header (supports RFC 5987 filename*). */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    let value = star[1].trim().replace(/^"(.*)"$/, "$1");
    const parts = /^([^']*)'[^']*'(.*)$/.exec(value);
    if (parts) value = parts[2];
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return value || null;
    }
  }
  const plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i.exec(header);
  if (plain) {
    const value = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, "$1") : plain[1].trim();
    return value || null;
  }
  return null;
}

export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private token: string | null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.token = options.token ?? activeSessionToken;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers ?? {});

    const token = this.token ?? activeSessionToken;
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (
      options.body &&
      !(options.body instanceof FormData) &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let code: string | undefined;
      let details: string | undefined;
      let message = `API request failed with status ${response.status}`;

      try {
        const errorJson = await response.json();
        if (errorJson && typeof errorJson === "object") {
          code = (errorJson.code as string) || undefined;
          details = (errorJson.details as string) || (errorJson.detail as string) || undefined;
          if (details) {
            message = details;
          }
        }
      } catch {
        // Response body was not JSON
      }

      if (response.status === 403) {
        const reason = sessionLostReason(code, message);
        if (reason) notifySessionLost(reason);
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

    return (await response.json()) as T;
  }

  async uploadPackage(
    file: File
  ): Promise<{ package_id: string; manifest: PackageManifest }> {
    const formData = new FormData();
    formData.append("file", file);

    return this.request<{ package_id: string; manifest: PackageManifest }>(
      "/api/v1/packages",
      {
        method: "POST",
        body: formData,
      }
    );
  }

  /** Presets of this installation (ontocurator-settings.json). */
  async getSettings(): Promise<EffectiveSettings> {
    return this.request<EffectiveSettings>("/api/v1/settings", { method: "GET" });
  }

  /** Notices from importing the ontologies/ and packages/ folders at start. */
  async getProvisioning(): Promise<ProvisioningStatus> {
    return this.request<ProvisioningStatus>("/api/v1/provisioning", { method: "GET" });
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

  async listPackages(): Promise<PackageManifest[]> {
    return this.request<PackageManifest[]>("/api/v1/packages", {
      method: "GET",
    });
  }

  async listDocuments(
    packageId: string,
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
      `/api/v1/packages/${encodeURIComponent(packageId)}/documents${
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

  async resolveTermLabels(packageId: string, terms: TermLookup[]): Promise<TermLabel[]> {
    return this.request<TermLabel[]>("/api/v1/terms/labels", {
      method: "POST",
      body: JSON.stringify({ package_id: packageId, terms }),
    });
  }

  getExportUrl(workspaceId: string): string {
    return `${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/export`;
  }

  getPackageExportUrl(packageId: string, params: { annotator_id: string; mode: string }): string {
    const qs = new URLSearchParams({ annotator_id: params.annotator_id, mode: params.mode });
    return `${this.baseUrl}/api/v1/packages/${encodeURIComponent(packageId)}/export?${qs.toString()}`;
  }

  private async downloadFile(url: string, fallbackName: string): Promise<string> {
    const token = this.token ?? activeSessionToken;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      let detail = "";
      let code: string | undefined;
      try {
        const body = await response.json();
        detail = body?.details || body?.detail || "";
        code = body?.code || undefined;
      } catch {
        // not JSON
      }
      if (response.status === 403) {
        const reason = sessionLostReason(code, detail);
        if (reason) {
          notifySessionLost(reason);
          throw new AuthError(detail, detail, code);
        }
      }
      throw new ApiError(
        response.status,
        `Export failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const filename =
      parseContentDispositionFilename(response.headers?.get?.("Content-Disposition")) ?? fallbackName;
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return filename;
  }

  async downloadExport(workspaceId: string): Promise<string> {
    return this.downloadFile(this.getExportUrl(workspaceId), "ontocurator-export.zip");
  }

  async downloadPackageExport(
    packageId: string,
    params: { annotator_id: string; mode: string },
  ): Promise<string> {
    return this.downloadFile(
      this.getPackageExportUrl(packageId, params),
      `${packageId}-export.zip`,
    );
  }

  async listOntologies(): Promise<OntologyInfo[]> {
    return this.request<OntologyInfo[]>("/api/v1/ontologies", {
      method: "GET",
    });
  }

  async uploadOntology(file: File): Promise<OntologyInfo> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request<OntologyInfo>("/api/v1/ontologies", {
      method: "POST",
      body: formData,
    });
  }
}

export const api = new ApiClient();

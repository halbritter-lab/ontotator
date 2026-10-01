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
  constructor(message = "Unauthorized or invalid session token", details?: string) {
    super(403, message, "FORBIDDEN", details);
    this.name = "AuthError";
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

/**
 * Read session token from URL hash, strip fragment from browser address bar,
 * and cache token in memory.
 */
export function initSessionToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    const token = hash.slice("#token=".length);
    // Remove the hash fragment without reloading page
    history.replaceState(null, "", window.location.pathname + window.location.search);
    activeSessionToken = token;
    return token;
  }

  return activeSessionToken;
}

export function getActiveSessionToken(): string | null {
  return activeSessionToken;
}

export function setActiveSessionToken(token: string | null): void {
  activeSessionToken = token;
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
        throw new AuthError(message, details);
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

  async listPackages(): Promise<PackageManifest[]> {
    return this.request<PackageManifest[]>("/api/v1/packages", {
      method: "GET",
    });
  }

  async listDocuments(packageId: string): Promise<DocumentSummary[]> {
    return this.request<DocumentSummary[]>(
      `/api/v1/packages/${encodeURIComponent(packageId)}/documents`,
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

  async searchOntology(req: SearchRequest): Promise<SearchResult> {
    return this.request<SearchResult>("/api/v1/search", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  getExportUrl(workspaceId: string): string {
    const token = this.token ?? activeSessionToken;
    const base = `${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(
      workspaceId
    )}/export`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }
}

export const api = new ApiClient();

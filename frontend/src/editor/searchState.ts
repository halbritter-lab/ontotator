import type { ApiClient, SearchCandidate, SearchRequest } from "../api/client";
import type { components } from "../api/generated";

export type WorkspaceKey = components["schemas"]["WorkspaceKey"];

export interface SearchState {
  query: string;
  route: "lexical" | "exact" | "id" | "browse";
  candidates: SearchCandidate[];
  isLoading: boolean;
  error: string | null;
  requestId: number;
}

export type SearchListener = (state: SearchState) => void;

export class SearchManager {
  private state: SearchState = {
    query: "",
    route: "lexical",
    candidates: [],
    isLoading: false,
    error: null,
    requestId: 0,
  };

  private listeners = new Set<SearchListener>();
  private activeAbortController: AbortController | null = null;

  constructor(private readonly client: ApiClient) {}

  getState(): SearchState {
    return this.state;
  }

  subscribe(listener: SearchListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<SearchState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn(this.state));
  }

  clear(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.state.requestId++;
    this.updateState({
      query: "",
      candidates: [],
      isLoading: false,
      error: null,
    });
  }

  async search(
    rawQuery: string,
    annotationId: string,
    workspaceKey: WorkspaceKey,
    route: "lexical" | "exact" | "id" | "browse" = "lexical",
    k = 10
  ): Promise<SearchCandidate[]> {
    const query = rawQuery.trim();

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    const currentRequestId = ++this.state.requestId;

    if (!query) {
      this.updateState({
        query: rawQuery,
        candidates: [],
        isLoading: false,
        error: null,
        route,
      });
      return [];
    }

    this.updateState({
      query: rawQuery,
      isLoading: true,
      error: null,
      route,
    });

    try {
      const searchReq: SearchRequest = {
        workspace_key: workspaceKey,
        annotation_id: annotationId,
        query,
        route,
        k,
      };

      const result = await this.client.searchOntology(searchReq);

      // Only apply if this request is still the latest one
      if (this.state.requestId === currentRequestId) {
        const candidates = result.candidates ?? [];
        this.updateState({
          candidates,
          isLoading: false,
          error: null,
        });
        return candidates;
      }
      return this.state.candidates;
    } catch (err: unknown) {
      if (this.state.requestId === currentRequestId) {
        const message = err instanceof Error ? err.message : String(err);
        this.updateState({
          candidates: [],
          isLoading: false,
          error: message,
        });
      }
      return [];
    }
  }
}

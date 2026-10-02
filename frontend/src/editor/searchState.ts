import type { ApiClient, SearchCandidate, SearchRequest } from "../api/client";
import type { components } from "../api/generated";

export type WorkspaceKey = components["schemas"]["WorkspaceKey"];

export interface SearchContext {
  workspaceId: string;
  documentId: string;
  layerId: string;
  typeId?: string | null;
  requestId: number;
}

export interface SearchState {
  searchId: string | null;
  query: string;
  layerId: string | null;
  route: "lexical" | "exact" | "id" | "browse";
  candidates: SearchCandidate[];
  isLoading: boolean;
  error: string | null;
  requestId: number;
}

export type SearchListener = (state: SearchState) => void;

export class SearchManager {
  private state: SearchState = {
    searchId: null,
    query: "",
    layerId: null,
    route: "lexical",
    candidates: [],
    isLoading: false,
    error: null,
    requestId: 0,
  };

  private currentLayerId: string | null = null;
  private listeners = new Set<SearchListener>();
  private activeAbortController: AbortController | null = null;

  constructor(private readonly client: ApiClient) {}

  getState(): SearchState {
    return this.state;
  }

  getCurrentLayerId(): string | null {
    return this.currentLayerId;
  }

  setLayer(layerId: string | null): void {
    if (this.currentLayerId !== layerId) {
      this.currentLayerId = layerId;
      this.clear();
    }
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
      searchId: null,
      query: "",
      layerId: this.currentLayerId,
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
    k = 10,
    layerId?: string | null
  ): Promise<SearchCandidate[]> {
    const query = rawQuery.trim();

    if (layerId !== undefined && layerId !== null) {
      this.currentLayerId = layerId;
    }
    const targetLayerId = this.currentLayerId;

    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    const currentRequestId = ++this.state.requestId;

    if (!query) {
      this.updateState({
        searchId: null,
        candidates: [],
        query: rawQuery,
        layerId: targetLayerId,
        isLoading: false,
        error: null,
        route,
      });
      return [];
    }

    this.updateState({
      searchId: null,
      candidates: [],
      query: rawQuery,
      layerId: targetLayerId,
      isLoading: true,
      error: null,
      route,
    });

    try {
      const searchReq: SearchRequest = {
        workspace_key: workspaceKey,
        annotation_id: annotationId,
        layer_id: targetLayerId ?? "hpo-layer",
        query,
        route,
        k,
      };


      const result = await this.client.searchOntology(searchReq);

      // Only apply if this request is still the latest one AND layer hasn't changed
      if (
        this.state.requestId === currentRequestId &&
        this.currentLayerId === targetLayerId
      ) {
        const candidates = result.candidates ?? [];
        this.updateState({
          searchId: result.search_id ?? null,
          candidates,
          layerId: targetLayerId,
          isLoading: false,
          error: null,
        });
        return candidates;
      }
      return this.state.candidates;
    } catch (err: unknown) {
      if (
        this.state.requestId === currentRequestId &&
        this.currentLayerId === targetLayerId
      ) {
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

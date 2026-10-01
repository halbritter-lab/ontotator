import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchManager } from "../src/editor/searchState";
import type { ApiClient, SearchCandidate, SearchResult } from "../src/api/client";

describe("SearchManager", () => {
  let mockClient: ApiClient;
  let searchOntologySpy: any;

  const sampleKey = {
    package_id: "pkg-1",
    document_id: "doc-1",
    annotator_id: "user-1",
    mode: "independent" as const,
    target_set_id: "targets-0",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    searchOntologySpy = vi.fn();
    mockClient = {
      searchOntology: searchOntologySpy,
    } as unknown as ApiClient;
  });

  it("returns empty candidates immediately for empty or whitespace query without calling API", async () => {
    const manager = new SearchManager(mockClient);
    const results = await manager.search("", "ann-1", sampleKey);

    expect(results).toEqual([]);
    expect(searchOntologySpy).not.toHaveBeenCalled();
    expect(manager.getState().candidates).toEqual([]);
    expect(manager.getState().isLoading).toBe(false);
  });

  it("updates state with candidates upon successful search", async () => {
    const candidate: SearchCandidate = {
      term_id: "HP:0001252",
      hpo_id: "HP:0001252",
      obsolete: false,
      label: "Hypotonia",
      definition: "Muscular hypotonia",
      matched_term: "hypotonia",
      match_kind: "exact_label",
      rank: 1,
      display_pos: 0,
    };
    const mockResult: SearchResult = {
      route: "lexical",
      query: "hypotonia",
      candidates: [candidate],
      displayed_ids: ["HP:0001252"],
      ranked_ids: ["HP:0001252"],
      shuffled: false,
    };
    searchOntologySpy.mockResolvedValue(mockResult);

    const manager = new SearchManager(mockClient);
    const promise = manager.search("hypotonia", "ann-1", sampleKey);

    expect(manager.getState().isLoading).toBe(true);
    const results = await promise;

    expect(results).toEqual([candidate]);
    expect(manager.getState().candidates).toEqual([candidate]);
    expect(manager.getState().isLoading).toBe(false);
    expect(manager.getState().error).toBeNull();
  });

  it("discards delayed responses from older queries (search A resolving after search B)", async () => {
    let resolveQueryA: (res: SearchResult) => void;
    let resolveQueryB: (res: SearchResult) => void;

    const promiseA = new Promise<SearchResult>((res) => {
      resolveQueryA = res;
    });
    const promiseB = new Promise<SearchResult>((res) => {
      resolveQueryB = res;
    });

    searchOntologySpy.mockImplementation((req: any) => {
      if (req.query === "queryA") return promiseA;
      if (req.query === "queryB") return promiseB;
      return Promise.resolve({ route: "lexical", query: req.query, candidates: [] });
    });

    const candidateA: SearchCandidate = {
      term_id: "HP:0000001",
      hpo_id: "HP:0000001",
      obsolete: false,
      label: "Term A",
      definition: "",
      matched_term: "term a",
      match_kind: "synonym",
      rank: 1,
      display_pos: 0,
    };
    const candidateB: SearchCandidate = {
      term_id: "HP:0000002",
      hpo_id: "HP:0000002",
      obsolete: false,
      label: "Term B",
      definition: "",
      matched_term: "term b",
      match_kind: "exact_label",
      rank: 1,
      display_pos: 0,
    };

    const manager = new SearchManager(mockClient);

    // Launch query A
    const reqA = manager.search("queryA", "ann-1", sampleKey);
    // Immediately launch query B
    const reqB = manager.search("queryB", "ann-1", sampleKey);

    // Resolve B first
    resolveQueryB!({
      route: "lexical",
      query: "queryB",
      candidates: [candidateB],
      shuffled: false,
    });
    await reqB;

    expect(manager.getState().candidates).toEqual([candidateB]);

    // Now resolve A late
    resolveQueryA!({
      route: "lexical",
      query: "queryA",
      candidates: [candidateA],
      shuffled: false,
    });
    await reqA;

    // Manager state MUST STILL be B!
    expect(manager.getState().candidates).toEqual([candidateB]);
    expect(manager.getState().query).toBe("queryB");
  });

  it("clears candidates and aborts when empty query follows a search", async () => {
    const candidate: SearchCandidate = {
      term_id: "HP:0001252",
      hpo_id: "HP:0001252",
      obsolete: false,
      label: "Hypotonia",
      definition: "",
      matched_term: "hypotonia",
      match_kind: "exact_label",
      rank: 1,
      display_pos: 0,
    };
    searchOntologySpy.mockResolvedValue({
      route: "lexical",
      query: "hypo",
      candidates: [candidate],
      shuffled: false,
    });

    const manager = new SearchManager(mockClient);
    await manager.search("hypo", "ann-1", sampleKey);
    expect(manager.getState().candidates).toHaveLength(1);

    await manager.search("", "ann-1", sampleKey);
    expect(manager.getState().candidates).toHaveLength(0);
    expect(manager.getState().query).toBe("");
  });

  it("handles search errors without throwing uncaught exceptions", async () => {
    searchOntologySpy.mockRejectedValue(new Error("Network timeout"));

    const manager = new SearchManager(mockClient);
    const results = await manager.search("error query", "ann-1", sampleKey);

    expect(results).toEqual([]);
    expect(manager.getState().candidates).toEqual([]);
    expect(manager.getState().isLoading).toBe(false);
    expect(manager.getState().error).toBe("Network timeout");
  });
});

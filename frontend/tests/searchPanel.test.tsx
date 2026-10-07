import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/editor/SearchPanel";
import { SearchManager } from "../src/editor/searchState";

const key = {
  package_id: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};

const renderPanel = (searchOntology: ReturnType<typeof vi.fn>) => {
  const manager = new SearchManager({ searchOntology } as any);
  render(
    <SearchPanel
      searchManager={manager}
      annotationId="a"
      workspaceKey={key}
      layerId="phenotype"
      onSelectCandidate={vi.fn()}
      debounceMs={0}
    />
  );
  return screen.getByLabelText(/Search ontology term/i);
};

describe("SearchPanel", () => {
  afterEach(cleanup);

  it("has no strategy selector, only the search box and one hint", () => {
    renderPanel(vi.fn().mockResolvedValue({ search_id: "s", candidates: [] }));

    expect(screen.queryByLabelText(/Search Strategy/i)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Search by name or code (e.g. HP:0001250)")).toBeDefined();
  });

  it("sends one auto request per input, for a code and for a keyword", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const input = renderPanel(searchOntology);

    fireEvent.change(input, { target: { value: "HP:0001250" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].route).toBe("auto");
    expect(searchOntology.mock.calls[0][0].query).toBe("HP:0001250");

    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(2));
    expect(searchOntology.mock.calls[1][0].route).toBe("auto");
    expect(searchOntology.mock.calls[1][0].query).toBe("seizure");
  });

  it("shows what matched with its kind, and the language when it is not English", async () => {
    const searchOntology = vi.fn().mockResolvedValue({
      search_id: "s",
      candidates: [
        {
          term_id: "HP:0001252",
          label: "Hypotonia",
          matched_term: "Muskelhypotonie",
          match_kind: "translation",
          match_language: "de",
          route: "exact",
          rank: 1,
          display_pos: 1,
        },
        {
          term_id: "HP:0001250",
          label: "Seizure",
          matched_term: "Seizures",
          match_kind: "hasExactSynonym",
          match_language: "en",
          route: "lexical",
          rank: 2,
          display_pos: 2,
        },
        {
          term_id: "HP:0001284",
          label: "Areflexia",
          matched_term: "Areflexia",
          match_kind: "label",
          route: "lexical",
          rank: 3,
          display_pos: 3,
        },
      ],
    });
    const input = renderPanel(searchOntology);
    fireEvent.change(input, { target: { value: "muskel" } });

    expect(await screen.findByText("Match: »Muskelhypotonie« (translation, de)")).toBeDefined();
    expect(screen.getByText("Match: »Seizures« (hasExactSynonym)")).toBeDefined();
    expect(screen.getAllByText(/^Match:/)).toHaveLength(2);
  });
});

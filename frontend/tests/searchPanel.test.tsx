import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/editor/SearchPanel";
import { toggledSelection, type SearchLanguageControl } from "../src/editor/searchLanguages";
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

  it("clear_search_is_named_and_clears_the_query", async () => {
    const input = renderPanel(vi.fn().mockResolvedValue({ search_id: "s", candidates: [] }));
    fireEvent.change(input, { target: { value: "seizure" } });
    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(clear.getAttribute("title")).toBe("Clear search");
    fireEvent.click(clear);
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
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

describe("SearchPanel language selection", () => {
  afterEach(cleanup);

  const loaded = ["de", "es"];

  /** The panel with a parent that keeps the selection, as the case screen does. */
  const Harness = ({
    searchOntology,
    initial,
    onStore,
  }: {
    searchOntology: ReturnType<typeof vi.fn>;
    initial: string[] | undefined;
    onStore: (selection: string[]) => void;
  }) => {
    const [manager] = useState(() => new SearchManager({ searchOntology } as any));
    const [stored, setStored] = useState(initial);
    const languages: SearchLanguageControl = {
      options: [
        { language: "de", termCount: 3412 },
        { language: "es", termCount: 18201 },
      ],
      active: stored === undefined ? loaded : loaded.filter((code) => stored.includes(code)),
      onToggle: (language) => {
        const next = toggledSelection(loaded, stored, language);
        setStored(next);
        onStore(next);
      },
    };
    return (
      <SearchPanel
        searchManager={manager}
        annotationId="a"
        workspaceKey={key}
        layerId="phenotype"
        onSelectCandidate={vi.fn()}
        debounceMs={0}
        languages={languages}
      />
    );
  };

  it("shows no language button without loaded translations and sends no languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const input = renderPanel(searchOntology);

    expect(screen.queryByRole("button", { name: /Search languages/ })).toBeNull();
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect("languages" in searchOntology.mock.calls[0][0]).toBe(false);
  });

  it("shows the button in the row of the search box and sends the active languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    render(<Harness searchOntology={searchOntology} initial={["es"]} onStore={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, ES" });
    const input = screen.getByLabelText(/Search ontology term/i);
    expect(button.closest(".search-language")!.parentElement).toBe(input.parentElement);

    fireEvent.change(input, { target: { value: "krampf" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].languages).toEqual(["es"]);
  });

  it("stores a deselection, repeats the pending query at once and sends the new languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const onStore = vi.fn();
    render(<Harness searchOntology={searchOntology} initial={undefined} onStore={onStore} />);
    const input = screen.getByLabelText(/Search ontology term/i);

    fireEvent.change(input, { target: { value: "krampf" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].languages).toEqual(["de", "es"]);

    fireEvent.click(screen.getByRole("button", { name: "Search languages: EN, DE, ES" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(onStore).toHaveBeenCalledWith(["es"]);
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(2));
    expect(searchOntology.mock.calls[1][0].query).toBe("krampf");
    expect(searchOntology.mock.calls[1][0].languages).toEqual(["es"]);
    expect(screen.getByRole("button", { name: "Search languages: EN, ES" })).toBeDefined();
    // The list stays open; English cannot be switched off.
    const english = screen.getByRole("checkbox", { name: "EN" }) as HTMLInputElement;
    expect(english.checked && english.disabled).toBe(true);
    expect(input.getAttribute("value")).toBe("krampf");

    // Switching the last language off still sends a selection: English only.
    fireEvent.click(screen.getByRole("checkbox", { name: "ES" }));
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(3));
    expect(searchOntology.mock.calls[2][0].languages).toEqual([]);
  });

  it("does not search when the selection changes while the box is empty", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const onStore = vi.fn();
    render(<Harness searchOntology={searchOntology} initial={undefined} onStore={onStore} />);

    fireEvent.click(screen.getByRole("button", { name: /Search languages/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(onStore).toHaveBeenCalledWith(["es"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(searchOntology).not.toHaveBeenCalled();
  });
});

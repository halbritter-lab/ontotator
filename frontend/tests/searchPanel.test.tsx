import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel, type SearchPanelProps } from "../src/editor/SearchPanel";
import { toggledSelection, type SearchLanguageControl } from "../src/editor/searchLanguages";
import { SearchManager } from "../src/editor/searchState";

const key = {
  project_key: "pkg",
  document_id: "doc",
  annotator_id: "dr-a",
  mode: "independent" as const,
  scope_id: "scope-default",
  target_set_id: "empty",
};

const renderPanel = (searchOntology: ReturnType<typeof vi.fn>, props: Partial<SearchPanelProps> = {}) => {
  const manager = new SearchManager({ searchOntology } as any);
  render(
    <SearchPanel
      searchManager={manager}
      annotationId="a"
      workspaceKey={key}
      layerId="phenotype"
      onSelectCandidate={vi.fn()}
      debounceMs={0}
      {...props}
    />
  );
  return screen.getByRole("combobox", { name: "Search term" }) as HTMLInputElement;
};

const hit = (term_id: string, label: string, extra: Record<string, unknown> = {}) => ({
  term_id, label, definition: `${label} definition.`, matched_term: label, match_kind: "label",
  rank: 1, display_pos: 1, obsolete: false, route: "lexical", ...extra,
});
const threeHits = { search_id: "s-1", candidates: [
  hit("HP:0000001", "Obsolete seizure", { obsolete: true }),
  hit("HP:0001250", "Seizure"),
  hit("HP:0002373", "Febrile seizure"),
] };
const options = () => screen.queryAllByRole("option");
const activeId = (input: HTMLElement) => input.getAttribute("aria-activedescendant");

describe("SearchPanel", () => {
  afterEach(cleanup);

  it("is an ARIA combobox with a listbox of options", async () => {
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits));
    expect(screen.queryByLabelText(/Search Strategy/i)).toBeNull();
    expect(input.id).toBe("search-input");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox", { name: "Terms" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    for (const option of options()) expect(option.hasAttribute("tabindex")).toBe(false);
    expect(options()[0].getAttribute("aria-disabled")).toBe("true");
    expect(options()[1].getAttribute("aria-disabled")).toBe("false");
  });

  it("runs a prefilled query at once, shows it selected and makes the first usable hit active", async () => {
    vi.useFakeTimers();
    try {
      const searchOntology = vi.fn().mockResolvedValue(threeHits);
      const input = renderPanel(searchOntology, { initialQuery: "seizure", autoFocus: true, debounceMs: 250 });
      expect(searchOntology).toHaveBeenCalledTimes(1);
      expect(searchOntology.mock.calls[0][0].query).toBe("seizure");
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("seizure");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(7);
      await act(async () => { await Promise.resolve(); });
      expect(options()).toHaveLength(3);
      expect(activeId(input)).toBe(options()[1].id);
      expect(options()[1].getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector(".search-hint")!.textContent).toBe("2 terms · ↓↑ choose · Enter add · Esc cancel");
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves the active hit with ArrowDown and ArrowUp without wrap and skips obsolete hits", async () => {
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits));
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(activeId(input)).toBe(options()[1].id));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId(input)).toBe(options()[2].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId(input)).toBe(options()[2].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeId(input)).toBe(options()[1].id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeId(input)).toBe(options()[1].id);
  });

  it("adds the active hit on Enter", async () => {
    const onSelectCandidate = vi.fn();
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits), { onSelectCandidate });
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(activeId(input)).toBe(options()[1].id));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectCandidate).toHaveBeenCalledWith(expect.objectContaining({ term_id: "HP:0001250" }), "s-1");
  });

  it("never adds a stale hit: Enter while a search is pending runs it and waits for a second Enter", async () => {
    const onSelectCandidate = vi.fn();
    const searchOntology = vi.fn().mockResolvedValue(threeHits);
    const input = renderPanel(searchOntology, { onSelectCandidate, debounceMs: 10_000 });
    fireEvent.change(input, { target: { value: "hypo" } });
    expect(searchOntology).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(searchOntology).toHaveBeenCalledTimes(1);
    expect(searchOntology.mock.calls[0][0].query).toBe("hypo");
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(onSelectCandidate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
    expect(searchOntology).toHaveBeenCalledTimes(1);
  });

  it("hides hits of an earlier query while the new one is pending", async () => {
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits), { debounceMs: 10_000 });
    fireEvent.change(input, { target: { value: "seizure" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(input, { target: { value: "seizures" } });
    expect(options()).toHaveLength(0);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("calls onEscape on Esc", () => {
    const onEscape = vi.fn();
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits), { onEscape });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("moves the active hit on pointer hover and adds on click", async () => {
    const onSelectCandidate = vi.fn();
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits), { onSelectCandidate });
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(activeId(input)).toBe(options()[1].id));
    fireEvent.pointerEnter(options()[2]);
    expect(activeId(input)).toBe(options()[2].id);
    fireEvent.pointerEnter(options()[0]);
    expect(activeId(input)).toBe(options()[2].id);
    fireEvent.click(options()[0]);
    expect(onSelectCandidate).not.toHaveBeenCalled();
    fireEvent.click(options()[2]);
    expect(onSelectCandidate).toHaveBeenCalledWith(expect.objectContaining({ term_id: "HP:0002373" }), "s-1");
  });

  it("shows Searching…, the no-hits sentence and a retryable error", async () => {
    let resolve: (value: unknown) => void = () => {};
    const searchOntology = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolve = r; }))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(threeHits);
    const input = renderPanel(searchOntology);
    fireEvent.change(input, { target: { value: "xyz" } });
    expect(screen.getByRole("status").textContent).toBe("Searching…");
    await act(async () => { resolve({ search_id: "s", candidates: [] }); });
    expect(await screen.findByText("No terms match “xyz”. Change the words, try a code (HP:0001250) or switch search languages.")).toBeDefined();
    fireEvent.change(input, { target: { value: "abc" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The term search failed.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(3));
    await screen.findByRole("alert");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(4));
    expect(searchOntology.mock.calls[3][0].query).toBe("abc");
    await waitFor(() => expect(options()).toHaveLength(3));
  });

  it("shows one-line definitions and the full definition on the active hit", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [
      hit("HP:0001250", "Seizure", { matched_term: "Absence seizure", match_kind: "hasExactSynonym" }),
      hit("HP:0002373", "Febrile seizure"),
    ] });
    const input = renderPanel(searchOntology);
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(activeId(input)).toBe(options()[0].id));
    const defs = options().map((option) => option.querySelector(".candidate-def")!);
    expect(defs[0].classList.contains("is-clamped")).toBe(false);
    expect(defs[1].classList.contains("is-clamped")).toBe(true);
    const match = options()[0].querySelector(".candidate-match")!;
    expect(match.textContent).toBe("Matched synonym “Absence seizure”");
    expect(match.getAttribute("title")).toBe("hasExactSynonym");
    expect(options()[1].querySelector(".candidate-match")).toBeNull();
  });

  it("marks the current term with an icon and text, not a glyph", async () => {
    const input = renderPanel(vi.fn().mockResolvedValue(threeHits), { currentTermId: "HP:0002373" });
    fireEvent.change(input, { target: { value: "seizure" } });
    const marker = await screen.findByText("Currently selected");
    expect(marker.closest(".candidate-selected")!.querySelector("svg")).not.toBeNull();
    expect(document.body.textContent).not.toContain("✓");
  });

  it("shows the empty hint", () => {
    renderPanel(vi.fn().mockResolvedValue(threeHits));
    expect(screen.getByText("Name or code, for example HP:0001250")).toBeDefined();
    cleanup();
    renderPanel(vi.fn().mockResolvedValue(threeHits), { emptyHint: "Type an English name." });
    expect(screen.getByText("Type an English name.")).toBeDefined();
    expect(screen.queryByText("Name or code, for example HP:0001250")).toBeNull();
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

  it("shows what matched, and the language when it is not English", async () => {
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

    expect(await screen.findByText("Matched German name “Muskelhypotonie”")).toBeDefined();
    expect(screen.getByText("Matched synonym “Seizures”")).toBeDefined();
    expect(screen.getAllByText(/^Matched /)).toHaveLength(2);
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
    const input = screen.getByRole("combobox", { name: "Search term" });
    expect(button.closest(".search-language")!.parentElement).toBe(input.parentElement);

    fireEvent.change(input, { target: { value: "krampf" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].languages).toEqual(["es"]);
  });

  it("stores a deselection, repeats the pending query at once and sends the new languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const onStore = vi.fn();
    render(<Harness searchOntology={searchOntology} initial={undefined} onStore={onStore} />);
    const input = screen.getByRole("combobox", { name: "Search term" });

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

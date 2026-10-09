import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagFor } from "../src/editor/flags";
import { SearchLanguageButton } from "../src/editor/SearchLanguageButton";
import {
  activeLanguages,
  toggledSelection,
  useSearchLanguages,
  type LanguageClient,
  type SearchLanguageControl,
} from "../src/editor/searchLanguages";

const hp = {
  ontology_id: "hp",
  release: "2026-06-23",
  sha256: "ABC123",
  term_count: 19000,
  translations: [
    { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 18201 },
    { language: "de", filenames: ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"], term_count: 3412 },
  ],
};
const mondo = { ontology_id: "mondo", release: "2026-01-01", sha256: "ffff", term_count: 7, translations: [] };

const clientWith = (stored?: Record<string, string[]>) => {
  const client = {
    listPackageOntologies: vi.fn().mockResolvedValue([hp, mondo]),
    getPreferences: vi.fn().mockResolvedValue({
      last_annotator_id: "JPL",
      mode_by_package: {},
      ...(stored ? { search_languages_by_annotator: stored } : {}),
    }),
    updatePreferences: vi.fn().mockResolvedValue({}),
  };
  return client as typeof client & LanguageClient;
};

describe("search language selection", () => {
  it("treats a missing selection as all loaded languages and ignores codes that are not loaded", () => {
    expect(activeLanguages(["de", "es"], undefined)).toEqual(["de", "es"]);
    expect(activeLanguages(["de", "es"], [])).toEqual([]);
    expect(activeLanguages(["de", "es"], ["es", "fr"])).toEqual(["es"]);
    // A language that arrived after the annotator chose starts switched off.
    expect(activeLanguages(["de", "es", "nl"], ["de", "es"])).toEqual(["de", "es"]);
  });

  it("switches one language and keeps stored codes that are not loaded", () => {
    expect(toggledSelection(["de", "es"], undefined, "de")).toEqual(["es"]);
    expect(toggledSelection(["de", "es"], ["es"], "de")).toEqual(["de", "es"]);
    expect(toggledSelection(["de", "es"], ["es"], "es")).toEqual([]);
    expect(toggledSelection(["de", "es"], ["es", "fr"], "es")).toEqual(["fr"]);
    expect(toggledSelection(["de", "es"], ["fr"], "de")).toEqual(["de", "fr"]);
  });
});

describe("useSearchLanguages", () => {
  it("offers the loaded languages of the ontology, all active by default", async () => {
    const client = clientWith();
    const { result } = renderHook(() => useSearchLanguages(client, "JPL", "study"));

    await waitFor(() => expect(result.current("abc123")).toBeDefined());
    const control = result.current("abc123")!;
    expect(control.options).toEqual([
      { language: "de", termCount: 3412 },
      { language: "es", termCount: 18201 },
    ]);
    expect(control.active).toEqual(["de", "es"]);
    expect(client.listPackageOntologies).toHaveBeenCalledWith("study");
  });

  it("gives nothing for an ontology without translations or an unknown one", async () => {
    const client = clientWith();
    const { result } = renderHook(() => useSearchLanguages(client, "JPL", "study"));

    await waitFor(() => expect(result.current("abc123")).toBeDefined());
    expect(result.current("ffff")).toBeUndefined();
    expect(result.current("nope")).toBeUndefined();
    expect(result.current(undefined)).toBeUndefined();
  });

  it("restores the stored selection of this annotator and not of another one", async () => {
    const client = clientWith({ JPL: ["es", "fr"], AB: ["de"] });

    const mine = renderHook(() => useSearchLanguages(client, "JPL", "study"));
    await waitFor(() => expect(mine.result.current("abc123")?.active).toEqual(["es"]));

    const theirs = renderHook(() => useSearchLanguages(client, "AB", "study"));
    await waitFor(() => expect(theirs.result.current("abc123")?.active).toEqual(["de"]));

    const nobody = renderHook(() => useSearchLanguages(client, "NEW", "study"));
    await waitFor(() => expect(nobody.result.current("abc123")).toBeDefined());
    expect(nobody.result.current("abc123")!.active).toEqual(["de", "es"]);
  });

  it("stores a change for this annotator only and applies it at once", async () => {
    const client = clientWith({ JPL: ["es", "fr"], AB: ["de"] });
    const { result } = renderHook(() => useSearchLanguages(client, "JPL", "study"));
    await waitFor(() => expect(result.current("abc123")?.active).toEqual(["es"]));

    act(() => result.current("abc123")!.onToggle("de"));
    expect(result.current("abc123")!.active).toEqual(["de", "es"]);
    expect(client.updatePreferences).toHaveBeenLastCalledWith({
      search_languages_by_annotator: { JPL: ["de", "es", "fr"] },
    });

    act(() => result.current("abc123")!.onToggle("es"));
    expect(result.current("abc123")!.active).toEqual(["de"]);
    expect(client.updatePreferences).toHaveBeenLastCalledWith({
      search_languages_by_annotator: { JPL: ["de", "fr"] },
    });
    expect(client.updatePreferences).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the server cannot be asked", async () => {
    const client = {
      listPackageOntologies: vi.fn().mockRejectedValue(new Error("offline")),
      getPreferences: vi.fn().mockRejectedValue(new Error("offline")),
      updatePreferences: vi.fn(),
    } as unknown as LanguageClient;
    const { result } = renderHook(() => useSearchLanguages(client, "JPL", "study"));

    await waitFor(() => expect(client.listPackageOntologies).toHaveBeenCalled());
    expect(result.current("abc123")).toBeUndefined();
  });
});

describe("SearchLanguageButton", () => {
  afterEach(cleanup);

  const control = (active: string[], languages = ["de", "es"], onToggle = vi.fn()): SearchLanguageControl => ({
    options: languages.map((language, index) => ({ language, termCount: 3412 + index * 14789 })),
    active,
    onToggle,
  });
  const flagsIn = (element: Element) =>
    Array.from(element.querySelectorAll("[data-language]")).map((node) => node.getAttribute("data-language"));

  it("bundles a flag image for the five languages and none for others", () => {
    for (const language of ["en", "de", "es", "fr", "nl", "DE"]) {
      expect(flagFor(language), language).toMatch(/\.svg|^data:image\/svg/);
    }
    expect(new Set(["en", "de", "es", "fr", "nl"].map(flagFor)).size).toBe(5);
    expect(flagFor("pt")).toBeUndefined();
  });

  it("shows the flags of the active languages, English first, and names them for screen readers", () => {
    render(<SearchLanguageButton control={control(["de"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE" });
    expect(flagsIn(button)).toEqual(["en", "de"]);
    expect(button.querySelectorAll("img")).toHaveLength(2);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows three flags and +n from four languages on", () => {
    render(<SearchLanguageButton control={control(["de", "es", "fr", "nl"], ["de", "es", "fr", "nl"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE, ES, FR, NL" });
    expect(flagsIn(button)).toEqual(["en", "de", "es"]);
    expect(button.textContent).toBe("+2");
  });

  it("shows exactly three flags without a counter for three languages", () => {
    render(<SearchLanguageButton control={control(["de", "es"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE, ES" });
    expect(flagsIn(button)).toEqual(["en", "de", "es"]);
    expect(button.textContent).toBe("");
  });

  it("falls back to the language code when no flag is bundled", () => {
    render(<SearchLanguageButton control={control(["pt"], ["pt"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, PT" });
    expect(button.querySelectorAll("img")).toHaveLength(1);
    expect(button.textContent).toBe("PT");
  });

  it("lists every loaded language with checkbox, flag and code; English is fixed", () => {
    const onToggle = vi.fn();
    render(<SearchLanguageButton control={control(["es"], ["de", "es"], onToggle)} />);
    fireEvent.click(screen.getByRole("button", { name: /Search languages/ }));

    const list = screen.getByRole("group", { name: "Search languages" });
    const boxes = Array.from(list.querySelectorAll("label")).map((label) => ({
      code: label.textContent,
      flag: label.querySelector("img")?.getAttribute("data-language"),
      checked: (label.querySelector("input") as HTMLInputElement).checked,
      disabled: (label.querySelector("input") as HTMLInputElement).disabled,
    }));
    expect(boxes).toEqual([
      { code: "EN", flag: "en", checked: true, disabled: true },
      { code: "DE", flag: "de", checked: false, disabled: false },
      { code: "ES", flag: "es", checked: true, disabled: false },
    ]);
    expect(screen.getByRole("checkbox", { name: "DE" }).closest("label")!.title).toBe(
      "3,412 terms have a name in this language",
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "EN" }));
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));
    expect(onToggle).toHaveBeenCalledWith("de");
    // The list stays open for further changes.
    expect(screen.getByRole("group")).toBeDefined();
  });

  it("closes on Escape and on a click outside, not on a click inside", () => {
    render(
      <div>
        <span>elsewhere</span>
        <SearchLanguageButton control={control(["de"])} />
      </div>,
    );
    const button = screen.getByRole("button", { name: /Search languages/ });

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("checkbox", { name: "DE" }));
    expect(screen.getByRole("group")).toBeDefined();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("group")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "DE" }), { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

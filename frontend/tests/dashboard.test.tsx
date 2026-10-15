import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api } from "../src/api/client";
import { loggedInAs } from "./session";

// The identity comes from the session; the preferences only keep the working modes.
const asAnnotator = (id: string) => {
  loggedInAs(id);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
  vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: id, mode_by_package: {} });
};
const confirmIdentity = async () => {};

describe("Curation Dashboard Start Screen", () => {
  const samplePackages = [
    {
      package_id: "pediatric-hpo-pkg",
      ontology: { ontology_id: "hp", release: "2026-09" },
    },
  ];

  const sampleDocuments = [
    {
      document_id: "doc-001",
      text_length: 1200,
      language: "de",
      position: 1,
      status: "completed" as const,
    },
    {
      document_id: "doc-002",
      text_length: 850,
      language: "de",
      position: 2,
      status: "in_progress" as const,
    },
    {
      document_id: "doc-003",
      text_length: 2400,
      language: "en",
      position: 3,
      status: "not_started" as const,
    },
  ];

  it("renders the dashboard table with documents and status badges", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("ontocurator")).toBeDefined();
      const table = screen.getByRole("table");
      expect(within(table).getByText("doc-001")).toBeDefined();
      expect(within(table).getByText("doc-002")).toBeDefined();
      expect(within(table).getByText("doc-003")).toBeDefined();
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText(/Completed|Abgeschlossen/i)).toBeDefined();
    expect(within(table).getByText(/In Progress|In Bearbeitung/i)).toBeDefined();
    expect(within(table).getByText(/^Open$|^Offen$/i)).toBeDefined();
  });

  it("shows the languages and term counts of each ontology", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);
    vi.spyOn(api, "listOntologies").mockResolvedValue([
      {
        ontology_id: "hp",
        release: "2026-06-23",
        sha256: "1",
        term_count: 19000,
        translations: [
          { language: "de", filenames: ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"], term_count: 3412 },
          { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 18201 },
          { language: "fr", filenames: ["hp-fr.babelon.tsv"], term_count: 880 },
        ],
      },
      { ontology_id: "mondo", release: "2026-01-01", sha256: "2", term_count: 7, translations: [] },
    ]);

    render(<App />);

    expect(
      await screen.findByText("Ontologies: HP 2026-06-23 · de 3 412 · es 18 201 · fr 880 terms, MONDO"),
    ).toBeDefined();
  });

  it("filters documents by status tabs", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/All \(3\)|Alle \(3\)/i)).toBeDefined();
    });

    const table = screen.getByRole("table");

    // Click "Open (1)"
    fireEvent.click(screen.getByText(/Open \(1\)|Offen \(1\)/i));
    expect(within(table).queryByText("doc-001")).toBeNull();
    expect(within(table).queryByText("doc-002")).toBeNull();
    expect(within(table).getByText("doc-003")).toBeDefined();

    // Click "In Progress (1)"
    fireEvent.click(screen.getByText(/In Progress \(1\)|In Bearbeitung \(1\)/i));
    expect(within(table).queryByText("doc-001")).toBeNull();
    expect(within(table).getByText("doc-002")).toBeDefined();
    expect(within(table).queryByText("doc-003")).toBeNull();

    // Click "Completed (1)"
    fireEvent.click(screen.getByText(/Completed \(1\)|Abgeschlossen \(1\)/i));
    expect(within(table).getByText("doc-001")).toBeDefined();
    expect(within(table).queryByText("doc-002")).toBeNull();
    expect(within(table).queryByText("doc-003")).toBeNull();
  });

  it("filters documents by search query", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);

    render(<App />);

    await waitFor(() => {
      const table = screen.getByRole("table");
      expect(within(table).getByText("doc-001")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText(/Filter cases by ID\.\.\.|Fall nach ID filtern\.\.\./i);
    fireEvent.change(searchInput, { target: { value: "doc-002" } });

    const table = screen.getByRole("table");
    expect(within(table).queryByText("doc-001")).toBeNull();
    expect(within(table).getByText("doc-002")).toBeDefined();
    expect(within(table).queryByText("doc-003")).toBeNull();
  });

  it("renders the continue hero card for the in-progress case and opens it", async () => {
    asAnnotator("annotator-1");
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);
    const openSpy = vi.spyOn(api, "openWorkspace").mockResolvedValue({
      workspace_id: "ws-hero",
      view: {
        document: { document_id: "doc-002", text: "Text", language: "de", text_sha256: "sha" },
        key: { package_id: "pediatric-hpo-pkg", document_id: "doc-002", annotator_id: "annotator-1", mode: "independent", scope_id: "s", target_set_id: "t" },
        scope: { scope_id: "s", mode: "independent", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
        draft: { schema_version: "ontocurator-draft/v3", revision: 1, annotations: [], decisions: [] },
        layers: [{ layer_id: "phenotype", label: "Phänotyp", access: "editable", default_visible: true, default_type_id: "default", annotation_types: [] }],
      } as any,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Continue where you left off/i)).toBeDefined();
      expect(screen.getAllByText(/doc-002/).length).toBeGreaterThanOrEqual(1);
    });

    const resumeBtn = screen.getByRole("button", { name: /Open case/i });
    fireEvent.click(resumeBtn);
    await confirmIdentity();

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: "doc-002",
        })
      );
    });
  });
});

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError } from "../src/api/client";
import { loggedInAs } from "./session";

describe("In-App Ontology Management and Recovery", () => {
  it("renders recovery prompt when package upload fails with ONTOLOGY_NOT_FOUND and allows uploading missing ontology", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    vi.spyOn(api, "listOntologies").mockResolvedValue([]);
    
    vi.spyOn(api, "uploadPackage").mockRejectedValue(
      new ApiError(400, "Missing ontology 'hp'", "ONTOLOGY_NOT_FOUND", "Missing ontology 'hp'")
    );
    const uploadOntSpy = vi.spyOn(api, "uploadOntology").mockResolvedValue({
      ontology_id: "hp",
      release: "2026-06",
      sha256: "abc1234",
      term_count: 15000,
    });

    loggedInAs("annotator-1");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("ontocurator")).toBeDefined();
    });

    // Attempt to upload a package
    const pkgInput = screen.getByLabelText(/Work package file/i);
    const fakeZip = new File(["dummy zip"], "test.zip", { type: "application/zip" });
    fireEvent.change(pkgInput, { target: { files: [fakeZip] } });

    // Expect the recovery prompt to appear
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain("Missing ontology 'hp'");
    });

    // Upload the missing ontology
    const ontInput = screen.getByLabelText(/Upload missing ontology/i);
    const fakeJson = new File(['{"graphs": []}'], "hp.json", { type: "application/json" });
    fireEvent.change(ontInput, { target: { files: [fakeJson] } });

    await waitFor(() => {
      expect(uploadOntSpy).toHaveBeenCalledWith(fakeJson);
    });
  });

  it("accepts a translation file in the header upload and reports what was loaded", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    const translations = [{ language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 3412 }];
    const listSpy = vi
      .spyOn(api, "listOntologies")
      .mockResolvedValueOnce([{ ontology_id: "hp", release: "2026-06-23", sha256: "abc", term_count: 19000 }])
      .mockResolvedValue([
        { ontology_id: "hp", release: "2026-06-23", sha256: "abc", term_count: 19000, translations },
      ]);
    const uploadSpy = vi.spyOn(api, "uploadOntology").mockResolvedValue({
      filename: "hp-de.babelon.tsv",
      language: "de",
      assigned: true,
      message: "hp-de.babelon.tsv was added. HP 2026-06-23: de 3412 terms.",
      ontologies: [],
    });

    loggedInAs("annotator-1");
    render(<App />);
    await waitFor(() => expect(screen.getByText("Ontologies: HP")).toBeDefined());

    const input = screen.getByLabelText("Ontology (.json) or translation file (.tsv)") as HTMLInputElement;
    expect(input.accept.split(",")).toEqual([".json", ".tsv"]);
    expect(screen.getByRole("button", { name: "Add ontology (.json) or translation (.tsv)" })).toBeDefined();

    const tsv = new File(["subject_id\ttranslation_value\n"], "hp-de.babelon.tsv", {
      type: "text/tab-separated-values",
    });
    fireEvent.change(input, { target: { files: [tsv] } });

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(tsv));
    const notice = await screen.findByRole("status", { name: "Import result" });
    expect(notice.textContent).toContain("hp-de.babelon.tsv was added. HP 2026-06-23: de 3412 terms.");
    // The ontology display is refreshed after the upload.
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Ontologies: HP 2026-06-23 · de 3 412 terms")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no notice after a plain ontology upload", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    vi.spyOn(api, "listOntologies").mockResolvedValue([]);
    const uploadSpy = vi.spyOn(api, "uploadOntology").mockResolvedValue({
      ontology_id: "hp",
      release: "2026-06",
      sha256: "abc1234",
      term_count: 15000,
    });

    loggedInAs("annotator-1");
    render(<App />);
    const input = await screen.findByLabelText("Ontology (.json) or translation file (.tsv)");
    const json = new File(['{"graphs": []}'], "hp.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [json] } });

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(json));
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    expect(screen.queryByRole("status", { name: "Import result" })).toBeNull();
  });
});

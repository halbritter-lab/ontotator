import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api, ApiError } from "../src/api/client";

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
});

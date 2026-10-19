import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { FinalExportPanel } from "../src/admin/FinalExportPanel";
const preflight = { project: "p", selections: [{ case_id: "case", language: "en", document_id: "d", submission_id: "s", revision: 1 }], warnings: [{ id: "w", code: "OPEN_PROBLEM_REPORT", cause_revision: 2, case_id: "case", language: "en", reason: "Wording under review", destination: "#/tasks/1" }], omissions: [], state_digest: "a".repeat(64) };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("requires conscious warning acceptance and sends exact preflight identities", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.spyOn(api, "getJob").mockResolvedValue({ id: 8, kind: "final_t1_export", status: "queued", result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Review final export" }));
  await screen.findByText("Wording under review");
  expect((screen.getByRole("button", { name: "Create final export" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith("p", expect.objectContaining({ state_digest: preflight.state_digest, acknowledged_warnings: [{ id: "w", cause_revision: 2 }], accepted_omissions: [] })));
});

it("invalidates acknowledgement when the selection changes and ignores an older pending preflight", async () => {
  let resolve!: (value: typeof preflight) => void;
  vi.spyOn(api, "finalExportPreflight").mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Review final export" }));
  act(() => { window.dispatchEvent(new CustomEvent("ontocurator:final-selection-changed", { detail: { projectKey: "p" } })); });
  await act(async () => { resolve(preflight); });
  expect(screen.queryByRole("button", { name: "Create final export" })).toBeNull();
});
it("blocks empty exports and provides a route back to results", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, selections: [], warnings: [] });
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Review final export" }));
  await screen.findByText("Select at least one submitted result before exporting.");
  expect((screen.getByRole("button", { name: "Create final export" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: "Return to results" }).getAttribute("href")).toBe("#/projects/p/documents");
  expect(start).not.toHaveBeenCalled();
});

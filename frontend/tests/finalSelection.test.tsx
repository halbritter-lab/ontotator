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
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByText("Wording under review");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith("p", expect.objectContaining({ state_digest: preflight.state_digest, acknowledged_warnings: [{ id: "w", cause_revision: 2 }], accepted_omissions: [] })));
});

it("invalidates acknowledgement when the selection changes and ignores an older pending preflight", async () => {
  let resolve!: (value: typeof preflight) => void;
  vi.spyOn(api, "finalExportPreflight").mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  act(() => { window.dispatchEvent(new CustomEvent("ontocurator:final-selection-changed", { detail: { projectKey: "p" } })); });
  await act(async () => { resolve(preflight); });
  expect(screen.queryByRole("button", { name: "Create final export" })).toBeNull();
});
it("blocks empty exports and offers Cancel instead of a link back", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, selections: [], warnings: [] });
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByText("Select at least one submitted result before exporting.");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Return to results" })).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
});

const primaries = () => document.querySelectorAll('section[aria-label="Selected final results"] .btn-primary');
const job = (status: string) => ({ id: 8, kind: "final_t1_export", status, result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });

it("has exactly one primary action in every state", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  const getJob = vi.spyOn(api, "getJob").mockResolvedValue(job("queued") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect([...primaries()].map(b => b.textContent)).toEqual(["Prepare final export"]);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByText("Wording under review");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  fireEvent.click(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await screen.findByText("Final export 8: queued");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download final export"]);
  expect(screen.getByRole("button", { name: "Download final export" }).getAttribute("aria-disabled")).toBe("true");
  getJob.mockResolvedValue(job("succeeded") as never);
  await screen.findByText("Final export 8: succeeded", undefined, { timeout: 5000 });
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download final export"]);
  fireEvent.click(screen.getByRole("button", { name: "Prepare a new export" }));
  expect([...primaries()].map(b => b.textContent)).toEqual(["Prepare final export"]);
  expect(document.activeElement?.textContent).toBe("Prepare final export");
});

it("opens the preflight with a summary and focuses its heading", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, omissions: [{ case_id: "other", language: "de" }] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect(screen.getByText("The archive includes README.txt and index.csv, a plain-language guide and a table of every result.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const heading = await screen.findByRole("heading", { name: "Export preflight" });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByRole("region", { name: "Export preflight" })).toBeDefined();
  expect(screen.getByText("1 selected results · 1 warnings · 1 omitted")).toBeDefined();
  expect(screen.getByRole("group", { name: "Final export actions" })).toBeDefined();
});

it("explains unacknowledged warnings and moves focus to the checkbox instead of starting", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const create = await screen.findByRole("button", { name: "Create final export" });
  const hint = screen.getByText("Confirm the warnings and omissions above to continue.");
  expect(create.getAttribute("aria-describedby")).toBe(hint.id);
  create.focus();
  fireEvent.click(create);
  expect(start).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
});

it("cancels back to idle without a request, clears the acknowledgement and focuses Prepare", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  fireEvent.click(await screen.findByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("region", { name: "Export preflight" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Prepare final export" }));
  expect(read).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  expect((await screen.findByLabelText("Export these selected results with the listed warnings and omissions") as HTMLInputElement).checked).toBe(false);
});

it("keeps focus on Create while the export is being created", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  const start = vi.spyOn(api, "startFinalExport").mockReturnValue(new Promise(() => undefined));
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  const create = await screen.findByRole("button", { name: "Create final export" });
  create.focus();
  fireEvent.click(create);
  await waitFor(() => expect(create.getAttribute("aria-busy")).toBe("true"));
  expect(start).toHaveBeenCalledTimes(1);
  expect(create.getAttribute("aria-disabled")).toBe("true");
  expect(create.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(create);
  fireEvent.click(create);
  expect(start).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("region", { name: "Export preflight" })).toBeDefined();
});

it("says so when final selections change while the preflight is open", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(screen.getByRole("button", { name: "Prepare final export" }));
  await screen.findByRole("heading", { name: "Export preflight" });
  act(() => { window.dispatchEvent(new CustomEvent("ontocurator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed. Prepare the export again.")).toBeDefined();
  expect(screen.queryByRole("region", { name: "Export preflight" })).toBeNull();
});

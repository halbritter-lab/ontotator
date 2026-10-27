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
  await screen.findByText("Wording under review");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith("p", expect.objectContaining({ state_digest: preflight.state_digest, acknowledged_warnings: [{ id: "w", cause_revision: 2 }], accepted_omissions: [] })));
});

it("invalidates acknowledgement when the selection changes and ignores an older pending preflight", async () => {
  let resolve!: (value: typeof preflight) => void;
  const read = vi.spyOn(api, "finalExportPreflight").mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ...preflight, warnings: [] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => { resolve(preflight); });
  expect(screen.queryByText("Wording under review")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBeNull());

  read.mockResolvedValue(preflight);
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  fireEvent.click(await screen.findByLabelText("Export these selected results with the listed warnings and omissions"));
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect((await screen.findByLabelText("Export these selected results with the listed warnings and omissions") as HTMLInputElement).checked).toBe(false);
});
it("blocks empty exports and offers Check again instead of a link back", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, selections: [], warnings: [] });
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("Select at least one submitted result before exporting.");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Return to results" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check again" })).toBeDefined();
});

const primaries = () => document.querySelectorAll('section[aria-label="Selected final results"] .btn-primary');
const job = (status: string) => ({ id: 8, kind: "final_t1_export", status, result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });

it("has exactly one primary action in every state", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  const getJob = vi.spyOn(api, "getJob").mockResolvedValue(job("queued") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
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
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  expect(document.activeElement?.textContent).toBe("Check again");
  await screen.findByText("Wording under review");
  expect(api.finalExportPreflight).toHaveBeenCalledTimes(2);
});

it("shows the preflight with a summary without moving focus", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, omissions: [{ case_id: "other", language: "de" }] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect(screen.getByText(/The archive includes README\.txt and index\.csv/)).toBeDefined();
  const heading = await screen.findByRole("heading", { name: "Export check" });
  expect(document.activeElement).not.toBe(heading);
  expect(screen.getByRole("region", { name: "Export check" })).toBeDefined();
  const counts = screen.getByText("1 selected result, 1 warning, 1 omitted");
  expect(counts.tagName).toBe("STRONG");
  const actions = screen.getByRole("group", { name: "Final export actions" });
  // The numbers and the actions come before the reference prose.
  const prose = screen.getByText(/The archive includes README\.txt/);
  expect(counts.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(actions.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("explains unacknowledged warnings and moves focus to the checkbox instead of starting", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("Wording under review");
  const create = screen.getByRole("button", { name: "Create final export" });
  const hint = screen.getByText("Confirm the warnings and omissions listed below to continue.");
  expect(create.getAttribute("aria-describedby")).toBe(hint.id);
  create.focus();
  fireEvent.click(create);
  expect(start).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText("Export these selected results with the listed warnings and omissions"));
});

it("checks again without starting, clears the acknowledgement and keeps focus on Check again", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(await screen.findByLabelText("Export these selected results with the listed warnings and omissions"));
  const again = screen.getByRole("button", { name: "Check again" });
  again.focus();
  fireEvent.click(again);
  expect(screen.queryByRole("region", { name: "Export check" })).toBeNull();
  expect(screen.getByText("Checking final results…")).toBeDefined();
  expect(document.activeElement).toBe(again);
  expect((await screen.findByLabelText("Export these selected results with the listed warnings and omissions") as HTMLInputElement).checked).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
  expect(start).not.toHaveBeenCalled();
});

it("shows a failed check with Check again and keeps Create unavailable", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockRejectedValueOnce(new Error("Network down")).mockResolvedValue(preflight);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("Check again to confirm the current selections and warnings.");
  const create = screen.getByRole("button", { name: "Create final export" });
  expect(create.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Wording under review");
  expect(read).toHaveBeenCalledTimes(2);
});

it("keeps focus on Create while the export is being created", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  const start = vi.spyOn(api, "startFinalExport").mockReturnValue(new Promise(() => undefined));
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByRole("region", { name: "Export check" });
  const create = screen.getByRole("button", { name: "Create final export" });
  create.focus();
  fireEvent.click(create);
  await waitFor(() => expect(create.getAttribute("aria-busy")).toBe("true"));
  expect(start).toHaveBeenCalledTimes(1);
  expect(create.getAttribute("aria-disabled")).toBe("true");
  expect(create.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(create);
  fireEvent.click(create);
  expect(start).toHaveBeenCalledTimes(1);
  const again = screen.getByRole("button", { name: "Check again" });
  expect(again.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(again);
  expect(api.finalExportPreflight).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region", { name: "Export check" })).toBeDefined();
});

it("says so and checks again when final selections change while the preflight is open", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByRole("heading", { name: "Export check" });
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed. The check was run again.")).toBeDefined();
  expect(screen.queryByRole("region", { name: "Export check" })).toBeNull();
  await screen.findByRole("heading", { name: "Export check" });
  expect(read).toHaveBeenCalledTimes(2);
});

it("keeps a finished export when final selections change afterwards and says so", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.spyOn(api, "getJob").mockResolvedValue(job("succeeded") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByRole("region", { name: "Export check" });
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await screen.findByText("Final export 8: succeeded");
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed after this export was created.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Download final export" })).toBeDefined();
  expect(read).toHaveBeenCalledTimes(1);
});

it("groups identical warnings with a count, collapses long lists and keeps the actions above them", async () => {
  const warnings = Array.from({ length: 120 }, (_, index) => ({ ...preflight.warnings[0], id: `w${index}`, case_id: `case-${index}`, reason: "No final result selected." }));
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [...warnings, preflight.warnings[0]] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect((await screen.findByText("120 texts:")).nextElementSibling?.textContent).toBe("No final result selected.");
  expect(screen.getByText("1 text:")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: /^Show case-/ })).toHaveLength(5);
  const create = screen.getByRole("button", { name: "Create final export" });
  expect(create.compareDocumentPosition(screen.getByText("120 texts:")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all 120" }));
  expect(screen.getAllByRole("link", { name: /^Show case-/ })).toHaveLength(120);
  expect(screen.queryByRole("button", { name: "Show all 120" })).toBeNull();
});

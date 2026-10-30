import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { FinalExportPanel } from "../src/admin/FinalExportPanel";
const preflight = { project: "p", selections: [{ case_id: "case", language: "en", document_id: "d", submission_id: "s", revision: 1 }], warnings: [{ id: "w", code: "OPEN_PROBLEM_REPORT", cause_revision: 2, case_id: "case", language: "en", reason: "Wording under review", destination: "#/tasks/1" }], omissions: [], state_digest: "a".repeat(64) };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const ACK = /^Export the 1 result as it is/;
it("requires conscious warning acceptance and sends exact preflight identities", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.spyOn(api, "getJob").mockResolvedValue({ id: 8, kind: "final_t1_export", status: "queued", result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("Wording under review");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByLabelText(ACK));
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
  fireEvent.click(await screen.findByLabelText(ACK));
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect((await screen.findByLabelText(ACK) as HTMLInputElement).checked).toBe(false);
});
it("blocks empty exports and offers Check again instead of a link back", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, selections: [], warnings: [] });
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("No final results are selected yet. Accept submitted results in Documents to include them.");
  expect(screen.getByRole("link", { name: "Go to Documents" }).getAttribute("href")).toBe("#/projects/p/documents");
  expect(screen.getByRole("button", { name: "Create final export" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Return to results" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check again" })).toBeDefined();
});

const primaries = () => document.querySelectorAll('section[aria-labelledby="final-export-heading"] .btn-primary');
const job = (status: string) => ({ id: 8, kind: "final_t1_export", status, result: null, error: null, created_at: "2026-10-18T12:00:00Z", finished_at: null });

it("has exactly one primary action in every state", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  const getJob = vi.spyOn(api, "getJob").mockResolvedValue(job("queued") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  await screen.findByText("Wording under review");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  fireEvent.click(screen.getByLabelText(ACK));
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await screen.findByText("Creating the final export…");
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download (ZIP)"]);
  expect(screen.getByRole("button", { name: "Download (ZIP)" }).getAttribute("aria-disabled")).toBe("true");
  getJob.mockResolvedValue(job("succeeded") as never);
  await screen.findByText("Final export ready: 1 result", undefined, { timeout: 5000 });
  expect([...primaries()].map(b => b.textContent)).toEqual(["Download (ZIP)"]);
  fireEvent.click(screen.getByRole("button", { name: "Prepare a new export" }));
  expect([...primaries()].map(b => b.textContent)).toEqual(["Create final export"]);
  expect(document.activeElement?.textContent).toBe("Check again");
  await screen.findByText("Wording under review");
  expect(api.finalExportPreflight).toHaveBeenCalledTimes(2);
});

it("shows the counts and the grouped table without moving focus", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, omissions: [{ case_id: "other", language: "de" }] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect(screen.getByText(/one result file per text, a plain-language guide \(README\.txt\)/)).toBeDefined();
  const check = await screen.findByRole("region", { name: "Export check" });
  expect(check.contains(document.activeElement)).toBe(false);
  const counts = [...check.querySelectorAll(".stat-row > div")].map(item => item.textContent);
  expect(counts).toEqual(["ready to export1", "left out: no final result1", "need your decision1"]);
  expect(screen.getByRole("rowgroup", { name: "Needs your decision" }).textContent).toContain("Wording under review");
  expect(screen.getByRole("rowgroup", { name: "Left out: no final result" }).textContent).toContain("No final result selected");
  expect(screen.getByLabelText("Export the 1 result as it is; leave out the other text")).toBeDefined();
  // The actions come before the reference prose.
  const actions = screen.getByRole("group", { name: "Final export actions" });
  expect(actions.compareDocumentPosition(screen.getByText("What is in the file?")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("asks for a counted acknowledgement before leaving texts out", async () => {
  const leftOut = { ...preflight.warnings[0], id: "m", code: "MISSING_FINAL_SELECTION", case_id: "other", language: "de", reason: "No final result selected. This language will be omitted if you continue." };
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [leftOut], omissions: [{ case_id: "other", language: "de" }] });
  const start = vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.spyOn(api, "getJob").mockResolvedValue(job("queued") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  const group = await screen.findByRole("rowgroup", { name: "Left out: no final result" });
  expect(group.textContent).toContain("other de");
  expect(screen.queryByRole("rowgroup", { name: "Needs your decision" })).toBeNull();
  const create = screen.getByRole("button", { name: "Create final export" });
  expect(create.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(create);
  expect(start).not.toHaveBeenCalled();
  const box = screen.getByLabelText("Export the 1 result as it is; leave out the other text");
  expect(document.activeElement).toBe(box);
  fireEvent.click(box);
  expect(create.getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(create);
  // The server expects every warning and omission acknowledged.
  await waitFor(() => expect(start).toHaveBeenCalledWith("p", expect.objectContaining({ acknowledged_warnings: [{ id: "m", cause_revision: 2 }], accepted_omissions: [{ case_id: "other", language: "de" }] })));
});

it("lists a text that needs a decision once, not again under Left out", async () => {
  const both = { ...preflight, warnings: [{ ...preflight.warnings[0], case_id: "other", language: "de" }, { ...preflight.warnings[0], id: "m", code: "MISSING_FINAL_SELECTION", case_id: "other", language: "de", reason: "No final result selected." }],
    omissions: [{ case_id: "other", language: "de" }] };
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(both);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByRole("rowgroup", { name: "Needs your decision" });
  expect(screen.queryByRole("rowgroup", { name: "Left out: no final result" })).toBeNull();
  expect(screen.getAllByRole("link", { name: "Open in Documents, other de" })).toHaveLength(1);
  expect(screen.getByRole("checkbox")).toBeDefined();
});

it("says so when every text has a final result", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  expect(await screen.findByText(/The text has a final result\. Nothing to check\./)).toBeDefined();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("explains unacknowledged warnings and moves focus to the checkbox instead of starting", async () => {
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByText("Wording under review");
  const create = screen.getByRole("button", { name: "Create final export" });
  const hint = screen.getByText("Tick the box above to continue.");
  expect(create.getAttribute("aria-describedby")).toBe(hint.id);
  create.focus();
  fireEvent.click(create);
  expect(start).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText(ACK));
});

it("checks again without starting, clears the acknowledgement and keeps focus on Check again", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue(preflight);
  const start = vi.spyOn(api, "startFinalExport");
  render(<FinalExportPanel projectKey="p" username="lead" />);
  fireEvent.click(await screen.findByLabelText(ACK));
  const again = screen.getByRole("button", { name: "Check again" });
  again.focus();
  fireEvent.click(again);
  expect(screen.queryByRole("region", { name: "Export check" })).toBeNull();
  expect(screen.getByText("Checking final results…")).toBeDefined();
  expect(document.activeElement).toBe(again);
  expect((await screen.findByLabelText(ACK) as HTMLInputElement).checked).toBe(false);
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
  await screen.findByRole("region", { name: "Export check" });
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed. The check was run again.")).toBeDefined();
  expect(screen.queryByRole("region", { name: "Export check" })).toBeNull();
  await screen.findByRole("region", { name: "Export check" });
  expect(read).toHaveBeenCalledTimes(2);
});

it("keeps a finished export when final selections change afterwards and says so", async () => {
  const read = vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [] });
  vi.spyOn(api, "startFinalExport").mockResolvedValue({ job_id: 8 });
  vi.spyOn(api, "getJob").mockResolvedValue(job("succeeded") as never);
  render(<FinalExportPanel projectKey="p" username="lead" />);
  await screen.findByRole("region", { name: "Export check" });
  fireEvent.click(screen.getByRole("button", { name: "Create final export" }));
  await screen.findByText("Final export ready: 1 result");
  act(() => { window.dispatchEvent(new CustomEvent("ontotator:final-selection-changed", { detail: { projectKey: "p" } })); });
  expect(screen.getByText("Final selections changed after this export was created.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Download (ZIP)" })).toBeDefined();
  expect(read).toHaveBeenCalledTimes(1);
});

it("groups texts that need a decision, collapses long lists so the actions stay close", async () => {
  const warnings = Array.from({ length: 120 }, (_, index) => ({ ...preflight.warnings[0], id: `w${index}`, case_id: `case-${index}`, reason: "Selected an earlier round." }));
  vi.spyOn(api, "finalExportPreflight").mockResolvedValue({ ...preflight, warnings: [...warnings, preflight.warnings[0]] });
  render(<FinalExportPanel projectKey="p" username="lead" />);
  const group = await screen.findByRole("rowgroup", { name: "Needs your decision" });
  expect(group.querySelector("th")?.textContent).toBe("Needs your decision (121)");
  expect(screen.getAllByRole("link", { name: /^Open in Documents, case-/ })).toHaveLength(5);
  expect(screen.getAllByRole("link", { name: /^Open in Documents, case-/ })[0]!.getAttribute("href")).toBe("#/projects/p/documents?language=en&case=case-0");
  const create = screen.getByRole("button", { name: "Create final export" });
  expect(group.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all 121" }));
  expect(screen.getAllByRole("link", { name: /^Open in Documents, case-/ })).toHaveLength(120);
  expect(screen.queryByRole("button", { name: "Show all 121" })).toBeNull();
});

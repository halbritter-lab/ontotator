import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, AuthError, type ProjectProgress } from "../src/api/client";
import { ProgressPage } from "../src/admin/ProgressPage";
const progress: ProjectProgress = {
  totals: { documents: 9, unassigned: 3, open: 12, in_progress: 4, submitted: 8, reopened: 2 },
  people: [
    { username: "low", display_name: "Low", pseudonym: "Reader L", open: 1, in_progress: 0, submitted: 9, reopened: 7 },
    { username: "first", display_name: "First tie", pseudonym: "Reader A", open: 2, in_progress: 3, submitted: 1, reopened: 0 },
    { username: "second", display_name: "Second tie", pseudonym: "Reader B", open: 5, in_progress: 0, submitted: 0, reopened: 0 },
  ],
  documents: [
    { document_id: "z-special +/#ß", language: "de", position: 23, assignees: [
      { assignment_id: 1, username: "first", pseudonym: "Reader A", task: "annotate", status: "submitted" },
      { assignment_id: 2, username: "second", pseudonym: "Reader B", task: "review", status: "open" },
    ] },
    { document_id: "a-unassigned", language: "en", position: null, assignees: [] },
  ],
};
beforeEach(() => { vi.spyOn(api, "getProgress").mockResolvedValue(progress); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("renders server totals, stable people workload order and document order without mutating input", async () => {
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  const totals = await screen.findByRole("region", { name: "Project totals" });
  for (const [label, value] of [["Documents", 9], ["Unassigned", 3], ["Open", 12], ["In progress", 4], ["Submitted", 8], ["Reopened", 2]] as const) {
    expect(within(totals).getByText(label).parentElement?.textContent).toContain(String(value));
  }
  const people = within(screen.getByRole("table", { name: "People" })).getAllByRole("row").slice(1);
  expect(people.map(row => row.textContent)).toEqual([expect.stringContaining("First tie"), expect.stringContaining("Second tie"), expect.stringContaining("Low")]);
  expect(progress.people[0].username).toBe("low");
  const docs = within(screen.getByRole("table", { name: "Progress documents" })).getAllByRole("row").slice(1);
  expect(docs.map(row => row.textContent)).toEqual([expect.stringContaining("z-special"), expect.stringContaining("a-unassigned")]);
  const assignees = Array.from(screen.getByRole("table", { name: "Progress documents" }).querySelectorAll(".assignee")).map(item => item.textContent);
  expect(assignees).toEqual(["First tie (Reader A)AnnotationSubmitted", "Second tie (Reader B)ReviewOpen"]);
  expect(screen.queryByText("Agreement between annotators is not shown here yet.")).toBeNull();
});
it("filters by any assignment status and treats unassigned as no assignees", async () => {
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />); await screen.findByText("a-unassigned");
  fireEvent.change(screen.getByLabelText("Document status"), { target: { value: "open" } });
  expect(screen.getByText("z-special +/#ß")).toBeTruthy(); expect(screen.queryByText("a-unassigned")).toBeNull();
  fireEvent.change(screen.getByLabelText("Document status"), { target: { value: "submitted" } });
  expect(screen.getByText("z-special +/#ß")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Document status"), { target: { value: "unassigned" } });
  expect(screen.getByText("a-unassigned")).toBeTruthy(); expect(screen.queryByText("z-special +/#ß")).toBeNull();
});
it("uses the real encoded documents route and exact ID for Assign", async () => {
  const navigate = vi.fn(); render(<ProgressPage projectKey="p/a" onNavigate={navigate} />); await screen.findByText("a-unassigned");
  const link = screen.getAllByRole("link", { name: "Assign" })[0];
  expect(link.getAttribute("href")).toBe("#/projects/p%2Fa/documents?select=z-special+%2B%2F%23%C3%9F");
  fireEvent.click(link); expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p/a", select: "z-special +/#ß" });
});
it("shows no access on current server refusal and ignores an earlier project reply", async () => {
  let resolve!: (value: ProjectProgress) => void;
  vi.mocked(api.getProgress).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockRejectedValueOnce(new AuthError("Forbidden", undefined, "NOT_ALLOWED"));
  const { rerender } = render(<ProgressPage projectKey="old" onNavigate={vi.fn()} />);
  rerender(<ProgressPage projectKey="new" onNavigate={vi.fn()} />);
  await screen.findByText("You do not have access to this page.");
  await act(async () => { resolve(progress); }); expect(screen.queryByText("a-unassigned")).toBeNull();
});

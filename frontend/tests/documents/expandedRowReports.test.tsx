import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentRowView } from "../../src/api/client";
import { routeHref, type ProjectDocumentsQuery } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { ExpandedRow } from "../../src/documents/ExpandedRow";
import type { RowSubmissionsState } from "../../src/documents/useRowSubmissions";
import { row, version } from "./fixtures";

afterEach(cleanup);

const now = new Date("2026-10-19T12:00:00Z");
const query: ProjectDocumentsQuery = { decision: "all", open: ["c:de"] };
type RowReport = NonNullable<DocumentRowView["problem_reports"]>[number];

function report(overrides: Partial<RowReport> & Pick<RowReport, "report_id">): RowReport {
  return { title: "Text is cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 1, ...overrides };
}

function renderRow(problemReports?: RowReport[]) {
  const onNavigate = vi.fn();
  const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })], ...(problemReports ? { problem_reports: problemReports } : {}) });
  const submissions: RowSubmissionsState = { data: null, error: null, loading: false, reload: vi.fn(), retry: vi.fn() };
  render(<ExpandedRow row={target} projectKey="p" query={query} submissions={submissions} onNavigate={onNavigate} now={now} />);
  return { onNavigate };
}

it("lists every problem report of the row, open and closed, in the More section", () => {
  const { onNavigate } = renderRow([
    report({ report_id: "r-2", title: "Wrong language…", created_at: "2026-10-19T10:00:00Z", state: "withdrawn", active_hold_count: 0 }),
    report({ report_id: "r-1", state: "resolved", active_hold_count: 1 }),
  ]);
  const summary = screen.getByText("Problem reports (2)");
  expect(summary.tagName).toBe("SUMMARY");
  const details = summary.closest("details")!;
  const items = within(details).getAllByRole("listitem");
  expect(items.map(item => item.textContent)).toEqual([
    `Wrong language… · ann-0004 · ${formatTime("2026-10-19T10:00:00Z", { now })} · Report: Withdrawn · Paused tasks: 0 · Open report`,
    `Text is cut off · ann-0004 · ${formatTime("2026-10-19T08:00:00Z", { now })} · Report: Closed · Paused tasks: 1 · Open report`,
  ]);
  const link = within(items[0]).getByRole("link", { name: "Open report" });
  const route = { name: "projectProblemReport", key: "p", reportId: "r-2", documents: query } as const;
  expect(link.getAttribute("href")).toBe(routeHref(route));
  fireEvent.click(link);
  expect(onNavigate).toHaveBeenCalledWith(route);
});

it("shows an open report as Open", () => {
  renderRow([report({ report_id: "r-3" })]);
  const details = screen.getByText("Problem reports (1)").closest("details")!;
  expect(within(details).getByRole("listitem").textContent).toContain("Report: Open · Paused tasks: 1");
});

it("hides the item when the row has no report", () => {
  renderRow([]);
  expect(screen.queryByText(/Problem reports/)).toBeNull();
  cleanup();
  renderRow();
  expect(screen.queryByText(/Problem reports/)).toBeNull();
});

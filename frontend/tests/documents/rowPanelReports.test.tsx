/** Problem reports in the row panel: the open-report banner and the Details list of every report. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DocumentRowView } from "../../src/api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { RowPanel } from "../../src/documents/RowPanel";
import { row, submissions, version } from "./fixtures";

beforeEach(() => { vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-10-19T12:00:00Z");
const query: ProjectDocumentsQuery = { decision: "all", panel: "c:de" };
type RowReport = NonNullable<DocumentRowView["problem_reports"]>[number];
const reportRoute = (reportId: string): Route => ({ name: "projectProblemReport", key: "p", reportId, documents: query });

function report(overrides: Partial<RowReport> & Pick<RowReport, "report_id">): RowReport {
  return { title: "Text is cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 1, ...overrides };
}

function renderRow(problemReports?: RowReport[]) {
  const onRoute = vi.fn();
  const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })], ...(problemReports ? { problem_reports: problemReports } : {}) });
  render(<RowPanel projectKey="p" rowKey="c:de" row={target} rows={[target]} tab="details" query={query} now={now}
    onNavigate={vi.fn()} onRoute={onRoute} onClose={vi.fn()} reportRoute={reportRoute} />);
  return { onRoute };
}

const panel = () => screen.getByRole("complementary", { name: "Details, c · de" });

it("lists every problem report of the row, open and closed, under Details", async () => {
  const { onRoute } = renderRow([
    report({ report_id: "r-2", title: "Wrong language…", created_at: "2026-10-19T10:00:00Z", state: "withdrawn", active_hold_count: 0 }),
    report({ report_id: "r-1", state: "resolved", active_hold_count: 1 }),
  ]);
  const section = (await within(panel()).findByRole("heading", { name: "Problem reports (2)" })).closest("section")!;
  const items = within(section).getAllByRole("listitem");
  expect(items.map(item => item.textContent)).toEqual([
    `Wrong language… · ann-0004 · ${formatTime("2026-10-19T10:00:00Z", { now })} · Report: Withdrawn · Paused tasks: 0 · Open report`,
    `Text is cut off · ann-0004 · ${formatTime("2026-10-19T08:00:00Z", { now })} · Report: Closed · Paused tasks: 1 · Open report`,
  ]);
  const link = within(items[0]).getByRole("link", { name: "Open report" });
  expect(link.getAttribute("href")).toBe(routeHref(reportRoute("r-2")));
  fireEvent.click(link);
  expect(onRoute).toHaveBeenCalledWith(reportRoute("r-2"));
  // No open report: no banner.
  expect(panel().querySelector(".row-panel-banner")).toBeNull();
});

it("banners open reports above the tabs (1 open problem report · Open) and lists them as Open", async () => {
  const { onRoute } = renderRow([report({ report_id: "r-3" }), report({ report_id: "r-4", title: "Second" })]);
  const banner = panel().querySelector<HTMLElement>(".row-panel-banner")!;
  expect(banner.textContent).toBe("2 open problem reports · Open");
  expect(banner.compareDocumentPosition(within(panel()).getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(banner).getByRole("link", { name: "Open problem report, Text is cut off" }));
  expect(onRoute).toHaveBeenCalledWith(reportRoute("r-3"));
  const section = (await within(panel()).findByRole("heading", { name: "Problem reports (2)" })).closest("section")!;
  expect(within(section).getAllByRole("listitem")[0].textContent).toContain("Report: Open · Paused tasks: 1");
});

it("shows no reports section when the row has none", async () => {
  renderRow([]);
  await within(panel()).findByRole("heading", { name: "Technical details" });
  expect(screen.queryByText(/Problem reports/)).toBeNull();
  cleanup();
  renderRow();
  await within(panel()).findByRole("heading", { name: "Technical details" });
  expect(screen.queryByText(/Problem reports/)).toBeNull();
});

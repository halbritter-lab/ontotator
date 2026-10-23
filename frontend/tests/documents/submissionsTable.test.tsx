import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RowSubmissionView } from "../../src/api/client";
import { routeHref, type Route } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { SubmissionsTable, type SubmissionsTableProps } from "../../src/documents/SubmissionsTable";
import { refKey } from "../../src/variants/versionState";
import { final, round, scenarioS0, scenarioS5, submission } from "./fixtures";

afterEach(cleanup);

const now = new Date("2026-10-19T12:00:00Z");
const time = (iso: string) => formatTime(iso, { now });

const leadView = (row: RowSubmissionView): Route => ({ name: "projectCase", key: "p", caseId: "c", variant: row.document_id, annotations: refKey({ kind: "submission", id: row.submission_id }) });

function renderTable(props: Partial<SubmissionsTableProps> & Pick<SubmissionsTableProps, "rows">) {
  return render(<SubmissionsTable rounds={[]} parallel={false} showFinalColumn language="de" viewRoute={leadView} now={now} {...props} />);
}

const headers = () => screen.getAllByRole("columnheader").map(cell => cell.textContent);
const bodyRows = () => screen.getAllByRole("row").slice(1);

it("renders the columns in order and hides Version when all submissions share one", () => {
  renderTable({ rows: [submission({ submission_id: "a", document_id: "d1" }), submission({ submission_id: "b", document_id: "d1" })], actions: () => null });
  expect(headers()).toEqual(["Final", "Round", "Kind", "By", "Submitted", "Findings", "Actions"]);
  cleanup();
  renderTable({ rows: [submission({ submission_id: "a", document_id: "d1" }), submission({ submission_id: "b", document_id: "d2", version: 2 })], actions: () => null });
  expect(headers()).toEqual(["Final", "Round", "Kind", "Version", "By", "Submitted", "Findings", "Actions"]);
  expect(within(bodyRows()[1]).getByText("v2")).toBeTruthy();
});

it("sorts oldest first and marks the Final row without selection semantics", () => {
  const { group, submissions } = scenarioS0();
  const de = group.rows[1];
  const data = submissions["synthetic-accepted:de"];
  renderTable({ rows: [...data.submissions].reverse(), rounds: data.rounds, final: de.final });
  const [first, second] = bodyRows();
  expect(first.className).toContain("final-row");
  expect(first.getAttribute("aria-selected")).toBeNull();
  expect(first.className).not.toContain("is-selected");
  const badge = within(first).getByText("Final").closest(".status-pill")!;
  expect(badge.className).toContain("status-pill--success");
  expect(badge.querySelector("svg")).not.toBeNull();
  expect(second.className).not.toContain("final-row");
  expect(within(second).queryByText("Final")).toBeNull();
});

it("names the View link with the full submission label and adds round suffixes", () => {
  const { submissions } = scenarioS0();
  const data = submissions["synthetic-accepted:de"];
  renderTable({ rows: data.submissions, rounds: data.rounds });
  const link = screen.getByRole("link", { name: `View Annotation, from scratch · Round 1 · ann-0004 · de v1 · ${time("2026-10-18T10:00:00Z")}` });
  expect(link.textContent).toBe("Round 1 · superseded");
  expect(link.getAttribute("href")).toBe(routeHref(leadView(data.submissions[0])));
  expect(screen.getByRole("link", { name: /^View Annotation, from scratch · Initial submission · ann-0003/ }).textContent).toBe("Initial submission");
});

it("marks latest and earlier submissions of a round with several submissions", () => {
  const rows = [
    submission({ submission_id: "r1-a", document_id: "d", round_id: "r1", round_ordinal: 2, is_latest_in_round: false, recorded_at: "2026-10-18T09:00:00Z" }),
    submission({ submission_id: "r1-b", document_id: "d", round_id: "r1", round_ordinal: 2, is_latest_in_round: true, recorded_at: "2026-10-18T11:00:00Z" }),
  ];
  renderTable({ rows });
  expect(screen.getAllByRole("link").map(link => link.textContent)).toEqual(["Round 2 · earlier submission", "Round 2 · latest"]);
});

it("collapses more than 10 rows to the newest 10 and keeps the Final row", () => {
  const rows = Array.from({ length: 12 }, (_, index) => submission({
    submission_id: `s${index}`, document_id: "d", recorded_at: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`, author_label: `ann-${index}`,
  }));
  renderTable({ rows, final: final({ case_id: "c", language: "de", document_id: "d", submission_id: "s0" }) });
  expect(bodyRows()).toHaveLength(11);
  expect(within(bodyRows()[0]).getByText("Final")).toBeTruthy();
  expect(screen.queryByText("ann-1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all (12)" }));
  expect(bodyRows()).toHaveLength(12);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
});

it("lists unsubmitted rounds as muted last lines without counting them", () => {
  const { submissions } = scenarioS0();
  const data = submissions["synthetic-accepted:de"];
  const { container } = renderTable({ rows: data.submissions, rounds: data.rounds });
  const pending = container.querySelector(".submissions-pending")!;
  expect(pending.textContent).toBe("Round 3 · ann-0004 · in progress, not submitted yet");
  expect(bodyRows()).toHaveLength(2);
});

it("shows consolidation rows without a round number", () => {
  const { submissions } = scenarioS5();
  const data = submissions["case-0377:en"];
  renderTable({ rows: data.submissions, rounds: data.rounds, language: "en" });
  expect(screen.getByRole("link", { name: /^View Consolidation · lead-0002 \(you\) · en v1 · / }).textContent).toBe("Consolidation");
});

it("works read-only with a caller-supplied viewRoute and no Actions column", () => {
  const rows = [submission({ submission_id: "own-1", document_id: "d" }), submission({ submission_id: "other", document_id: "d", author_label: "ann-0002", recorded_at: "2026-10-18T11:00:00Z" })];
  const ownView = (row: RowSubmissionView): Route | null => row.submission_id === "own-1"
    ? { name: "projectCase", key: "p", caseId: "c", variant: row.document_id, annotations: refKey({ kind: "own", id: row.submission_id }) }
    : null;
  const onNavigate = vi.fn();
  renderTable({ rows, showFinalColumn: false, viewRoute: ownView, onNavigate });
  expect(headers()).toEqual(["Round", "Kind", "By", "Submitted", "Findings"]);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(decodeURIComponent(links[0].getAttribute("href")!)).toContain(JSON.stringify(["own", "own-1"]));
  fireEvent.click(links[0]);
  expect(onNavigate).toHaveBeenCalledWith(ownView(rows[0]));
  expect(within(bodyRows()[1]).getByText("Initial submission").tagName).not.toBe("A");
});

it("passes the label id to actions and renders confirmations as a full-width row", () => {
  const rows = [submission({ submission_id: "a", document_id: "d" })];
  renderTable({
    rows,
    actions: (_row, context) => <button type="button" aria-describedby={context.labelId}>Act</button>,
    renderConfirm: row => <p>Confirm {row.submission_id}</p>,
  });
  const button = screen.getByRole("button", { name: "Act" });
  const description = document.getElementById(button.getAttribute("aria-describedby")!)!;
  expect(description.textContent).toBe(`Annotation, from scratch · Initial submission · ann-0001 · de v1 · ${time("2026-10-18T10:00:00Z")}`);
  const confirmRow = screen.getByText("Confirm a").closest("tr")!;
  expect(confirmRow.className).toBe("data-table-expanded");
  expect(confirmRow.querySelector("td")!.getAttribute("colspan")).toBe("7");
});

it("adds seconds only when two labels share a minute", () => {
  renderTable({ rows: [
    submission({ submission_id: "a", document_id: "d", recorded_at: "2026-10-18T10:00:05Z" }),
    submission({ submission_id: "b", document_id: "d", recorded_at: "2026-10-18T10:00:40Z" }),
    submission({ submission_id: "c", document_id: "d", recorded_at: "2026-10-18T11:00:00Z" }),
  ], rounds: [round({ round_id: "x", assignment_id: 1, document_id: "d", submitted: true })] });
  const times = screen.getAllByRole("row").slice(1).map(row => row.querySelector("time")!.textContent);
  expect(times).toEqual([
    formatTime("2026-10-18T10:00:05Z", { now, seconds: true }),
    formatTime("2026-10-18T10:00:40Z", { now, seconds: true }),
    time("2026-10-18T11:00:00Z"),
  ]);
});

it("shows the author as display name and pseudonym for leads", () => {
  renderTable({
    rows: [
      submission({ submission_id: "a", document_id: "d1", author_label: "ann-0004", author: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }),
      submission({ submission_id: "b", document_id: "d1", author_label: "ann-0005", recorded_at: "2026-10-18T11:00:00Z" }),
    ],
    rounds: [round({ round_id: "r9", assignment_id: 9, document_id: "d1", round_ordinal: 3, author_label: "ann-0006", state: "open", submitted: false,
      author: { pseudonym: "ann-0006", display_name: "Ben Ito", is_me: false } })],
    final: null,
  });
  const [first, second] = bodyRows();
  expect(within(first).getByRole("cell", { name: "Ana Weber (ann-0004)" })).toBeTruthy();
  expect(within(second).getByRole("cell", { name: "ann-0005" })).toBeTruthy();
  expect(screen.getByText("Round 3 · Ben Ito (ann-0006) · in progress, not submitted yet")).toBeTruthy();
  expect(first.querySelector("[hidden]")!.textContent).toContain("Ana Weber (ann-0004)");
});

it("shows Guidelines v2 (current: v3)", () => {
  renderTable({ guidelineCurrent: 3, rows: [
    submission({ submission_id: "a", document_id: "d1", guideline_version: 2 }),
    submission({ submission_id: "b", document_id: "d1", guideline_version: 3, recorded_at: "2026-10-19T11:00:00Z" }),
    submission({ submission_id: "c", document_id: "d1", guideline_version: 1, guideline_withdrawn: true, recorded_at: "2026-10-19T11:30:00Z" }),
  ] });
  expect(headers()).toEqual(["Final", "Round", "Kind", "By", "Submitted", "Findings"]);
  const rows = bodyRows();
  expect(within(rows[0]).getByText("Guidelines v2 (current: v3)")).toBeTruthy();
  expect(within(rows[1]).getByText("Guidelines v3")).toBeTruthy();
  expect(within(rows[2]).getByText("Guidelines v1 (withdrawn)")).toBeTruthy();
  cleanup();
  renderTable({ layout: "list", guidelineCurrent: 3, rows: [submission({ submission_id: "a", document_id: "d1", guideline_version: 2 })] });
  expect(screen.getByText("Guidelines v2 (current: v3)")).toBeTruthy();
});

it("shows Guidelines: not recorded", () => {
  renderTable({ rows: [submission({ submission_id: "a", document_id: "d1" })] });
  expect(within(bodyRows()[0]).getByText("Guidelines: not recorded")).toBeTruthy();
  cleanup();
  // Without the current version (not loaded or not passed) the label names the stamp alone.
  renderTable({ rows: [submission({ submission_id: "a", document_id: "d1", guideline_version: 2 })] });
  expect(within(bodyRows()[0]).getByText("Guidelines v2")).toBeTruthy();
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentRowView, RowSubmissions } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { ExpandedRow, type ExpandedRowProps } from "../../src/documents/ExpandedRow";
import { TextVersions, type TextVersionsTools } from "../../src/documents/TextVersions";
import type { RowSubmissionsState } from "../../src/documents/useRowSubmissions";
import {
  final, item, notInPlanRow, planRow, recordedVersion, round, row, rowKey, scenarioS4, stepOf, submission, submissions, version, work, type DocumentsScenario,
} from "./fixtures";

afterEach(cleanup);

const now = new Date("2026-10-19T12:00:00Z");
const time = (iso: string) => formatTime(iso, { now });
const query: ProjectDocumentsQuery = { decision: "all", open: ["synthetic-accepted:de"] };

function state(data: RowSubmissions | null, overrides: Partial<RowSubmissionsState> = {}): RowSubmissionsState {
  return { data, error: null, loading: false, reload: vi.fn(), retry: vi.fn(), ...overrides };
}

function renderRow(target: DocumentRowView, data: RowSubmissions | null, props: Partial<ExpandedRowProps> = {}) {
  const onNavigate = vi.fn();
  const utils = render(<ExpandedRow row={target} projectKey="p" query={query} submissions={state(data)} onNavigate={onNavigate} now={now} {...props} />);
  return { ...utils, onNavigate };
}

function scenarioRow(scenario: DocumentsScenario, language: string) {
  const target = scenario.group.rows.find(entry => entry.language === language)!;
  return { target, data: scenario.submissions[rowKey(target.case_id, language)] };
}

/** A de row with a single DeepL chain (v1 MT accepted, optional corrections) and a final on v1. */
function chainRow(overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const v1 = version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
  const v2 = version({ document_id: "c-de-v2", external_id: "c-de", chain_id: "c-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "c-de", translation_status: "accepted" });
  return row({
    case_id: "c", language: "de", versions: [v1, v2],
    final: final({ case_id: "c", language: "de", document_id: "c-de", submission_id: "s1", author_label: "ann-0004", round_ordinal: 1, chain_name: "DeepL", selected_at: "2026-10-18T10:05:00Z" }),
    ...overrides,
  });
}

const chainData = (overrides: Partial<RowSubmissions> = {}) => submissions("c", "de", {
  submissions: [
    submission({ submission_id: "s1", document_id: "c-de", author_label: "ann-0004", round_id: "r1", round_ordinal: 1, round_state: "superseded", is_latest_in_round: false, recorded_at: "2026-10-18T10:00:00Z" }),
    submission({ submission_id: "s1b", document_id: "c-de", author_label: "ann-0004", round_id: "r1", round_ordinal: 1, round_state: "superseded", is_latest_in_round: true, recorded_at: "2026-10-18T11:00:00Z" }),
    submission({ submission_id: "s2", document_id: "c-de", author_label: "ann-0004", round_id: "r2", round_ordinal: 2, is_latest_in_round: true, recorded_at: "2026-10-18T12:00:00Z" }),
  ],
  rounds: [
    round({ round_id: "r1", assignment_id: 1, document_id: "c-de", author_label: "ann-0004", round_ordinal: 1, state: "superseded" }),
    round({ round_id: "r2", assignment_id: 1, predecessor_round_id: "r1", document_id: "c-de", author_label: "ann-0004", round_ordinal: 2 }),
  ],
  ...overrides,
});

// ---- Slim expansion (documents overview, O4c) ----

const ana = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };

/** case-107 · de: Ana accepted v1, Tom submitted, a moved assignment, one report. */
function historyRow(overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const v1 = version({ document_id: "case-107-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted_corrected", is_newest_in_chain: false });
  const v2 = version({ document_id: "case-107-de-v2", chain_id: "case-107-de", version: 2, origin: "correction", derived_from: "case-107-de", translation_status: "accepted" });
  return row({
    case_id: "case-107", language: "de", versions: [v1, v2],
    work: [
      work({ assignment_id: 1, document_id: "case-107-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana }),
      work({ assignment_id: 2, document_id: "case-107-de-v2", status: "submitted", author_label: "ann-0004" }),
    ],
    moved_work: [work({ assignment_id: 3, document_id: "case-107-de", status: "in_progress", author_label: "ann-0005", moved_to_version: 2 })],
    problem_reports: [{ report_id: "r-1", title: "Cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 0 }],
    ...overrides,
  });
}
const historyData = () => submissions("case-107", "de", {
  submissions: [
    submission({ submission_id: "s-a", document_id: "case-107-de-v2", version: 2, author_label: "ann-0004", recorded_at: "2026-10-19T09:00:00Z" }),
    submission({ submission_id: "s-b", document_id: "case-107-de-v2", version: 2, author_label: "ann-0006", recorded_at: "2026-10-19T10:00:00Z" }),
  ],
});

it("is one region 'History, case-107 · de'", () => {
  renderRow(historyRow(), historyData(), { id: "region-1" });
  const regions = screen.getAllByRole("region");
  expect(regions).toHaveLength(1);
  expect(regions[0].getAttribute("aria-label")).toBe("History, case-107 · de");
  expect(regions[0].id).toBe("region-1");
});

it("shows History, Plan chips, Text versions (n), Assign annotation review…, Start consolidation…, Problem reports (n), Technical details", () => {
  const onAssign = vi.fn();
  const target = historyRow();
  const { container } = renderRow(target, historyData(), { onAssign, plan: <button type="button">Review</button>, planRevision: 4 });
  const region = screen.getByRole("region", { name: "History, case-107 · de" });
  const history = within(region).getByRole("list", { name: "History" });
  expect(within(history).getAllByRole("listitem").map(line => line.textContent)).toEqual([
    "Review: Ana Weber (ann-0003) · Accepted with corrections · v1 → v2",
    `Annotation: ann-0004 · Initial submission · 3 findings · v2 · ${time("2026-10-19T09:00:00Z").split(", ")[1]}`,
    `Annotation: ann-0006 · Initial submission · 3 findings · v2 · ${time("2026-10-19T10:00:00Z").split(", ")[1]}`,
    "Annotation: ann-0005 · moved to v2",
  ]);
  const plan = within(region).getByRole("group", { name: "Plan" });
  expect(within(plan).getByRole("button", { name: "Review" })).toBeTruthy();
  const summaries = [...container.querySelectorAll("details > summary")].map(summary => summary.textContent);
  expect(summaries).toEqual(["Text versions (2)", "Start consolidation…", "Problem reports (1)", "Technical details"]);
  fireEvent.click(within(region).getByRole("button", { name: "Assign annotation review…" }));
  expect(onAssign).toHaveBeenCalledWith(target, "review");
  const technical = screen.getByText("Technical details").closest("details")!;
  expect(within(technical).getByText("Plan revision").nextElementSibling!.textContent).toBe("4");
  for (const value of ["case-107-de", "case-107-de-v2", "s-a", "s-b"]) expect(technical.textContent).toContain(value);
  // Consolidation finds the two submissions on v2.
  expect(within(screen.getByText("Start consolidation…").closest("details")!).getByRole("button", { name: "Consolidate results" })).toBeTruthy();
});

it("has no stage blocks, issues list or submissions table", () => {
  const target = historyRow({
    issues: [item({ code: "TRANSLATION_NOT_ACCEPTED", cause_id: "TRANSLATION_NOT_ACCEPTED:x", category: "translation", document_id: "case-107-de-v2", version: 2, review_decision: "rejected" })],
    final: final({ case_id: "case-107", language: "de", document_id: "case-107-de-v2", submission_id: "s-a" }),
  });
  const { container } = renderRow(target, historyData(), { onAssign: vi.fn() });
  expect(container.querySelector(".stage-blocks, .stage-block")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Issues" })).toBeNull();
  expect(screen.queryByRole("heading", { name: /^Submissions/ })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("button", { name: /Use as final|Replace…|Keep final result/ })).toBeNull();
  expect(screen.getByRole("list", { name: "History" }).textContent).toContain("Final: chosen by lead-0002");
});

it("Text versions shows a revoked work item with moved_to_version as moved to v2", () => {
  renderRow(historyRow(), historyData());
  const versions = screen.getByText("Text versions (2)", { selector: "summary" }).closest("details")!;
  const onV1 = within(versions).getByRole("list", { name: "Assignments on v1" });
  expect(within(onV1).getByText("ann-0005 · Annotation · moved to v2")).toBeTruthy();
  expect(within(onV1).queryByText(/In progress/)).toBeNull();
});

it("says No history yet. and links a paused task's report", () => {
  const { onNavigate } = renderRow(row({ case_id: "c", language: "de" }), submissions("c", "de"));
  expect(screen.getByText("No history yet.")).toBeTruthy();
  cleanup();
  const held = row({ case_id: "c", language: "de", notes: [item({ code: "TASK_ON_HOLD", cause_id: "hold-1", author_label: "ann-0004", report_id: "rep-1" })] });
  const second = renderRow(held, submissions("c", "de"));
  const line = within(screen.getByRole("list", { name: "History" })).getByRole("listitem");
  expect(line.textContent).toBe("Task paused: ann-0004 · Open report");
  fireEvent.click(within(line).getByRole("link", { name: "Open report" }));
  expect(second.onNavigate).toHaveBeenCalledWith({ name: "projectProblemReport", key: "p", reportId: "rep-1", documents: query });
  expect(onNavigate).not.toHaveBeenCalled();
});

it("opens and focuses Text versions on request (interim text-change actions)", async () => {
  const onRevealed = vi.fn();
  renderRow(historyRow(), historyData(), { revealTextVersions: true, onTextVersionsRevealed: onRevealed });
  const details = screen.getByText("Text versions (2)", { selector: "summary" }).closest("details")!;
  expect(details.open).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(details.querySelector("summary")));
  expect(onRevealed).toHaveBeenCalled();
});

it("offers Assign a new review… for lead and override acceptances only", () => {
  const accepted = (source: "lead" | "override" | "package") => planRow("c", "de", stepOf("assign_annotation", { stage: "annotation" }), {
    plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
    versions: [recordedVersion({
      document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", accepted_without_review: source === "override",
      acceptance: { source, reason: source === "package" ? null : "Reviewed by the partner site", accepted_at: "2026-10-20T11:40:00Z", accepted_by: null },
    })],
  });
  for (const source of ["lead", "override"] as const) {
    const onAssign = vi.fn();
    const target = accepted(source);
    renderRow(target, submissions("c", "de"), { onAssign });
    fireEvent.click(screen.getByRole("button", { name: "Assign a new review…" }));
    expect(onAssign).toHaveBeenCalledWith(target, "translation_review", { newReviewOfAccepted: true });
    cleanup();
  }
  renderRow(accepted("package"), submissions("c", "de"), { onAssign: vi.fn() });
  expect(screen.queryByRole("button", { name: "Assign a new review…" })).toBeNull();
});

it("keeps problem reports listed for rows not in plan", () => {
  const target = notInPlanRow("c", "de", {
    problem_reports: [{ report_id: "r-9", title: "Wrong text", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 1 }],
  });
  renderRow(target, submissions("c", "de"));
  const reports = screen.getByText("Problem reports (1)").closest("details")!;
  expect(within(reports).getByRole("listitem").textContent).toContain("Wrong text · ann-0004");
  expect(within(reports).getByRole("link", { name: "Open report" })).toBeTruthy();
});

// ---- Text versions ----

it("lists text versions with origin, status, chain name, work and per-version checkboxes", () => {
  const { target, data } = scenarioRow(scenarioS4(), "fr");
  const onToggleBulk = vi.fn();
  const tools: TextVersionsTools = {
    username: "lead", assignments: [], members: [], variants: new Map(), requiredLanguages: () => null,
    onAssignmentsChanged: vi.fn(), onShowTranslationReviews: vi.fn(), bulkSelected: new Set(["case-0305-fr-b"]), onToggleBulk,
  };
  const { onNavigate } = renderRow(target, data, { textVersionTools: tools });
  const list = screen.getByText("Text versions (2)").closest("details")!.querySelector(".text-versions") as HTMLElement;
  const items = within(list).getAllByRole("listitem").filter(entry => entry.classList.contains("text-version"));
  expect(items[0].querySelector(".text-version-head")!.textContent).toBe("Select Provider A v1 of case-0305 · fr for assignmentProvider A v1Machine translationAcceptedProvider A");
  expect(within(items[0]).getByText("ann-0001 · Annotation · In progress")).toBeTruthy();
  const boxA = within(items[0]).getByRole("checkbox", { name: "Select Provider A v1 of case-0305 · fr for assignment" }) as HTMLInputElement;
  const boxB = within(items[1]).getByRole("checkbox", { name: "Select Provider B v1 of case-0305 · fr for assignment" }) as HTMLInputElement;
  expect([boxA.checked, boxB.checked]).toEqual([false, true]);
  fireEvent.click(boxA);
  expect(onToggleBulk).toHaveBeenCalledWith("case-0305-fr-a");
  fireEvent.click(within(items[0]).getByRole("button", { name: "Translation reviews for Provider A v1" }));
  expect(tools.onShowTranslationReviews).toHaveBeenCalledWith("case-0305-fr-a");
  fireEvent.click(within(items[1]).getByRole("link", { name: "View text Provider B v1 of case-0305 · fr" }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-0305", variant: "case-0305-fr-b", documents: query });
});

it("shows the review decision in a text version badge", () => {
  const v1 = version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
  const v2 = version({ document_id: "c-de-v2", chain_id: "c-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "rejected" });
  renderRow(chainRow({ versions: [v1, v2], final: null }), chainData());
  const list = screen.getByText("Text versions (2)").closest("details")!;
  expect(within(list).getByText("Correction of v1")).toBeTruthy();
  expect(within(list).getByText("Rejected in review").closest(".status-pill")!.className).toContain("status-pill--warning");
});

it("shows a queried version as Queried (stored decision \"query\"), not Reviewed", () => {
  const v1 = version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
  const v2 = version({ document_id: "c-de-v2", chain_id: "c-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "query" });
  renderRow(chainRow({ versions: [v1, v2], final: null }), chainData());
  const list = screen.getByText("Text versions (2)").closest("details")!;
  expect(within(list).queryByText("Reviewed")).toBeNull();
  expect(within(list).getByText("Queried").closest(".status-pill")!.className).toContain("status-pill--warning");
});

it("names the people on text version work with display name and pseudonym", () => {
  const document = version({ document_id: "c-de" });
  const target = row({ case_id: "c", language: "de", versions: [document], work: [
    work({ assignment_id: 1, document_id: "c-de", author_label: "ann-0004", status: "in_progress", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }),
    work({ assignment_id: 2, document_id: "c-de", author_label: "ann-0005", status: "submitted" }),
  ] });
  render(<TextVersions row={target} projectKey="p" query={query} onNavigate={vi.fn()} />);
  const list = screen.getByRole("list", { name: "Assignments on v1" });
  expect(within(list).getByText("Ana Weber (ann-0004) · Annotation · In progress")).toBeTruthy();
  expect(within(list).getByText("ann-0005 · Annotation · Submitted")).toBeTruthy();
});

// ---- Lead workflow (L4) ----

it("labels acceptances and discarded versions in Text versions", () => {
  const lead = recordedVersion({
    document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted",
    acceptance: { source: "lead", reason: "Checked by the clinic", accepted_at: "2026-10-20T11:40:00Z", accepted_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } },
  });
  const pkg = recordedVersion({
    document_id: "c-de-b", chain_id: "c-de-b", chain_name: "Provider B", origin: "machine_translation", translation_status: "accepted",
    acceptance: { source: "package", reviewer: "R. Roe", reviewed_at: "2026-10-01T09:00:00Z" },
  });
  const dropped = recordedVersion({
    document_id: "c-de-c", chain_id: "c-de-c", chain_name: "Provider C", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected",
    discarded: { reason: "Wrong language", discarded_at: "2026-10-19T08:00:00Z", discarded_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } },
  });
  const target = planRow("c", "de", stepOf("assign_annotation", { stage: "annotation" }), { versions: [lead, pkg, dropped], parallel_roots: true });
  renderRow(target, submissions("c", "de"));
  const versions = screen.getByText("Text versions (3)", { selector: "summary" }).closest("details")!;
  const items = [...versions.querySelectorAll(".text-version")] as HTMLElement[];
  expect(within(items[0]).getByText(`Accepted: reviewed outside Ontocurator · Project lead (ann-0002) · ${time("2026-10-20T11:40:00Z")} · Checked by the clinic`)).toBeTruthy();
  expect(within(items[1]).getByText(`Accepted: marked as reviewed in the package · R. Roe, ${time("2026-10-01T09:00:00Z").split(", ")[0]}`)).toBeTruthy();
  expect(within(items[2]).getByText("Discarded").closest(".status-pill")).toBeTruthy();
  expect(within(items[2]).getByText(`Discarded · Project lead (ann-0002) · ${time("2026-10-19T08:00:00Z")} · Wrong language`)).toBeTruthy();
  const technical = screen.getByText("Technical details").closest("details")!;
  expect(technical.textContent).toContain("Accepted: reviewed outside Ontocurator");
  expect(technical.textContent).toContain("Accepted: marked as reviewed in the package");
  expect(technical.textContent).toContain("Discarded · Project lead (ann-0002)");

  // A row whose every version is discarded labels them without per-version records.
  cleanup();
  const all = planRow("c", "fr", null, { plan_row: { review: true, annotate: true, review_applicable: true, discarded: true }, in_plan: false });
  renderRow(all, submissions("c", "fr"));
  const list = screen.getByText("Text versions (1)").closest("details")!;
  expect(within(list).getByText("Discarded").closest(".status-pill")).toBeTruthy();
});


it("quotes a rejecting review's reason under its History line", async () => {
  const { api } = await import("../../src/api/client");
  const { reviewRecord } = await import("../translationFixtures");
  const spy = vi.spyOn(api, "listTranslationReviews").mockResolvedValue([
    reviewRecord({ assignment_id: 8, document_id: "c-de", decision: "rejected", rationale: "Dosage is missing", categories: ["omission"] }),
  ]);
  const target = row({
    case_id: "c", language: "de",
    versions: [version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
    work: [work({ assignment_id: 8, document_id: "c-de", task: "translation_review", status: "submitted", person: { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false } })],
  });
  renderRow(target, submissions("c", "de"));
  const quote = await screen.findByText("“Dosage is missing”");
  expect(quote.closest("li")!.textContent).toMatch(/^Review: Ana Weber/);
  expect(within(quote.closest("li")!).getByText("Categories: Omission")).toBeTruthy();
  spy.mockRestore();
});

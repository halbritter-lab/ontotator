import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, type DocumentRowView, type RowSubmissions } from "../../src/api/client";
import { guidelineListing, guidelineSummary } from "../projectFixtures";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { ExpandedRow, FinalChoice, type ExpandedRowProps, type FinalChoiceProps } from "../../src/documents/ExpandedRow";
import { TextVersions, type TextVersionsTools } from "../../src/documents/TextVersions";
import type { RowSubmissionsState } from "../../src/documents/useRowSubmissions";
import { refKey } from "../../src/variants/versionState";
import {
  final, item, notInPlanRow, planRow, recordedVersion, round, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, stepOf, submission, submissions, translationReview, version, work, type DocumentsScenario,
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

/** The interim final-result choice under the row (Choose final…, Review changes…; O6 replaces it). */
function renderChoice(target: DocumentRowView, data: RowSubmissions | null, props: Partial<FinalChoiceProps> = {}) {
  const onNavigate = vi.fn();
  const utils = render(<FinalChoice row={target} projectKey="p" query={query} submissions={state(data)} onNavigate={onNavigate} now={now} onSelectFinal={vi.fn()} onClose={vi.fn()} {...props} />);
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

const noticeLines = (container: HTMLElement) => [...container.querySelectorAll(".selection-notice-lines > li")].map(line => line.textContent);
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

// ---- Interim final-result choice under the row (moved out of the expansion; O6 replaces it) ----

it("is a region 'Final result · case · language' with Submissions (n) and Close", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const onClose = vi.fn();
  renderChoice(target, data, { onClose });
  const region = screen.getByRole("region", { name: "Final result · case-0042 · en" });
  expect(within(region).getByRole("heading", { name: "Submissions (2)" }).getAttribute("tabindex")).toBe("-1");
  fireEvent.click(within(region).getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
});

it("renders exactly the three lines of the S0 example", () => {
  const { target, data } = scenarioRow(scenarioS0(), "de");
  const onKeep = vi.fn();
  const { container } = renderChoice(target, data, { onKeep });
  expect(screen.queryByRole("heading", { name: "Issues" })).toBeNull();
  const notice = container.querySelector(".selection-notice")!;
  expect(noticeLines(container)).toEqual([
    "v2 (Ready for review) corrects the text of the final result.",
    "Waiting: Round 3 (ann-0004) is in progress. You can choose again once it is submitted.",
  ]);
  const keep = within(notice as HTMLElement).getByRole("button", { name: "Keep final result…" });
  expect(within(notice as HTMLElement).getAllByRole("button")).toHaveLength(1);
  fireEvent.click(keep);
  expect(onKeep).toHaveBeenCalledWith({ causeIds: ["SELECTED_TEXT_CORRECTED:synthetic-accepted-de:synthetic-accepted-de-v2"], triggerId: keep.id });
});

it("words every acknowledgeable cause as in the spec", () => {
  const target = chainRow({
    issues: [
      item({ code: "SELECTED_ROUND_ABANDONED", cause_id: "SELECTED_ROUND_ABANDONED:r1", category: "confirm-final" }),
      item({ code: "SELECTED_ROUND_SUPERSEDED", cause_id: "SELECTED_ROUND_SUPERSEDED:r1", category: "confirm-final" }),
      item({ code: "SELECTED_RESULT_REVISED", cause_id: "SELECTED_RESULT_REVISED:s1b", category: "confirm-final" }),
      item({ code: "SELECTED_NEWER_RESULT", cause_id: "SELECTED_NEWER_RESULT:s2", category: "confirm-final", document_id: "c-de" }),
      item({ code: "SELECTED_TEXT_CORRECTED", cause_id: "SELECTED_TEXT_CORRECTED:c-de:c-de-v2:accepted", category: "confirm-final", document_id: "c-de-v2", version: 2 }),
    ],
  });
  const onKeep = vi.fn();
  const { container } = renderChoice(target, chainData(), { onKeep });
  expect(noticeLines(container)).toEqual([
    "Round 1 (ann-0004) is abandoned.",
    "Round 1 (ann-0004) has been superseded by Round 2.",
    `Round 1 (ann-0004) has a newer submission (${time("2026-10-18T11:00:00Z")}).`,
    `Round 2 · ann-0004 · v1 was submitted after the final result was chosen (${time("2026-10-18T10:05:00Z")}).`,
    "v2 (Accepted) corrects the text of the final result.Keep v1, or choose a result on v2 once one exists (assign work in Text versions).",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Keep final result…" }));
  expect(onKeep.mock.calls[0][0].causeIds).toHaveLength(5);
});

it("adds non-actionable and waiting lines without a Keep action", () => {
  const v1 = version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
  const v2 = version({ document_id: "c-de-v2", chain_id: "c-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false });
  const v3 = version({ document_id: "c-de-v3", chain_id: "c-de", chain_name: "DeepL", version: 3, origin: "correction", derived_from: "c-de-v2", translation_status: "ready_for_review" });
  const target = chainRow({ versions: [v1, v2, v3] });
  const data = chainData({ open_translation_reviews: [translationReview({ assignment_id: 9, document_id: "c-de-v3", version: 3, reviewer_label: "ann-0009" })] });
  const { container } = renderChoice(target, data, { onKeep: vi.fn() });
  expect(noticeLines(container)).toEqual([
    "v2 was queried in review. No action needed.",
    "Waiting: translation review of v3 by ann-0009 is open. You can choose again once it is submitted.",
  ]);
  expect(screen.queryByRole("button", { name: "Keep final result…" })).toBeNull();
});

it("renders the S3 waiting line for the open translation review", () => {
  const { target, data } = scenarioRow(scenarioS3(), "de");
  const { container } = renderChoice(target, data, { onKeep: vi.fn() });
  expect(noticeLines(container)).toContain("Waiting: translation review of v3 by rev-0007 is open. You can choose again once it is submitted.");
});

it("offers Use as final without a final result and Compare… with a preselected second submission", () => {
  const target = chainRow({ final: null });
  const onSelectFinal = vi.fn();
  const data = chainData({ submissions: chainData().submissions.slice(0, 2) });
  const { onNavigate } = renderChoice(target, data, { onSelectFinal });
  const use = screen.getAllByRole("button", { name: "Use as final…" });
  expect(use).toHaveLength(2);
  expect(document.getElementById(use[0].getAttribute("aria-describedby")!)!.textContent).toMatch(/^Annotation · Round 1 · ann-0004 · de v1 · /);
  fireEvent.click(use[0]);
  expect(onSelectFinal).toHaveBeenCalledWith({ kind: "use", submission: data.submissions[0], triggerId: use[0].id });
  fireEvent.click(screen.getAllByRole("button", { name: "Compare…" })[0]);
  const chooser = screen.getByLabelText("Compare with") as HTMLSelectElement;
  expect(chooser.value).toBe("s1b");
  fireEvent.click(screen.getByRole("link", { name: "Open comparison" }));
  expect(onNavigate).toHaveBeenCalledWith({
    name: "projectCase", key: "p", caseId: "c", variant: "c-de",
    annotations: refKey({ kind: "submission", id: "s1" }), compare: refKey({ kind: "submission", id: "s1b" }), documents: query,
  });
});

it("offers Replace and Compare on non-final rows and nothing on the final row", () => {
  const target = chainRow();
  const base = chainData();
  const data = { ...base, submissions: [...base.submissions, submission({ submission_id: "s3", document_id: "c-de-v2", version: 2, author_label: "ann-0005", recorded_at: "2026-10-18T13:00:00Z" })] };
  const onSelectFinal = vi.fn();
  const { onNavigate } = renderChoice(target, data, { onSelectFinal });
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).queryByRole("button")).toBeNull();
  expect(within(rows[0]).queryByRole("link", { name: "Compare" })).toBeNull();
  expect(within(rows[1]).getByRole("button", { name: "Replace…" })).toBeTruthy();
  fireEvent.click(within(rows[1]).getByRole("link", { name: "Compare" }));
  expect(onNavigate).toHaveBeenCalledWith({
    name: "projectCase", key: "p", caseId: "c", variant: "c-de",
    annotations: refKey({ kind: "submission", id: "s1" }), compare: refKey({ kind: "submission", id: "s1b" }), documents: query,
  });
  expect(within(rows[3]).getByText("Different text versions; open each with View.")).toBeTruthy();
  fireEvent.click(within(rows[3]).getByRole("button", { name: "Replace…" }));
  expect(onSelectFinal).toHaveBeenCalledWith(expect.objectContaining({ kind: "replace", submission: data.submissions[3] }));
});

it("links View to the case viewer with a submission ref and the Documents query", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const { onNavigate } = renderChoice(target, data);
  fireEvent.click(screen.getByRole("link", { name: /^View Annotation · Initial submission · ann-0002 · en v1/ }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-0042", variant: "case-0042-en", annotations: refKey({ kind: "submission", id: "sub-0042-b" }), documents: query });
});

it("keeps actions unavailable while submissions load and offers Retry after an error", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const onSelectFinal = vi.fn();
  render(<FinalChoice onClose={vi.fn()} row={{ ...target, final: null }} projectKey="p" query={{}} submissions={state(data, { loading: true })} onNavigate={vi.fn()} onSelectFinal={onSelectFinal} />);
  expect(screen.getByText("Loading submissions…")).toBeTruthy();
  const use = screen.getAllByRole("button", { name: "Use as final…" })[0];
  expect(use.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(use);
  expect(onSelectFinal).not.toHaveBeenCalled();
  cleanup();
  const retry = vi.fn();
  render(<FinalChoice onClose={vi.fn()} row={target} projectKey="p" query={{}} submissions={state(null, { error: new Error("boom"), retry })} onNavigate={vi.fn()} />);
  expect(screen.getByText(/Could not load submissions/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalled();
});

it("blocks the lead's own result when the project keeps adjudication separate", () => {
  const target = chainRow({ final: null });
  const data = chainData({ submissions: [submission({ submission_id: "mine", document_id: "c-de", author_label: "lead-0002", is_me: true })] });
  const onSelectFinal = vi.fn();
  const onAnnounce = vi.fn();
  renderChoice(target, data, { onSelectFinal, onAnnounce, adjudicatorNotAnnotator: true });
  const use = screen.getByRole("button", { name: "Use as final…" });
  expect(use.getAttribute("aria-disabled")).toBe("true");
  const reasonId = use.getAttribute("aria-describedby")!.split(" ")[1];
  expect(document.getElementById(reasonId)!.textContent).toBe("This project keeps adjudication separate from annotation. Another lead must choose this result.");
  fireEvent.click(use);
  expect(onSelectFinal).not.toHaveBeenCalled();
  expect(onAnnounce).toHaveBeenCalledWith("This project keeps adjudication separate from annotation. Another lead must choose this result.");
});

it("renders confirmations below their submission and the Keep confirmation below the notice", () => {
  const { target, data } = scenarioRow(scenarioS0(), "de");
  const { container } = renderChoice(target, data, { onKeep: vi.fn(), keepConfirm: <p>Keep confirm</p>, renderConfirm: entry => entry.submission_id === "sub-s0-review" ? <p>Replace confirm</p> : null });
  expect(screen.getByText("Keep confirm").parentElement).toBe(container.querySelector(".selection-notice"));
  expect(screen.getByText("Replace confirm").closest("tr")!.className).toBe("data-table-expanded");
});
it("names the Submissions heading without a count until the submissions are loaded", () => {
  const { target } = scenarioRow(scenarioS1(), "en");
  render(<FinalChoice onClose={vi.fn()} row={target} projectKey="p" query={query} submissions={state(null, { loading: true })} onNavigate={vi.fn()} now={now} />);
  expect(screen.getByRole("heading", { level: 3, name: "Submissions" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /^Submissions \(/ })).toBeNull();
});

it("renders Submissions as two-line list items with the confirmation below its item in the list layout", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const chosen = data.submissions[1];
  renderChoice(target, data, { layout: "list", renderConfirm: entry => (entry.submission_id === chosen.submission_id ? <p>Confirm here</p> : null) });
  expect(screen.queryByRole("table")).toBeNull();
  const list = screen.getByRole("list", { name: `Submissions, ${target.case_id} · en` });
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(data.submissions.length);
  expect(items[0].classList.contains("final-row")).toBe(true);
  expect(within(items[0]).getByText("Final")).toBeTruthy();
  expect(items[0].querySelector("a")!.id).toBe("documents-row-case-0042-en-final-view");
  const lines = items[1].querySelectorAll(".submissions-list-line");
  expect(lines).toHaveLength(2);
  expect(within(lines[0] as HTMLElement).getByRole("link", { name: /^View / })).toBeTruthy();
  expect(lines[1].textContent).toContain(`${chosen.finding_count} finding`);
  expect(within(lines[1] as HTMLElement).getByRole("button", { name: "Replace…" })).toBeTruthy();
  expect(items[1].querySelector(".submissions-list-confirm")!.textContent).toBe("Confirm here");
  expect(items[0].querySelector(".submissions-list-confirm")).toBeNull();
});

it("shows Submissions only when there is one or a final", () => {
  const target = planRow("case-0101", "de", stepOf("assign_translation_review"));
  renderChoice(target, submissions("case-0101", "de"));
  expect(screen.queryByRole("heading", { name: /^Submissions/ })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText("No submissions yet.")).toBeNull();
  cleanup();

  // While loading without a final result nothing but a status is shown.
  render(<FinalChoice onClose={vi.fn()} row={target} projectKey="p" query={query} submissions={state(null, { loading: true })} onNavigate={vi.fn()} now={now} />);
  expect(screen.queryByRole("heading", { name: /^Submissions/ })).toBeNull();
  expect(screen.getByText("Loading submissions…")).toBeTruthy();
  cleanup();

  const withFinal = { ...target, final: final({ case_id: "case-0101", language: "de", document_id: "case-0101-de", submission_id: "s1" }) };
  renderChoice(withFinal, submissions("case-0101", "de"));
  expect(screen.getByRole("heading", { name: "Submissions (0)" })).toBeTruthy();
  cleanup();

  const { target: s1, data } = scenarioRow(scenarioS1(), "en");
  renderChoice({ ...s1, final: null }, data);
  expect(screen.getByRole("heading", { name: "Submissions (2)" })).toBeTruthy();
});
it("shows Guidelines v2 (current: v3) in the submissions table", async () => {
  const listing = vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(3), guidelineSummary(2)]));
  try {
    const target = row({ case_id: "g", language: "de" });
    renderChoice(target, submissions("g", "de", { submissions: [submission({ submission_id: "s-g", document_id: "g-de", guideline_version: 2 })] }));
    expect(await screen.findByText("Guidelines v2 (current: v3)")).toBeTruthy();
    expect(listing).toHaveBeenCalledWith("p");
  } finally { listing.mockRestore(); }
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


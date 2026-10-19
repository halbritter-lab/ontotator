import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentRowView, RowSubmissions } from "../../src/api/client";
import type { ProjectDocumentsQuery } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { ExpandedRow, type ExpandedRowProps } from "../../src/documents/ExpandedRow";
import type { TextVersionsTools } from "../../src/documents/TextVersions";
import type { RowSubmissionsState } from "../../src/documents/useRowSubmissions";
import { refKey } from "../../src/variants/versionState";
import {
  final, item, round, row, rowKey, scenarioS0, scenarioS1, scenarioS3, scenarioS4, scenarioS6, submission, submissions, translationReview, version, type DocumentsScenario,
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
  const utils = render(<ExpandedRow row={target} projectKey="p" query={query} submissions={state(data)} onNavigate={onNavigate} now={now} onSelectFinal={vi.fn()} {...props} />);
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

it("renders a region labelled by the row with Submissions and More but no Issues without issues", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  renderRow(target, data);
  const region = screen.getByRole("region", { name: "case-0042 · en" });
  expect(within(region).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Submissions (2)", "More"]);
  expect(screen.getByRole("heading", { name: "Submissions (2)" }).getAttribute("tabindex")).toBe("-1");
});

it("uses the caller's label and id when given", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  render(<><span id="row-header">case-0042 · en row</span><ExpandedRow row={target} projectKey="p" query={{}} submissions={state(data)} onNavigate={vi.fn()} id="region-1" labelledBy="row-header" /></>);
  const region = screen.getByRole("region", { name: "case-0042 · en row" });
  expect(region.id).toBe("region-1");
});

it("shows the problem report line with excerpt, reporter, time, task state and Open report", () => {
  const scenario = scenarioS6();
  const { target, data } = scenarioRow(scenario, "de");
  const long = "x".repeat(130);
  const withLong = { ...target, issues: target.issues.map(entry => ({ ...entry, report: { ...entry.report!, excerpt: long } })) };
  const { onNavigate } = renderRow(withLong, data);
  const issues = screen.getByRole("heading", { name: "Issues" }).parentElement!;
  const line = within(issues).getByRole("listitem");
  expect(line.textContent).toBe(`${"x".repeat(120)}… · ann-0005 · ${time("2026-10-19T07:40:00Z")} · task paused Open report`);
  fireEvent.click(within(line).getByRole("link", { name: "Open report" }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectProblemReport", key: "p", reportId: "report-0390", documents: query });
});

it("shows the orphan pause with Resume task, translation and reviewer lines, and the source change note", async () => {
  const target = chainRow({
    final: null,
    issues: [
      item({ code: "TASK_PAUSED_WITHOUT_REPORT", cause_id: "TASK_PAUSED_WITHOUT_REPORT:7", category: "report-or-pause", report_id: "rep-1", assignment_id: 3, author_label: "ann-0004" }),
      item({ code: "TRANSLATION_NOT_ACCEPTED", cause_id: "TRANSLATION_NOT_ACCEPTED:c-de-v2", category: "translation", document_id: "c-de-v2", version: 2, review_decision: "rejected" }),
    ],
    notes: [
      item({ code: "SOURCE_UPDATE_UNREVIEWED", cause_id: "SOURCE_UPDATE_UNREVIEWED:c-de", document_id: "c-de", version: 1 }),
      item({ code: "REVIEWER_NEEDED", cause_id: "REVIEWER_NEEDED:c-de-v2", document_id: "c-de-v2", version: 2 }),
      item({ code: "ROUND_REVIEW_PENDING", cause_id: "ROUND_REVIEW_PENDING:r", author_label: "ann-0004" }),
    ],
  });
  const { onNavigate, container } = renderRow(target, chainData());
  const lines = [...container.querySelectorAll(".expanded-row-issues > li")].map(line => line.textContent);
  expect(lines).toEqual([
    "ann-0004's task is paused, but its report is resolved. Resume task",
    "v2 was rejected in review. Text versions",
    "The source text changed. Review source change",
    "v2 needs a translation reviewer. Text versions",
  ]);
  fireEvent.click(screen.getByRole("link", { name: "Resume task" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectProblemReport", key: "p", reportId: "rep-1", action: "resume", documents: query });
  fireEvent.click(screen.getByRole("link", { name: "Review source change" }));
  expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectCase", key: "p", caseId: "c", variant: "c-de", documents: query });

  const details = screen.getByText("Text versions (2)").closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getAllByRole("button", { name: "Text versions" })[0]);
  expect(details.open).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Text versions (2)")));
});

it("renders exactly the three lines of the S0 example", () => {
  const { target, data } = scenarioRow(scenarioS0(), "de");
  const onKeep = vi.fn();
  const { container } = renderRow(target, data, { onKeep });
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
  const { container } = renderRow(target, chainData(), { onKeep });
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
  const { container } = renderRow(target, data, { onKeep: vi.fn() });
  expect(noticeLines(container)).toEqual([
    "v2 was queried in review. No action needed.",
    "Waiting: translation review of v3 by ann-0009 is open. You can choose again once it is submitted.",
  ]);
  expect(screen.queryByRole("button", { name: "Keep final result…" })).toBeNull();
});

it("renders the S3 waiting line for the open translation review", () => {
  const { target, data } = scenarioRow(scenarioS3(), "de");
  const { container } = renderRow(target, data, { onKeep: vi.fn() });
  expect(noticeLines(container)).toContain("Waiting: translation review of v3 by rev-0007 is open. You can choose again once it is submitted.");
});

it("offers Use as final without a final result and Compare… with a preselected second submission", () => {
  const target = chainRow({ final: null });
  const onSelectFinal = vi.fn();
  const data = chainData({ submissions: chainData().submissions.slice(0, 2) });
  const { onNavigate } = renderRow(target, data, { onSelectFinal });
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
  const { onNavigate } = renderRow(target, data, { onSelectFinal });
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
  const { onNavigate } = renderRow(target, data);
  fireEvent.click(screen.getByRole("link", { name: /^View Annotation · Initial submission · ann-0002 · en v1/ }));
  expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-0042", variant: "case-0042-en", annotations: refKey({ kind: "submission", id: "sub-0042-b" }), documents: query });
});

it("keeps actions unavailable while submissions load and offers Retry after an error", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const onSelectFinal = vi.fn();
  render(<ExpandedRow row={{ ...target, final: null }} projectKey="p" query={{}} submissions={state(data, { loading: true })} onNavigate={vi.fn()} onSelectFinal={onSelectFinal} />);
  expect(screen.getByText("Loading submissions…")).toBeTruthy();
  const use = screen.getAllByRole("button", { name: "Use as final…" })[0];
  expect(use.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(use);
  expect(onSelectFinal).not.toHaveBeenCalled();
  cleanup();
  const retry = vi.fn();
  render(<ExpandedRow row={target} projectKey="p" query={{}} submissions={state(null, { error: new Error("boom"), retry })} onNavigate={vi.fn()} />);
  expect(screen.getByText(/Could not load submissions/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalled();
});

it("blocks the lead's own result when the project keeps adjudication separate", () => {
  const target = chainRow({ final: null });
  const data = chainData({ submissions: [submission({ submission_id: "mine", document_id: "c-de", author_label: "lead-0002", is_me: true })] });
  const onSelectFinal = vi.fn();
  const onAnnounce = vi.fn();
  renderRow(target, data, { onSelectFinal, onAnnounce, adjudicatorNotAnnotator: true });
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
  const { container } = renderRow(target, data, { onKeep: vi.fn(), keepConfirm: <p>Keep confirm</p>, renderConfirm: entry => entry.submission_id === "sub-s0-review" ? <p>Replace confirm</p> : null });
  expect(screen.getByText("Keep confirm").parentElement).toBe(container.querySelector(".selection-notice"));
  expect(screen.getByText("Replace confirm").closest("tr")!.className).toBe("data-table-expanded");
});

it("keeps More collapsed with consolidation, text versions and technical details", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  renderRow(target, data);
  const more = screen.getByRole("heading", { name: "More" }).parentElement!;
  const details = [...more.querySelectorAll("details")];
  expect(details.map(entry => entry.querySelector("summary")!.textContent)).toEqual(["Start consolidation…", "Text versions (1)", "Technical details"]);
  expect(details.every(entry => !entry.open)).toBe(true);
  expect(within(details[0]).getByRole("button", { name: "Consolidate results" })).toBeTruthy();
  const technical = details[2].textContent!;
  for (const value of ["case-0042-en", "sub-0042-a", "sub-0042-b", "mode independent"]) expect(technical).toContain(value);
});

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

it("names the Submissions heading without a count until the submissions are loaded", () => {
  const { target } = scenarioRow(scenarioS1(), "en");
  render(<ExpandedRow row={target} projectKey="p" query={query} submissions={state(null, { loading: true })} onNavigate={vi.fn()} now={now} />);
  expect(screen.getByRole("heading", { level: 3, name: "Submissions" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /^Submissions \(/ })).toBeNull();
});

it("renders Submissions as two-line list items with the confirmation below its item in the list layout", () => {
  const { target, data } = scenarioRow(scenarioS1(), "en");
  const chosen = data.submissions[1];
  renderRow(target, data, { layout: "list", renderConfirm: entry => (entry.submission_id === chosen.submission_id ? <p>Confirm here</p> : null) });
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

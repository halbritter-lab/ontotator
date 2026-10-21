import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, ConflictError, type DocumentRowView, type DocumentRowsPage, type FinalPanelView, type RowSubmissions } from "../../src/api/client";
import { formatTime } from "../../src/app/submissionLabels";
import { FinalPanel, type FinalPanelProps } from "../../src/documents/FinalPanel";
import { agreementText, barArrows, compareSummary, nextFinalDecision, nextOtherDecision } from "../../src/documents/finalPanelText";
import { notifyFinalSelectionChanged } from "../../src/variants/finalSelectionState";
import { refKey } from "../../src/variants/versionState";
import { guidelineListing, guidelineSummary } from "../projectFixtures";
import { agreement, bar, finalPanel, group, item, page, panelSubmission, round, rowKey, stepOf, translationReview, version } from "./fixtures";
import { acceptPanel, ana, anaSubmission, chooseRow, comparePanel, luc, panelRowSubmissions, reviewRow, tom, tomSubmission } from "./panelFixtures";

const OWN_REASON = "This project keeps adjudication separate from annotation. Another lead must choose this result.";
const now = new Date("2026-10-21T12:00:00Z");

let panels: Record<string, FinalPanelView>;
let rowSubmissions: Record<string, RowSubmissions>;

/** The page the rows reload returns after a decision (`onDecided`). */
let afterDecision: DocumentRowsPage | null;

interface HarnessProps extends Partial<FinalPanelProps> { initialKey: string; initialPage: DocumentRowsPage }

function Harness({ initialKey, initialPage, ...props }: HarnessProps): JSX.Element {
  const [key, setKey] = useState(initialKey);
  const [current, setCurrent] = useState(initialPage);
  const [open, setOpen] = useState(true);
  return <>
    <button id="trigger">Row action</button>
    {open && <FinalPanel projectKey="p" rowKey={key} page={current} query={{ panel: key }} now={now}
      onClose={() => setOpen(false)} onAdvance={setKey} onReload={vi.fn()} onNavigate={vi.fn()}
      onDecided={() => { if (afterDecision) setCurrent(afterDecision); }} {...props} />}
  </>;
}

function renderPanel(key: string, initial: DocumentRowsPage, props: Partial<FinalPanelProps> = {}) {
  return render(<Harness initialKey={key} initialPage={initial} {...props} />);
}

const dialog = () => screen.getByRole("dialog");
const liveRegion = () => dialog().querySelector("p[role='status']")!;
const time = (iso: string) => formatTime(iso, { now });

beforeEach(() => {
  panels = {};
  rowSubmissions = {};
  afterDecision = null;
  vi.spyOn(api, "finalPanel").mockImplementation(async (_key, caseId, language) => structuredClone(panels[rowKey(caseId, language)] ?? finalPanel()));
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) =>
    structuredClone(rowSubmissions[rowKey(caseId, language)] ?? panelRowSubmissions(caseId, language, panels[rowKey(caseId, language)] ?? finalPanel())));
  vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(3), guidelineSummary(2)]));
  vi.spyOn(api, "selectFinalResult").mockResolvedValue({ case_id: "x", language: "de", document_id: "d", submission_id: "s", revision: 1 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("choose", () => {
  it("accept: Accept Ana Weber’s annotation as final? with Round line and Accept as final", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de", { guideline_version: 2 });
    const onNavigate = vi.fn();
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]), { onNavigate });
    expect(screen.getByRole("dialog", { name: "Final result · case-107 · de" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Final result · case-107 · de" })).toBeTruthy();
    expect(await screen.findByText("Accept Ana Weber’s annotation as final?")).toBeTruthy();
    const line = screen.getByText(`Round 1 · 3 findings · submitted ${time("2026-10-20T12:01:00Z")} · on de v1`, { exact: false });
    fireEvent.click(within(line).getByRole("link", { name: "Open in editor" }));
    expect(onNavigate).toHaveBeenCalledWith({
      name: "projectCase", key: "p", caseId: "case-107", variant: "case-107-de",
      annotations: refKey({ kind: "submission", id: "case-107-s1" }), documents: { panel: "case-107:de" },
    });
    // Guidelines are on main: the panel's submission rows carry the guideline label.
    expect(await screen.findByText("Guidelines v2 (current: v3)")).toBeTruthy();
    const accept = screen.getByRole("button", { name: "Accept as final" });
    expect(accept.classList.contains("btn-primary")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(accept);
    expect(api.selectFinalResult).toHaveBeenCalledWith("p", { document_id: "case-107-de", submission_id: "case-107-s1", expected_revision: 0, acknowledged_cause_ids: [] });
  });

  it("offers Assign annotation review… and closes on Cancel", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    const onAssign = vi.fn();
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]), { onAssign });
    fireEvent.click(await screen.findByRole("button", { name: "Assign annotation review…" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-107", language: "de" }));
    // One submission: nothing to consolidate.
    expect(screen.queryByRole("button", { name: "Consolidate…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("consolidation of all others: Accept the consolidation by … plus Compare all 3…", async () => {
    const consolidation = panelSubmission({ submission_id: "c-s3", document_id: "case-108-de", author_label: "rev-0005", author: luc, kind: "consolidation", round_id: "c-r3", round_ordinal: null, finding_count: 6, recorded_at: "2026-10-21T09:00:00Z" });
    panels[rowKey("case-108", "de")] = finalPanel({
      submissions: [anaSubmission("case-108", "de", { only_here: 1 }), tomSubmission("case-108", "de", { only_here: 0 }), { ...consolidation, only_here: 0 }],
      agreement: agreement({ total: 6, matching: 5 }), label_rule: "accept", accept_submission_id: "c-s3",
    });
    renderPanel("case-108:de", page([group("case-108", [chooseRow("case-108", "de")])]));
    expect(await screen.findByText("Accept the consolidation by Luc Martin as final?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare all 3…" }));
    expect(screen.queryByText("Accept the consolidation by Luc Martin as final?")).toBeNull();
    const table = screen.getByRole("table", { name: "Submissions, case-108 · de" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("compare: summary, Agreement: 4 of 6 findings match · 1 differs in context only, How is this counted?", async () => {
    panels[rowKey("case-109", "de")] = comparePanel("case-109", "de");
    renderPanel("case-109:de", page([group("case-109", [chooseRow("case-109", "de")])]));
    expect(await screen.findByText("2 annotations submitted on v1 · 6 findings in total")).toBeTruthy();
    expect(screen.getByText("Agreement: 4 of 6 findings match · 1 differs in context only")).toBeTruthy();
    const bar = dialog().querySelector("meter")!;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    const how = screen.getByRole("button", { name: "How is this counted?" });
    expect(how.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(how);
    expect(how.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(how.getAttribute("aria-controls")!)!.textContent).toMatch(/^Two findings match when they are in the same layer/);
    // Consolidate… with its hint.
    expect(screen.getByText("merge both into a new final (you or someone else)", { exact: false })).toBeTruthy();
  });

  it("table Submission · Findings · Only here; other version shows on v1 · not compared and stays selectable", async () => {
    const v2 = (overrides = {}) => anaSubmission("case-110", "de", { document_id: "case-110-de-v2", version: 2, ...overrides });
    panels[rowKey("case-110", "de")] = finalPanel({
      submissions: [
        v2({ submission_id: "a2", finding_count: 5, only_here: 1 }),
        tomSubmission("case-110", "de", { submission_id: "t2", document_id: "case-110-de-v2", version: 2, only_here: 0 }),
        tomSubmission("case-110", "de", { submission_id: "t1", author: { ...tom, display_name: "Tom Old" }, comparable: false, only_here: null, guideline_version: 3 }),
      ],
      agreement: agreement({ compared_version: 2, total: 6, matching: 4 }),
    });
    renderPanel("case-110:de", page([group("case-110", [chooseRow("case-110", "de")])]));
    const table = await screen.findByRole("table", { name: "Submissions, case-110 · de" });
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Submission", "Findings", "Only here", "Actions"]);
    const rows = within(table).getAllByRole("row").slice(1);
    const ana2 = within(rows[0]).getAllByRole("cell").map(cell => cell.textContent);
    expect(within(rows[0]).getByRole("rowheader").textContent).toContain("Ana Weber");
    expect(within(rows[0]).getByRole("rowheader").textContent).toContain(`Round 1 · ${time("2026-10-20T12:01:00Z")}`);
    expect(ana2.slice(0, 2)).toEqual(["5", "1"]);
    const old = rows[2];
    expect(within(old).getAllByRole("cell")[1].textContent).toBe("on v1 · not compared");
    expect(within(old).getByText("Guidelines v3")).toBeTruthy();
    const use = within(old).getByRole("button", { name: "Use as final" });
    expect(use.getAttribute("aria-disabled")).toBeNull();
    expect(document.getElementById(use.getAttribute("aria-describedby")!)!.textContent).toContain("Tom Old");
    fireEvent.click(use);
    expect(api.selectFinalResult).toHaveBeenCalledWith("p", expect.objectContaining({ submission_id: "t1", document_id: "case-110-de" }));
    expect(within(old).getByRole("link", { name: "Open in editor, Tom Old" })).toBeTruthy();
  });

  it("own result: Use as final aria-disabled with OWN_RESULT_REASON", async () => {
    panels[rowKey("case-111", "de")] = finalPanel({
      submissions: [anaSubmission("case-111", "de", { is_me: true, eligible: false, only_here: 1 }), tomSubmission("case-111", "de", { only_here: 0 })],
      agreement: agreement({ total: 5, matching: 4 }),
    });
    renderPanel("case-111:de", page([group("case-111", [chooseRow("case-111", "de")])], { adjudicator_not_annotator: true }));
    const [own, other] = await screen.findAllByRole("button", { name: "Use as final" });
    expect(own.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(own.getAttribute("aria-describedby")!.split(" ").at(-1)!)!.textContent).toBe(OWN_REASON);
    expect(other.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(own);
    expect(api.selectFinalResult).not.toHaveBeenCalled();
    await waitFor(() => expect(liveRegion().textContent).toBe(OWN_REASON));
  });

  it("Consolidate… opens the launcher in the panel; after start the panel closes", async () => {
    panels[rowKey("case-112", "de")] = comparePanel("case-112", "de");
    const onConsolidationStarted = vi.fn();
    renderPanel("case-112:de", page([group("case-112", [chooseRow("case-112", "de")])]), { onConsolidationStarted, username: "lead" });
    fireEvent.click(await screen.findByRole("button", { name: "Consolidate…" }));
    expect(within(dialog()).getByRole("button", { name: "Consolidate results" })).toBeTruthy();
    act(() => { notifyFinalSelectionChanged("other"); });
    expect(onConsolidationStarted).not.toHaveBeenCalled();
    act(() => { notifyFinalSelectionChanged("p"); });
    expect(onConsolidationStarted).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-112" }));
  });

  it("links History · Text versions · Technical details to the row's expansion", async () => {
    panels[rowKey("case-109", "de")] = comparePanel("case-109", "de");
    const onSection = vi.fn();
    renderPanel("case-109:de", page([group("case-109", [chooseRow("case-109", "de")])]), { onSection });
    fireEvent.click(await screen.findByRole("button", { name: "Text versions" }));
    expect(onSection).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-109" }), "versions");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(onSection.mock.calls.map(call => call[1])).toEqual(["versions", "history", "technical"]);
  });
});

describe("review changes", () => {
  it("review changes: Keep final on v1 primary only when the text change is the only cause; Carry to v2…; Use the newer result", async () => {
    const target = reviewRow("case-113", "de");
    panels[rowKey("case-113", "de")] = finalPanel({ submissions: [anaSubmission("case-113", "de")], causes: target.issues, changed_passages: 2 });
    const onCarry = vi.fn();
    const onNavigate = vi.fn();
    renderPanel("case-113:de", page([group("case-113", [target])]), { onCarry, onNavigate });
    expect(await screen.findByText("v2 (Accepted) corrects the text of the final result.", { exact: false })).toBeTruthy();
    expect(screen.getByText("The text changed from v1 to v2 after this final was chosen.")).toBeTruthy();
    expect(screen.getByText("2 findings are in changed passages", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Show changes" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ name: "projectCase", variant: "case-113-de-v2" }));
    const keep = screen.getByRole("button", { name: "Keep final on v1" });
    expect(keep.classList.contains("btn-primary")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Carry to v2…" }));
    expect(onCarry).toHaveBeenCalledWith(target, "case-113-de-v2");
    expect(screen.queryByRole("button", { name: "Use the newer result" })).toBeNull();
    fireEvent.click(keep);
    expect(api.selectFinalResult).toHaveBeenCalledWith("p", {
      document_id: "case-113-de", submission_id: "case-113-s1", expected_revision: 2, acknowledged_cause_ids: [target.issues[0].cause_id],
    });
    cleanup();

    // A newer result besides the text change: no primary, and "Use the newer result" replaces the final.
    const newer = tomSubmission("case-114", "de", { submission_id: "newer", recorded_at: "2026-10-21T08:00:00Z" });
    const withNewer = reviewRow("case-114", "de");
    const both = { ...withNewer, issues: [...withNewer.issues, item({ code: "SELECTED_NEWER_RESULT", cause_id: "SELECTED_NEWER_RESULT:newer", category: "confirm-final", document_id: "case-114-de" })] };
    panels[rowKey("case-114", "de")] = finalPanel({ submissions: [anaSubmission("case-114", "de"), newer], causes: both.issues });
    renderPanel("case-114:de", page([group("case-114", [both])]));
    const keepAgain = await screen.findByRole("button", { name: "Keep final on v1" });
    expect(keepAgain.classList.contains("btn-primary")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use the newer result" }));
    expect(api.selectFinalResult).toHaveBeenCalledWith("p", { document_id: "case-114-de", submission_id: "newer", expected_revision: 2, acknowledged_cause_ids: [] });
  });

  it("words every acknowledgeable cause and the waiting lines as the selection notice does", async () => {
    const base = reviewRow("c", "de");
    const target: DocumentRowView = {
      ...base,
      issues: [
        item({ code: "SELECTED_ROUND_ABANDONED", cause_id: "SELECTED_ROUND_ABANDONED:r1", category: "confirm-final" }),
        item({ code: "SELECTED_ROUND_SUPERSEDED", cause_id: "SELECTED_ROUND_SUPERSEDED:r1", category: "confirm-final" }),
        item({ code: "SELECTED_NEWER_RESULT", cause_id: "SELECTED_NEWER_RESULT:s2", category: "confirm-final", document_id: "c-de" }),
        ...base.issues,
      ],
    };
    const s2 = anaSubmission("c", "de", { submission_id: "s2", author_label: "ann-0004", author: null, round_id: "r2", round_ordinal: 2 });
    panels[rowKey("c", "de")] = finalPanel({ submissions: [anaSubmission("c", "de", { submission_id: "c-s1", round_id: "r1" }), s2], causes: target.issues });
    rowSubmissions[rowKey("c", "de")] = panelRowSubmissions("c", "de", panels[rowKey("c", "de")], {
      rounds: [
        round({ round_id: "r1", assignment_id: 1, document_id: "c-de", author_label: "ann-0004", round_ordinal: 1, state: "superseded" }),
        round({ round_id: "r2", assignment_id: 1, predecessor_round_id: "r1", document_id: "c-de", author_label: "ann-0004", round_ordinal: 2 }),
      ],
      open_translation_reviews: [translationReview({ assignment_id: 9, document_id: "c-de-v2", version: 2, reviewer_label: "rev-0009" })],
    });
    renderPanel("c:de", page([group("c", [target])]));
    await screen.findByRole("button", { name: "Keep final on v1" });
    const lines = [...dialog().querySelectorAll(".selection-notice-lines > li")].map(line => line.textContent);
    expect(lines).toEqual([
      "Round 1 (ann-0004) is abandoned.",
      "Round 1 (ann-0004) has been superseded by Round 2.",
      `Round 2 · ann-0004 · v1 was submitted after the final result was chosen (${time("2026-10-18T10:05:00Z")}).`,
      "v2 (Accepted) corrects the text of the final result.Keep v1, or choose a result on v2 once one exists (assign work in Text versions).",
      "Waiting: translation review of v2 by rev-0009 is open. You can choose again once it is submitted.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Keep final on v1" }));
    expect(vi.mocked(api.selectFinalResult).mock.calls[0][1].acknowledged_cause_ids).toHaveLength(4);
  });

  it("adds the non-actionable correction lines of the selection notice", async () => {
    const base = reviewRow("q", "de");
    const v2 = version({ ...base.versions[1], translation_status: "reviewed", latest_review_decision: "query", is_newest_in_chain: false });
    const v3 = version({ ...base.versions[1], document_id: "q-de-v3", version: 3, derived_from: v2.document_id, translation_status: "ready_for_review" });
    const target = { ...base, versions: [base.versions[0], v2, v3] };
    panels[rowKey("q", "de")] = finalPanel({ submissions: [anaSubmission("q", "de")], causes: target.issues });
    renderPanel("q:de", page([group("q", [target])]));
    await screen.findByRole("button", { name: "Keep final on v1" });
    const lines = [...dialog().querySelectorAll(".selection-notice-lines > li")].map(line => line.textContent);
    expect(lines).toContain("v2 was queried in review. No action needed.");
  });

  it("makes Keep unavailable for the lead's own final while the rule is on", async () => {
    const target = reviewRow("case-115", "de");
    const own = { ...target, final: { ...target.final!, is_mine: true } };
    panels[rowKey("case-115", "de")] = finalPanel({ submissions: [anaSubmission("case-115", "de")], causes: own.issues });
    renderPanel("case-115:de", page([group("case-115", [own])], { adjudicator_not_annotator: true }));
    const keep = await screen.findByRole("button", { name: "Keep final on v1" });
    expect(keep.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(keep);
    expect(api.selectFinalResult).not.toHaveBeenCalled();
    await waitFor(() => expect(liveRegion().textContent).toBe(OWN_REASON));
  });
});

describe("after a decision", () => {
  it("after a decision shows the next choose/confirm row, success line, focus on the new heading, live announcement", async () => {
    const first = chooseRow("case-107", "de");
    const between = chooseRow("case-108", "de", { next_step: stepOf("decide_report"), steps: [stepOf("decide_report")] });
    const next = reviewRow("case-109", "de");
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    panels[rowKey("case-109", "de")] = finalPanel({ submissions: [anaSubmission("case-109", "de")], causes: next.issues });
    renderPanel("case-107:de", page([group("case-107", [first]), group("case-108", [between]), group("case-109", [next])], { bar: bar({ total: 3, missing_final: 1 }) }));
    const decided = { ...first, next_step: null, steps: [], categories: [] };
    afterDecision = page([group("case-107", [decided]), group("case-108", [between]), group("case-109", [next])], { bar: bar({ total: 2, missing_final: 0 }) });
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Final result · case-109 · de"));
    expect(screen.getByText("Final result saved for case-107 · de.")).toBeTruthy();
    expect(screen.getByText("Needs your decision: 3 → 2 · Final result missing: 1 → 0")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 })));
    await waitFor(() => expect(liveRegion().textContent).toBe("Final result saved. Next: case-109 · de."));
    expect(await screen.findByRole("button", { name: "Keep final on v1" })).toBeTruthy();
  });

  it("none left: No more final results to decide. and Next decision link", async () => {
    const first = chooseRow("case-107", "de");
    const report = chooseRow("case-109", "de", { next_step: stepOf("decide_report"), steps: [stepOf("decide_report")] });
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    const onRowAction = vi.fn();
    renderPanel("case-107:de", page([group("case-107", [first]), group("case-109", [report])]), { onRowAction });
    afterDecision = page([group("case-107", [{ ...first, next_step: null, steps: [] }]), group("case-109", [report])]);
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    expect(await screen.findByText("No more final results to decide.")).toBeTruthy();
    expect(screen.getByText("Final result saved for case-107 · de.")).toBeTruthy();
    await waitFor(() => expect(liveRegion().textContent).toBe("Final result saved. No more final results to decide."));
    fireEvent.click(screen.getByRole("button", { name: "Next decision: case-109 · de (problem report)" }));
    expect(onRowAction).toHaveBeenCalledWith(report, report.next_step);
  });

  it("reports a save whose reload failed and stays on the row", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    const initial = page([group("case-107", [chooseRow("case-107", "de")])]);
    const { rerender } = renderPanel("case-107:de", initial);
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    await waitFor(() => expect(api.selectFinalResult).toHaveBeenCalled());
    rerender(<Harness initialKey="case-107:de" initialPage={initial} refreshFailed />);
    expect(await screen.findByText("Final result saved for case-107 · de. The list could not be refreshed.")).toBeTruthy();
  });
});

describe("failures", () => {
  it("RevisionConflict shows This final result changed. Review again.", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    const onReload = vi.fn();
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]), { onReload });
    vi.mocked(api.selectFinalResult).mockRejectedValue(new ConflictError("conflict", "REVISION_CONFLICT", { current_revision: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This final result changed.Review again");
    const calls = vi.mocked(api.finalPanel).mock.calls.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Review again" }));
    expect(onReload).toHaveBeenCalled();
    await waitFor(() => expect(vi.mocked(api.finalPanel).mock.calls.length).toBe(calls + 1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the own-result rule when the server refuses the lead's own result", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]));
    vi.mocked(api.selectFinalResult).mockRejectedValue(new ConflictError("own", "OWN_RESULT_NOT_SELECTABLE"));
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    expect((await screen.findByRole("alert")).textContent).toContain(`${OWN_REASON} Nothing was saved.`);
  });

  it("offers Retry after a network error and keeps the choice after a session end", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]));
    vi.mocked(api.selectFinalResult).mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(await screen.findByRole("button", { name: "Accept as final" }));
    expect(await screen.findByText("Could not save. Nothing changed.")).toBeTruthy();
    vi.mocked(api.selectFinalResult).mockRejectedValueOnce(new AuthError("expired", undefined, "NOT_AUTHENTICATED", 401));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Your session ended. Nothing was saved. Sign in and confirm again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Accept as final" }).getAttribute("aria-busy")).toBeNull();
    expect(api.selectFinalResult).toHaveBeenCalledTimes(2);
  });

  it("keeps every choice unavailable while a save runs and ignores Escape", async () => {
    panels[rowKey("case-109", "de")] = comparePanel("case-109", "de");
    const onClose = vi.fn();
    renderPanel("case-109:de", page([group("case-109", [chooseRow("case-109", "de")])]), { onClose });
    vi.mocked(api.selectFinalResult).mockReturnValue(new Promise(() => {}));
    const [first, second] = await screen.findAllByRole("button", { name: "Use as final" });
    fireEvent.click(first);
    expect(first.getAttribute("aria-busy")).toBe("true");
    expect(second.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(second);
    expect(api.selectFinalResult).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when the row is no longer in the list", async () => {
    panels[rowKey("case-107", "de")] = acceptPanel("case-107", "de");
    renderPanel("case-107:de", page([group("case-200", [chooseRow("case-200", "de")])]));
    expect(await screen.findByText("case-107 · de is not in this list.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept as final" })).toBeNull();
  });

  it("shows Loading submissions… and a load error with Review again", async () => {
    vi.mocked(api.finalPanel).mockRejectedValueOnce(new Error("offline"));
    renderPanel("case-107:de", page([group("case-107", [chooseRow("case-107", "de")])]));
    expect(screen.getByText("Loading submissions…")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
    await waitFor(() => expect(api.finalPanel).toHaveBeenCalledTimes(2));
  });
});

describe("panel text", () => {
  it("summarises without an agreement and pluralises", () => {
    expect(compareSummary([anaSubmission("c", "de"), tomSubmission("c", "de", { document_id: "c-de-v2", version: 2, comparable: false })], null))
      .toBe("2 annotations submitted on v2 · 7 findings in total");
    expect(agreementText(agreement({ total: 6, matching: 4, context_differences: 2 }))).toBe("Agreement: 4 of 6 findings match · 2 differ in context only");
    expect(agreementText(agreement({ total: 6, matching: 6 }))).toBe("Agreement: 6 of 6 findings match");
    expect(barArrows(bar({ total: 3, confirm_final: 1 }), bar({ total: 2, confirm_final: 0 }))).toBe("Needs your decision: 3 → 2 · Final result to confirm: 1 → 0");
  });

  it("finds the next final decision after the row, wrapping around", () => {
    const a = chooseRow("a", "de");
    const b = chooseRow("b", "de", { next_step: stepOf("decide_report"), steps: [stepOf("decide_report")] });
    const c = reviewRow("c", "de");
    const list = page([group("a", [a]), group("b", [b]), group("c", [c])]);
    expect(nextFinalDecision(list, "c:de")?.row).toBe(a);
    expect(nextFinalDecision(list, "a:de")?.row).toBe(c);
    expect(nextOtherDecision(list, "a:de")?.row).toBe(b);
    expect(nextFinalDecision(page([group("a", [a])]), "a:de")).toBeNull();
    expect(ana.display_name).toBe("Ana Weber");
  });
});

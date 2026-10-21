/** Row panel of the Documents page (acceptance fixes WP-A): frame, entries, Activity, tabs, keys, route. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type DocumentRowView, type RowSubmissions } from "../../src/api/client";
import { DocumentsPage } from "../../src/admin/DocumentsPage";
import { parseRoute, type ProjectDocumentsQuery, type Route } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { RowPanel, type RowPanelProps, type RowPanelTarget } from "../../src/documents/RowPanel";
import { TextVersions, type TextVersionsTools } from "../../src/documents/TextVersions";
import { useRegisteredShortcuts } from "../../src/ui/shortcuts";
import {
  final, finalPanel, group, item, notInPlanRow, page, planRow, recordedVersion, row, rowKey, scenarioS4, stepOf, submission, submissions, version, work,
} from "./fixtures";
import { comparePanel, chooseRow } from "./panelFixtures";
import { ana, cell, stagedRow, tom } from "./tableFixtures";

const now = new Date("2026-10-19T12:00:00Z");
const time = (iso: string) => formatTime(iso, { now });
const query: ProjectDocumentsQuery = { decision: "all", panel: "case-107:de" };
const reportRoute = (reportId: string): Route => ({ name: "projectProblemReport", key: "p", reportId, documents: query });

let rowData: Record<string, RowSubmissions>;
beforeEach(() => {
  rowData = {};
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => structuredClone(rowData[rowKey(caseId, language)] ?? submissions(caseId, language)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

// ---- Component: the panel with a route state of its own ----

interface HarnessProps extends Partial<RowPanelProps> {
  rows: DocumentRowView[];
  initial: RowPanelTarget;
  children?: ReactNode;
}

const navigations: RowPanelTarget[] = [];
function Harness({ rows, initial, children, ...props }: HarnessProps): JSX.Element {
  const [target, setTarget] = useState(initial);
  const [open, setOpen] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={opener} type="button">Opener</button>
    <input aria-label="Case ID or text" />
    {children}
    {open && <RowPanel projectKey="p" rowKey={target.key} row={rows.find(entry => rowKey(entry.case_id, entry.language) === target.key) ?? null} rows={rows}
      stage={target.stage} tab={target.tab} query={query} returnFocusRef={opener} reportRoute={reportRoute} now={now}
      onNavigate={next => { navigations.push(next); setTarget(next); }} onRoute={vi.fn()} onClose={() => setOpen(false)} {...props} />}
  </>;
}

function renderPanel(rows: DocumentRowView[], key: string, props: Partial<HarnessProps> = {}) {
  navigations.length = 0;
  const onRoute = props.onRoute ?? vi.fn();
  const view = render(<Harness rows={rows} initial={{ key }} {...props} onRoute={onRoute} />);
  return { ...view, onRoute };
}

const panel = () => screen.getByRole("complementary");
const status = () => panel().querySelector(":scope > p[role='status']")!;
const activityLines = () => [...panel().querySelectorAll(".row-activity-line")].map(line => line.textContent);

const ana2 = { pseudonym: "ann-0003", display_name: "Ana Weber", is_me: false };

/** case-107 · de: Ana accepted v1 with corrections (v2), two submissions on v2, a moved task, one open report. */
function historyRow(overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const v1 = version({ document_id: "case-107-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted_corrected", is_newest_in_chain: false });
  const v2 = version({ document_id: "case-107-de-v2", chain_id: "case-107-de", version: 2, origin: "correction", derived_from: "case-107-de", translation_status: "accepted" });
  return row({
    case_id: "case-107", language: "de", versions: [v1, v2],
    work: [
      work({ assignment_id: 1, document_id: "case-107-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana2 }),
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
/** Three visible rows over two cases (the group row between them is no row). */
const threeRows = () => [historyRow(), row({ case_id: "case-108", language: "de" }), row({ case_id: "case-109", language: "de" })];

describe("frame (U10)", () => {
  it("is a non-modal aside 'Details, case-107 · de' with the heading 'case-107 · de v2', focused on open; nothing inert or dimmed", async () => {
    rowData["case-107:de"] = historyData();
    const { container } = renderPanel([historyRow()], "case-107:de");
    const aside = screen.getByRole("complementary", { name: "Details, case-107 · de" });
    expect(aside.tagName).toBe("ASIDE");
    expect(aside.getAttribute("aria-modal")).toBeNull();
    const heading = within(aside).getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("case-107 · de v2");
    expect(document.activeElement).toBe(heading);
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.querySelector("[class*='dim'], [class*='scrim'], .modal-overlay")).toBeNull();
    // The page stays operable: the search field takes focus and input.
    const search = screen.getByRole("textbox", { name: "Case ID or text" });
    search.focus();
    expect(document.activeElement).toBe(search);
    expect(await within(aside).findByRole("tabpanel")).toBeTruthy();
  });

  it("Escape inside closes and returns focus to the opener; Escape outside does nothing", async () => {
    renderPanel([historyRow()], "case-107:de");
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    fireEvent.keyDown(opener, { key: "Escape" });
    expect(screen.getByRole("complementary")).toBeTruthy();
    const close = within(panel()).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("Close returns focus to the opener", async () => {
    renderPanel([historyRow()], "case-107:de");
    fireEvent.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Opener" })));
  });

  it("says when the row is not in this list", () => {
    renderPanel([historyRow()], "case-300:fr");
    expect(screen.getByRole("complementary", { name: "Details, case-300 · fr" })).toBeTruthy();
    expect(within(panel()).getByText("case-300 · fr is not in this list.")).toBeTruthy();
    expect(within(panel()).getByRole("button", { name: "Next row" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Previous / Next (J / K, U11)", () => {
  it("J and K walk the visible rows, keep tab and stage, mark the ends aria-disabled and announce First row / Last row", async () => {
    renderPanel(threeRows(), "case-108:de", { initial: { key: "case-108:de", stage: "annotation", tab: "activity" } });
    const previous = within(panel()).getByRole("button", { name: "Previous: case-107 · de" });
    expect(previous.getAttribute("aria-keyshortcuts")).toBe("K");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(navigations.at(-1)).toEqual({ key: "case-109:de", stage: "annotation", tab: "activity" });
    // The header shows the new row at once; its body loads.
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("case-109 · de v1");
    const last = within(panel()).getByRole("button", { name: "Next row" });
    expect(last.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() => expect(status().textContent).toBe("Showing case-109 · de"));
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(status().textContent).toBe("Last row"));
    expect(navigations).toHaveLength(1);
    fireEvent.click(last);
    expect(navigations).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "k" });
    fireEvent.keyDown(document.body, { key: "k" });
    expect(navigations.map(entry => entry.key)).toEqual(["case-109:de", "case-108:de", "case-107:de"]);
    expect(within(panel()).getByRole("button", { name: "Previous row" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(status().textContent).toBe("First row"));
  });

  it("does nothing while typing in the search field", () => {
    renderPanel(threeRows(), "case-108:de");
    const search = screen.getByRole("textbox", { name: "Case ID or text" });
    fireEvent.keyDown(search, { key: "j" });
    expect(navigations).toHaveLength(0);
  });

  it("swaps the content without remounting the frame: Loading case-109 · de… until its submissions arrive", async () => {
    let resolve: (value: RowSubmissions) => void = () => {};
    renderPanel(threeRows(), "case-108:de");
    const frame = panel();
    await within(frame).findByText("Nothing has happened yet.");
    vi.mocked(api.getRowSubmissions).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(within(frame).getByRole("button", { name: "Next: case-109 · de" }));
    expect(panel()).toBe(frame);
    expect(within(frame).getByText("Loading case-109 · de…")).toBeTruthy();
    await act(async () => { resolve(submissions("case-109", "de")); });
    expect(within(frame).queryByText("Loading case-109 · de…")).toBeNull();
  });

  it("asks Discard your unsaved choice? for a waiting switch", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderPanel(threeRows(), "case-108:de", { pendingSwitch: { name: "case-109 · de", onConfirm, onCancel } });
    const confirm = within(panel()).getByRole("heading", { name: "Discard your unsaved choice?" }).closest("div")!.parentElement!;
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    expect(onCancel).toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Discard" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("lists J / K in the ? help", () => {
    function Help() {
      const rows = useRegisteredShortcuts();
      return <ul aria-label="Help">{rows.map((entry, index) => <li key={index}>{`${entry.keys.join(" / ")}: ${entry.description}`}</li>)}</ul>;
    }
    renderPanel(threeRows(), "case-108:de", { children: <Help /> });
    expect(within(screen.getByRole("list", { name: "Help" })).getByText("j / k: Next / previous row in the details panel")).toBeTruthy();
  });
});

describe("stage strip and Activity", () => {
  it("lists Activity newest first with a stage tag each, banners an open report and offers the stage's admin actions", async () => {
    rowData["case-107:de"] = historyData();
    const onAssign = vi.fn();
    const target = historyRow();
    const { onRoute } = renderPanel([target], "case-107:de", { onAssign });
    await within(panel()).findByText(/ann-0006/);
    expect(activityLines()).toEqual([
      "Annotation: ann-0005 · moved to v2",
      `Annotation: ann-0006 · Initial submission · 3 findings · v2 · ${time("2026-10-19T10:00:00Z").split(", ")[1]}`,
      `Annotation: ann-0004 · Initial submission · 3 findings · v2 · ${time("2026-10-19T09:00:00Z").split(", ")[1]}`,
      "Review: Ana Weber (ann-0003) · Accepted with corrections · v1 → v2",
    ]);
    expect([...panel().querySelectorAll(".row-activity-tag")].map(tag => tag.textContent)).toEqual(["Annotation", "Annotation", "Annotation", "Review"]);
    const banner = panel().querySelector(".row-panel-banner")!;
    expect(banner.textContent).toBe("1 open problem report · Open");
    fireEvent.click(within(banner as HTMLElement).getByRole("link", { name: "Open problem report, Cut off" }));
    expect(onRoute).toHaveBeenCalledWith(reportRoute("r-1"));
    fireEvent.click(within(panel()).getByRole("button", { name: "Assign annotation review…" }));
    expect(onAssign).toHaveBeenCalledWith(target, "review");
    // Consolidation starts only from the decision block.
    expect(within(panel()).queryByText(/Start consolidation/)).toBeNull();
  });

  it("filters by stage with a chip and Show all stages; the stage strip switches the filter", async () => {
    rowData["case-107:de"] = historyData();
    renderPanel([historyRow()], "case-107:de", { initial: { key: "case-107:de", stage: "review" } as RowPanelTarget });
    const strip = within(panel()).getByRole("group", { name: "Filter activity by stage" });
    expect(within(strip).getByRole("button", { name: /^Review/ }).getAttribute("aria-pressed")).toBe("true");
    await within(panel()).findByText(/Accepted with corrections/);
    expect(activityLines()).toEqual(["Review: Ana Weber (ann-0003) · Accepted with corrections · v1 → v2"]);
    // The review stage offers no annotation actions.
    expect(within(panel()).queryByRole("button", { name: "Assign annotation review…" })).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: /^Annotation/ }));
    expect(navigations.at(-1)).toEqual({ key: "case-107:de", stage: "annotation", tab: "activity" });
    expect(activityLines()).toHaveLength(3);
    fireEvent.click(within(panel()).getByRole("button", { name: "Remove filter Annotation" }));
    expect(navigations.at(-1)).toEqual({ key: "case-107:de", stage: undefined, tab: "activity" });
    expect(activityLines()).toHaveLength(4);
    fireEvent.click(within(strip).getByRole("button", { name: /^Final/ }));
    expect(await within(panel()).findByText("No final activity yet.")).toBeTruthy();
    fireEvent.click(within(panel()).getByRole("button", { name: "Show all stages" }));
    expect(navigations.at(-1)?.stage).toBeUndefined();
  });

  it("says Nothing has happened yet. and No annotation activity yet., and links a paused task's report", async () => {
    renderPanel([row({ case_id: "c", language: "de" })], "c:de");
    expect(await within(panel()).findByText("Nothing has happened yet.")).toBeTruthy();
    cleanup();
    renderPanel([row({ case_id: "c", language: "de" })], "c:de", { initial: { key: "c:de", stage: "annotation" } as RowPanelTarget });
    expect(await within(panel()).findByText("No annotation activity yet.")).toBeTruthy();
    cleanup();
    const held = row({ case_id: "c", language: "de", notes: [item({ code: "TASK_ON_HOLD", cause_id: "hold-1", author_label: "ann-0004", report_id: "rep-1" })] });
    const { onRoute } = renderPanel([held], "c:de");
    await within(panel()).findByText(/Task paused/);
    expect(activityLines()).toEqual(["Annotation Task paused: ann-0004 · Open report"]);
    fireEvent.click(within(panel()).getByRole("link", { name: "Open report" }));
    expect(onRoute).toHaveBeenCalledWith(reportRoute("rep-1"));
  });

  it("offers Assign a new review… for lead and override acceptances only, and Request correction… when allowed", async () => {
    const accepted = (source: "lead" | "override" | "package") => planRow("c", "de", stepOf("assign_annotation", { stage: "annotation" }), {
      plan_row: { review: false, annotate: true, review_applicable: true, discarded: false },
      versions: [recordedVersion({
        document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", accepted_without_review: source === "override",
        acceptance: { source, reason: source === "package" ? null : "Reviewed by the partner site", accepted_at: "2026-10-20T11:40:00Z", accepted_by: null },
      })],
    });
    for (const source of ["lead", "override"] as const) {
      const onAssign = vi.fn();
      const onRequestCorrection = vi.fn();
      const target = accepted(source);
      renderPanel([target], "c:de", { onAssign, onRequestCorrection, canRequestCorrection: () => true, initial: { key: "c:de", stage: "review" } as RowPanelTarget });
      fireEvent.click(await within(panel()).findByRole("button", { name: "Assign a new review…" }));
      expect(onAssign).toHaveBeenCalledWith(target, "translation_review", { newReviewOfAccepted: true });
      fireEvent.click(within(panel()).getByRole("button", { name: "Request correction…" }));
      expect(onRequestCorrection).toHaveBeenCalledWith(target);
      cleanup();
    }
    renderPanel([accepted("package")], "c:de", { onAssign: vi.fn() });
    await within(panel()).findByText(/Accepted: marked as reviewed/);
    expect(within(panel()).queryByRole("button", { name: "Assign a new review…" })).toBeNull();
    expect(within(panel()).queryByRole("button", { name: "Request correction…" })).toBeNull();
  });

  it("quotes a rejecting review's reason under its Activity line", async () => {
    const { reviewRecord } = await import("../translationFixtures");
    vi.spyOn(api, "listTranslationReviews").mockResolvedValue([
      reviewRecord({ assignment_id: 8, document_id: "c-de", decision: "rejected", rationale: "Dosage is missing", categories: ["omission"] }),
    ]);
    const target = row({
      case_id: "c", language: "de",
      versions: [version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected" })],
      work: [work({ assignment_id: 8, document_id: "c-de", task: "translation_review", status: "submitted", person: ana2 })],
    });
    renderPanel([target], "c:de");
    const quote = await screen.findByText("“Dosage is missing”");
    expect(quote.closest("li")!.textContent).toMatch(/^Review: Ana Weber/);
    expect(within(quote.closest("li")!).getByText("Categories: Omission")).toBeTruthy();
  });

  it("shows a row outside the plan as Not planned with Plan…, which opens Details on its plan chips", async () => {
    const target = notInPlanRow("c", "de");
    renderPanel([target], "c:de", { plan: <span className="documents-plan-chips"><button type="button">Annotate, c · de</button></span> });
    expect(within(panel()).getByText("Not planned")).toBeTruthy();
    expect(await within(panel()).findByText("Nothing has happened yet.")).toBeTruthy();
    fireEvent.click(within(panel()).getByRole("button", { name: "Plan…" }));
    expect(navigations.at(-1)).toEqual({ key: "c:de", stage: undefined, tab: "details" });
    const plan = await within(panel()).findByRole("group", { name: "Plan" });
    await waitFor(() => expect(document.activeElement).toBe(within(plan).getByRole("button", { name: "Annotate, c · de" })));
  });
});

describe("tabs Activity · Versions (n) · Details", () => {
  it("switches tabs by click and arrows; Versions shows Text versions, Details the plan and technical details", async () => {
    rowData["case-107:de"] = historyData();
    renderPanel([historyRow()], "case-107:de", { planRevision: 4, plan: <button type="button">Review</button> });
    const tabs = within(panel()).getByRole("tablist", { name: "Details of case-107 · de" });
    expect(within(tabs).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Activity", "Versions (2)", "Details"]);
    fireEvent.click(within(tabs).getByRole("tab", { name: "Versions (2)" }));
    expect(navigations.at(-1)).toEqual({ key: "case-107:de", stage: undefined, tab: "versions" });
    const versions = await within(panel()).findByRole("tabpanel", { name: "Versions (2)" });
    const onV1 = within(versions).getByRole("list", { name: "Assignments on v1" });
    expect(within(onV1).getByText("ann-0005 · Annotation · moved to v2")).toBeTruthy();
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: "Versions (2)" }), { key: "ArrowRight" });
    expect(navigations.at(-1)?.tab).toBe("details");
    expect(document.activeElement).toBe(within(tabs).getByRole("tab", { name: "Details" }));
    const details = within(panel()).getByRole("tabpanel", { name: "Details" });
    expect(within(within(details).getByRole("group", { name: "Plan" })).getByRole("button", { name: "Review" })).toBeTruthy();
    expect(within(details).getByText("Plan revision").nextElementSibling!.textContent).toBe("4");
    for (const value of ["case-107-de", "case-107-de-v2", "s-a", "s-b"]) expect(details.textContent).toContain(value);
    expect(within(details).getByRole("heading", { name: "Problem reports (1)" })).toBeTruthy();
    expect(within(details).getByText(/Cut off · ann-0004/).textContent).toContain("Report: Open · Paused tasks: 0");
  });

  it("lists text versions with origin, status, chain name, work and per-version checkboxes", async () => {
    const s4 = scenarioS4();
    const target = s4.group.rows.find(entry => entry.language === "fr")!;
    rowData[rowKey(target.case_id, "fr")] = s4.submissions[rowKey(target.case_id, "fr")];
    const onToggleBulk = vi.fn();
    const tools: TextVersionsTools = {
      username: "lead", assignments: [], members: [], variants: new Map(), requiredLanguages: () => null,
      onAssignmentsChanged: vi.fn(), onShowTranslationReviews: vi.fn(), bulkSelected: new Set(["case-0305-fr-b"]), onToggleBulk,
    };
    const { onRoute } = renderPanel([target], rowKey(target.case_id, "fr"), { textVersionTools: tools, initial: { key: rowKey(target.case_id, "fr"), tab: "versions" } as RowPanelTarget });
    const list = (await within(panel()).findByRole("tabpanel")).querySelector(".text-versions") as HTMLElement;
    const items = within(list).getAllByRole("listitem").filter(entry => entry.classList.contains("text-version"));
    expect(items[0].querySelector(".text-version-head")!.textContent).toBe("Select Provider A v1 of case-0305 · fr for assignmentProvider A v1Machine translationAcceptedProvider A");
    const boxA = within(items[0]).getByRole("checkbox", { name: "Select Provider A v1 of case-0305 · fr for assignment" }) as HTMLInputElement;
    fireEvent.click(boxA);
    expect(onToggleBulk).toHaveBeenCalledWith("case-0305-fr-a");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Translation reviews for Provider A v1" }));
    expect(tools.onShowTranslationReviews).toHaveBeenCalledWith("case-0305-fr-a");
    fireEvent.click(within(items[1]).getByRole("link", { name: "View text Provider B v1 of case-0305 · fr" }));
    expect(onRoute).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-0305", variant: "case-0305-fr-b", documents: query });
  });

  it("labels acceptances and discarded versions in Versions and Details", async () => {
    const lead = recordedVersion({
      document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted",
      acceptance: { source: "lead", reason: "Checked by the clinic", accepted_at: "2026-10-20T11:40:00Z", accepted_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } },
    });
    const dropped = recordedVersion({
      document_id: "c-de-c", chain_id: "c-de-c", chain_name: "Provider C", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: "rejected",
      discarded: { reason: "Wrong language", discarded_at: "2026-10-19T08:00:00Z", discarded_by: { pseudonym: "ann-0002", display_name: "Project lead", is_me: false } },
    });
    const target = planRow("c", "de", stepOf("assign_annotation", { stage: "annotation" }), { versions: [lead, dropped], parallel_roots: true });
    renderPanel([target], "c:de", { initial: { key: "c:de", tab: "versions" } as RowPanelTarget });
    const versions = await within(panel()).findByRole("tabpanel");
    const items = [...versions.querySelectorAll(".text-version")] as HTMLElement[];
    expect(within(items[0]).getByText(`Accepted: reviewed outside Ontocurator · Project lead (ann-0002) · ${time("2026-10-20T11:40:00Z")} · Checked by the clinic`)).toBeTruthy();
    expect(within(items[1]).getByText(`Discarded · Project lead (ann-0002) · ${time("2026-10-19T08:00:00Z")} · Wrong language`)).toBeTruthy();
    // Parallel roots: the heading names the number of translations.
    expect(within(panel()).getByRole("heading", { level: 2 }).textContent).toBe("c · de 2 translations");
    fireEvent.click(within(panel()).getByRole("tab", { name: "Details" }));
    const details = within(panel()).getByRole("tabpanel", { name: "Details" });
    expect(details.textContent).toContain("Accepted: reviewed outside Ontocurator");
    expect(details.textContent).toContain("Discarded · Project lead (ann-0002)");
  });

  it("shows the review decision and Queried in a text version badge", async () => {
    const v1 = version({ document_id: "c-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", is_newest_in_chain: false });
    const v2 = version({ document_id: "c-de-v2", chain_id: "c-de", chain_name: "DeepL", version: 2, origin: "correction", derived_from: "c-de", translation_status: "reviewed", latest_review_decision: "query" });
    renderPanel([row({ case_id: "c", language: "de", versions: [v1, v2] })], "c:de", { initial: { key: "c:de", tab: "versions" } as RowPanelTarget });
    const versions = await within(panel()).findByRole("tabpanel");
    expect(within(versions).getByText("Correction of v1")).toBeTruthy();
    expect(within(versions).queryByText("Reviewed")).toBeNull();
    expect(within(versions).getByText("Queried").closest(".status-pill")!.className).toContain("status-pill--warning");
  });

  it("names the people on text version work with display name and pseudonym", () => {
    const target = row({ case_id: "c", language: "de", versions: [version({ document_id: "c-de" })], work: [
      work({ assignment_id: 1, document_id: "c-de", author_label: "ann-0004", status: "in_progress", person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }),
      work({ assignment_id: 2, document_id: "c-de", author_label: "ann-0005", status: "submitted" }),
    ] });
    render(<TextVersions row={target} projectKey="p" query={query} onNavigate={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Assignments on v1" });
    expect(within(list).getByText("Ana Weber (ann-0004) · Annotation · In progress")).toBeTruthy();
    expect(within(list).getByText("ann-0005 · Annotation · Submitted")).toBeTruthy();
  });
});

// ---- Page: entries, route, keys and the decision block ----

function mockPage(rows: DocumentRowView[][]) {
  const view = page(rows.map(entries => group(entries[0].case_id, entries)));
  vi.mocked(api.listDocumentRows).mockImplementation(async () => structuredClone(view));
}

/** The page with a real route state: Documents navigations update its query (as the app shell does). */
function renderDocuments(initial: ProjectDocumentsQuery) {
  const onNavigate = vi.fn();
  function Host() {
    const [current, setQuery] = useState(initial);
    return <DocumentsPage projectKey="p" query={current} canManage currentUser={{ username: "lead", pseudonym: "lead-0002" }} onNavigate={(route: Route, options) => {
      onNavigate(route, options);
      if (route.name === "projectDocuments") { const { name: _name, key: _key, ...rest } = route; setQuery(rest); }
    }} />;
  }
  return { ...render(<Host />), onNavigate };
}
const lastRoute = (onNavigate: ReturnType<typeof vi.fn>) => onNavigate.mock.calls.at(-1)?.[0] as Route;

describe("page", () => {
  beforeEach(() => {
    vi.spyOn(api, "listDocumentRows").mockResolvedValue(page([]));
    vi.spyOn(api, "finalPanel").mockImplementation(async (_key, caseId, language) => comparePanel(caseId, language));
    vi.spyOn(api, "listGuidelines").mockResolvedValue({ current: null, latest_version: null, versions: [], my_latest_seen: null });
    vi.spyOn(api, "getProjectSettings").mockResolvedValue({ languages: ["en", "de"] } as never);
    vi.spyOn(api, "listProjectDocuments").mockResolvedValue([]);
    vi.spyOn(api, "listCases").mockResolvedValue([]);
    vi.spyOn(api, "listAssignments").mockResolvedValue([]);
    vi.spyOn(api, "listMembers").mockResolvedValue([]);
    vi.spyOn(api, "recordDocumentsVisit").mockResolvedValue({ baseline_at: "2026-10-21T08:00:00Z" });
  });

  const progress = (caseId: string) => stagedRow(caseId, "de", { stages: { annotation: cell("in_progress", "running", { submitted: 0, total: 2, people: [ana, tom] }) } });

  it("the text name opens the panel unfiltered with focus on its heading; the active row is marked", async () => {
    mockPage([[progress("case-107")], [progress("case-108")]]);
    const { onNavigate } = renderDocuments({});
    const name = await screen.findByRole("button", { name: "Details, case-107 · de" });
    fireEvent.click(name);
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", panel: "case-107:de" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    expect(document.activeElement).toBe(within(aside).getByRole("heading", { level: 2 }));
    expect(name.closest("tr")!.getAttribute("aria-current")).toBe("true");
    expect(within(aside).queryByRole("button", { name: "Remove filter Annotation" })).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("a stage cell opens the panel filtered to its stage; another row's stage cell switches the same panel", async () => {
    mockPage([[progress("case-107")], [progress("case-108")]]);
    const { onNavigate } = renderDocuments({});
    fireEvent.click(await screen.findByRole("button", { name: "Annotation: 0 of 2 submitted. Show history, case-108 · de" }));
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", panel: "case-108:de", panel_stage: "annotation" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-108 · de" });
    expect(within(aside).getByRole("button", { name: "Remove filter Annotation" })).toBeTruthy();
    expect(within(aside).getByRole("button", { name: "Show all stages" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annotation: 0 of 2 submitted. Show history, case-107 · de" }));
    await waitFor(() => expect(aside.getAttribute("aria-label")).toBe("Details, case-107 · de"));
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(document.activeElement).toBe(within(aside).getByRole("heading", { level: 2 }));
  });

  it("round-trips panel, panel_stage and panel_tab; a tab click keeps the stage", async () => {
    mockPage([[progress("case-107")]]);
    const { onNavigate } = renderDocuments({ segment: "progress", panel: "case-107:de", panel_stage: "annotation", panel_tab: "versions" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    expect(within(aside).getByRole("tab", { name: "Versions (1)" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(aside).getByRole("tab", { name: "Activity" }));
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", segment: "progress", panel: "case-107:de", panel_stage: "annotation" });
    fireEvent.click(within(aside).getByRole("button", { name: "Close" }));
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", segment: "progress" });
  });

  it("opens the panel from a legacy open= link", async () => {
    mockPage([[progress("case-107")]]);
    const route = parseRoute("#/projects/p/documents?segment=progress&open=case-107%3Ade");
    const { name: _name, key: _key, ...legacy } = route as Extract<Route, { name: "projectDocuments" }>;
    renderDocuments(legacy);
    expect(await screen.findByRole("complementary", { name: "Details, case-107 · de" })).toBeTruthy();
  });

  it("J moves to the next visible row across case groups and keeps the stage filter", async () => {
    mockPage([[progress("case-107")], [progress("case-108")]]);
    const { onNavigate } = renderDocuments({ panel: "case-107:de", panel_stage: "annotation" });
    await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    fireEvent.keyDown(document.body, { key: "j" });
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", panel: "case-108:de", panel_stage: "annotation" });
    expect(await screen.findByRole("complementary", { name: "Details, case-108 · de" })).toBeTruthy();
  });

  it("Escape in the open filter popover closes only the popover", async () => {
    mockPage([[progress("case-107")]]);
    renderDocuments({ panel: "case-107:de" });
    await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    const filter = screen.getByRole("button", { name: "Filter" });
    fireEvent.click(filter);
    const popover = screen.getByRole("dialog", { name: "Filter" });
    fireEvent.keyDown(document.activeElement ?? popover, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filter" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Details, case-107 · de" })).toBeTruthy();
  });

  it("asks Discard your unsaved choice? before switching away from an open Consolidate…", async () => {
    const first = chooseRow("case-107", "de");
    const second = chooseRow("case-108", "de");
    mockPage([[first], [second]]);
    vi.spyOn(api, "listMembers").mockResolvedValue([]);
    const { onNavigate } = renderDocuments({ panel: "case-107:de" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    fireEvent.click(await within(aside).findByRole("button", { name: "Consolidate…" }));
    const calls = onNavigate.mock.calls.length;
    fireEvent.keyDown(document.body, { key: "j" });
    expect(await within(aside).findByRole("heading", { name: "Discard your unsaved choice?" })).toBeTruthy();
    expect(onNavigate.mock.calls.length).toBe(calls);
    fireEvent.click(within(aside).getByRole("button", { name: "Keep editing" }));
    expect(within(aside).queryByRole("heading", { name: "Discard your unsaved choice?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details, case-108 · de" }));
    fireEvent.click(await within(aside).findByRole("button", { name: "Discard" }));
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p", panel: "case-108:de" });
  });

  it("puts the decision block on top for a row with a final decision and none for other rows", async () => {
    mockPage([[chooseRow("case-107", "de")], [progress("case-108")]]);
    vi.mocked(api.finalPanel).mockResolvedValue(finalPanel());
    renderDocuments({ panel: "case-107:de" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-107 · de" });
    expect(within(aside).getByRole("region", { name: "Final result" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(aside.getAttribute("aria-label")).toBe("Details, case-108 · de"));
    expect(within(aside).queryByRole("region", { name: "Final result" })).toBeNull();
  });

  it("cards: Details opens the full-screen sheet with Back", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(max-width: 699px)", media, addEventListener: () => {}, removeEventListener: () => {} }));
    mockPage([[progress("case-107")]]);
    const { onNavigate } = renderDocuments({});
    fireEvent.click(await screen.findByRole("button", { name: "Details, case-107 · de" }));
    const sheet = await screen.findByRole("dialog", { name: "Details, case-107 · de" });
    expect(sheet.classList.contains("row-panel-sheet")).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(lastRoute(onNavigate)).toEqual({ name: "projectDocuments", key: "p" });
  });

  it("keeps the not-planned wording and the final of a decided row out of the decision block", async () => {
    const decided = row({ case_id: "case-110", language: "de", final: final({ case_id: "case-110", language: "de", document_id: "case-110-de", submission_id: "s-1" }) });
    mockPage([[decided, notInPlanRow("case-110", "fr")]]);
    renderDocuments({ panel: "case-110:fr" });
    const aside = await screen.findByRole("complementary", { name: "Details, case-110 · fr" });
    expect(within(aside).getByText("Not planned")).toBeTruthy();
    expect(within(aside).getByRole("button", { name: "Plan…" })).toBeTruthy();
    expect(within(aside).queryByRole("region", { name: "Final result" })).toBeNull();
  });
});


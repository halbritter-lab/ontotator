/** The text card (U3): path on top, the selected part below, History and Text details inside, ‹ › and J / K. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type DocumentRowView } from "../../src/api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../../src/app/router";
import { formatTime } from "../../src/app/submissionLabels";
import { TextCard, type TextCardProps } from "../../src/documents/textCard/TextCard";
import type { SegmentId } from "../../src/documents/textCard/cardModel";
import { annotateItem, cardRow } from "./cardFixtures";
import { final, submission, submissions, version, work } from "./fixtures";
import { ana, cell, tom } from "./tableFixtures";

const now = new Date("2026-10-21T12:00:00");
const query: ProjectDocumentsQuery = { decision: "all", panel: "case-200:de" };
const reportRoute = (reportId: string): Route => ({ name: "projectProblemReport", key: "p", reportId, documents: query });

beforeEach(() => {
  vi.spyOn(api, "getRowSubmissions").mockImplementation(async (_key, caseId, language) => submissions(caseId, language, {
    submissions: [submission({ submission_id: "s-ana", document_id: "case-200-de", author_label: "ann-0003", author: ana })],
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** case-200 de: 17 proposals, 1 annotator · max 2 (Tom, not started), translation not reviewed (optional). */
function assignRow(overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  return cardRow({
    review: cell("not_planned", "none"),
    annotation: cell("partly_assigned", "todo", { assigned: 1, target: 2 }),
    final: cell("after_annotation", "waiting"),
  }, {
    proposal_count: 17,
    annotation_mode: { mode: "proposals", source: "project", locked: true, override: null, proposal_count: 17 },
    work: [annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004", assigned_at: "2026-10-20T16:44:00" })],
    ...overrides,
  });
}

type Handlers = Pick<TextCardProps, "onStep" | "onClose" | "onNavigate" | "onAssign" | "onChangePlan" | "onChanged">;

function Harness({ initialSegment, initialView = "path", ...props }: Partial<TextCardProps> & Handlers & { initialSegment?: SegmentId; initialView?: TextCardProps["view"] }): JSX.Element {
  const [segment, setSegment] = useState<SegmentId | undefined>(initialSegment);
  const [view, setView] = useState(initialView);
  const row = props.row ?? assignRow();
  return <TextCard projectKey="p" row={row} rows={[row]} query={query} reportRoute={reportRoute} canManage me={{ username: "lead" }} now={now}
    segment={segment} view={view} onSegment={setSegment} onView={setView} {...props} />;
}

function renderCard(props: Partial<TextCardProps> & { initialSegment?: SegmentId; initialView?: TextCardProps["view"] } = {}) {
  const handlers = {
    onStep: vi.fn(), onClose: vi.fn(), onNavigate: vi.fn(), onAssign: vi.fn(), onChangePlan: vi.fn(), onChanged: vi.fn(),
  };
  render(<Harness {...handlers} {...props} />);
  return handlers;
}

const card = () => screen.getByRole("dialog", { name: "case-200 de" });
const segmentButton = (title: string) => within(card()).getByRole("button", { name: new RegExp(`^${title} `) });

describe("path", () => {
  it("opens on the segment that needs work now", () => {
    renderCard();
    expect(segmentButton("Annotation").getAttribute("aria-current")).toBe("step");
    expect(segmentButton("Annotation").textContent).toContain("1 annotator · max 2");
    expect(segmentButton("Translation").textContent).toContain("not reviewed, optional");
    expect(segmentButton("Finalization").textContent).toContain("waiting");
    expect(within(card()).getByRole("heading", { name: "Annotation" })).toBeTruthy();
  });

  it("the path switches the part below", () => {
    renderCard();
    fireEvent.click(segmentButton("Translation"));
    expect(segmentButton("Translation").getAttribute("aria-current")).toBe("step");
    expect(within(card()).getByRole("heading", { name: "Translation" })).toBeTruthy();
    expect(within(card()).queryByRole("heading", { name: "Annotation" })).toBeNull();
    fireEvent.click(segmentButton("Finalization"));
    expect(within(card()).getByText("Starts when all 2 annotations are submitted: compare the results, consolidate the differences, then accept the result.")).toBeTruthy();
  });
});

describe("header", () => {
  it("the header shows the version only when the text has more versions", () => {
    renderCard();
    expect(within(card()).queryByText(/^v1/)).toBeNull();
    cleanup();
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de" }),
    ];
    renderCard({ row: assignRow({ versions, work: [annotateItem({ assignment_id: 1, person: tom, version: 1 })] }) });
    expect(within(card()).getByText("v2, newer than the annotations")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ versions, work: [annotateItem({ assignment_id: 1, person: tom, version: 2, document_id: "case-200-de-v2" })] }) });
    expect(within(card()).getByText("v2")).toBeTruthy();
  });

  it("‹ › step through the table order", () => {
    const { onStep } = renderCard();
    fireEvent.click(within(card()).getByRole("button", { name: "Next text" }));
    expect(onStep).toHaveBeenLastCalledWith(1);
    fireEvent.click(within(card()).getByRole("button", { name: "Previous text" }));
    expect(onStep).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" });
    expect(onStep).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "k" });
    expect(onStep).toHaveBeenLastCalledWith(-1);
    expect(onStep).toHaveBeenCalledTimes(4);
  });

  it("J / K do nothing while another dialog is on top of the card", () => {
    const { onStep } = renderCard({ initialSegment: "annotation" });
    fireEvent.click(within(card()).getByRole("button", { name: "Tom Reis, not started: actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove (draft is discarded)" }));
    const confirm = screen.getByRole("dialog", { name: "Remove assignment?" });
    fireEvent.keyDown(document.activeElement ?? confirm, { key: "j" });
    fireEvent.keyDown(document.activeElement ?? confirm, { key: "k" });
    expect(onStep).not.toHaveBeenCalled();
  });

  it("Esc and ✕ close without changing the selection", () => {
    const { onClose, onStep } = renderCard();
    fireEvent.keyDown(document.activeElement ?? card(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card()).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("narrow screens get a full-width sheet", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("max-width"), addEventListener: () => {}, removeEventListener: () => {} }));
    renderCard();
    expect(card().classList.contains("text-card--sheet")).toBe(true);
    cleanup();
    vi.unstubAllGlobals();
    renderCard();
    expect(card().classList.contains("text-card--sheet")).toBe(false);
  });
});

describe("annotation part", () => {
  it("the header's Open text opens the text view with the proposals; the part counts the annotators", () => {
    const { onNavigate } = renderCard();
    const link = within(card()).getByRole("link", { name: "Open text, case-200 de" });
    const route: Route = { name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "proposals", documents: query };
    expect(link.getAttribute("href")).toBe(routeHref(route));
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith(route);
    expect(within(card()).queryByRole("link", { name: "View proposals" })).toBeNull();
    expect(within(card()).getByText("1 of 2 annotators assigned.")).toBeTruthy();
    const chip = within(card()).getByRole("button", { name: "Tom Reis, not started: actions" });
    expect(chip.textContent).toContain("assigned yesterday");
    expect(within(card()).queryByRole("button", { name: "Remove Tom Reis" })).toBeNull();
  });

  it("says why a text without proposals is annotated from scratch; Open text shows no proposals", () => {
    renderCard({ row: assignRow({ proposal_count: 0, annotation_mode: { mode: "scratch", source: "no_proposals", locked: false, proposal_count: 0 } }) });
    expect(within(card()).getByText("Annotation, from scratch")).toBeTruthy();
    expect(within(card()).getByText("This text has no tool proposals, so it is annotated from scratch.")).toBeTruthy();
    expect(within(card()).getByRole("link", { name: "Open text, case-200 de" }).getAttribute("href")).not.toContain("proposals");
  });

  it("the Annotation part shows the proposal count in both modes", () => {
    const mode = (name: "proposals" | "scratch", count = 17) => ({ mode: name, source: "project" as const, locked: false, override: null, proposal_count: count });
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    renderCard({ row: assignRow({ annotation_mode: mode("proposals") }) });
    expect(within(part()).getByText("17 tool proposals")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ annotation_mode: mode("scratch") }) });
    expect(within(part()).getByText("17 tool proposals")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ proposal_count: 0, annotation_mode: mode("proposals", 0) }) });
    expect(within(part()).queryByText(/tool proposals?$/)).toBeNull();
    cleanup();
    renderCard({ row: assignRow({ annotation_mode: { mode: "scratch", source: "no_proposals", locked: false, override: null, proposal_count: 17 } }) });
    expect(within(part()).queryByText(/tool proposals?$/)).toBeNull();
  });

  it("shows Translation not reviewed yet only for a flagged row", () => {
    const part = () => within(card()).getByRole("region", { name: "Annotation" });
    renderCard({ row: assignRow({ unreviewed_translation: true }) });
    expect(within(part()).getByText("Translation not reviewed yet")).toBeTruthy();
    cleanup();
    renderCard({ row: assignRow({ unreviewed_translation: false }) });
    expect(within(part()).queryByText("Translation not reviewed yet")).toBeNull();
  });

  it("one Assign annotators… opens the assign dialog; unavailable at the limit", () => {
    const { onAssign } = renderCard();
    expect(within(card()).queryByRole("button", { name: "+ Person" })).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Annotate from proposals myself" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Assign annotators…" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-200" }), "annotate");
    cleanup();
    const full = renderCard({ row: assignRow({ stages: { review: cell("not_planned", "none"), annotation: cell("in_progress", "running", { assigned: 2, target: 2, submitted: 0, total: 2 }), final: cell("after_annotation", "waiting") } }) });
    const button = screen.getByRole("button", { name: "Assign annotators…" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("2 of 2 annotators assigned.");
    fireEvent.click(button);
    expect(full.onAssign).not.toHaveBeenCalled();
    // At the limit the chip menu offers no "Assign another person".
    fireEvent.click(within(card()).getByRole("button", { name: "Tom Reis, not started: actions" }));
    expect(screen.queryByRole("menuitem", { name: /^Assign another person/ })).toBeNull();
  });

  it("below the limit a chip offers Assign another person", () => {
    const { onAssign } = renderCard();
    fireEvent.click(within(card()).getByRole("button", { name: "Tom Reis, not started: actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign another person (Tom Reis keeps working)" }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ case_id: "case-200" }), "annotate");
  });

  it("after removing a person, focus moves to Assign annotators…", async () => {
    vi.spyOn(api, "removeAssignment").mockResolvedValue({} as Awaited<ReturnType<typeof api.removeAssignment>>);
    renderCard({ initialSegment: "annotation" });
    fireEvent.click(within(card()).getByRole("button", { name: "Tom Reis, not started: actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove (draft is discarded)" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove assignment?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card()).getByRole("button", { name: "Assign annotators…" })));
  });

  it("no chip offers a review of a submitted annotation", async () => {
    const row = assignRow({
      stages: { review: cell("not_planned", "none"), annotation: cell("in_progress", "running", { assigned: 2, target: 2, submitted: 1, total: 2 }), final: cell("after_annotation", "waiting") },
      work: [
        annotateItem({ assignment_id: 1, person: tom, author_label: "ann-0004" }),
        annotateItem({ assignment_id: 2, person: ana, author_label: "ann-0003", status: "submitted" }),
      ],
    });
    const { onNavigate } = renderCard({ row });
    const part = within(card()).getByRole("heading", { name: "Annotation" }).closest("section")!;
    expect(within(part).queryByRole("button", { name: /review/i })).toBeNull();
    // The submitted person's name opens the text view with their layer; the chip has nothing to change.
    const link = await within(card()).findByRole("link", { name: "Ana Weber" });
    const chip = link.closest(".assignment-chip") as HTMLElement;
    expect(chip.textContent).toContain("submitted");
    expect(within(chip).queryByRole("button")).toBeNull();
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "submission:s-ana", documents: query });
  });

  it("people without lead rights see no menus and no Assign annotators…", () => {
    renderCard({ canManage: false });
    expect(within(card()).queryByRole("button", { name: /: actions$/ })).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Assign annotators…" })).toBeNull();
  });
});

describe("translation part", () => {
  it("an unassigned review of a machine translation is the one primary next step; Compare with source follows (issue 129, U5)", () => {
    const row = cardRow({ review: cell("unassigned", "todo", { version: 1, note: "machine_translation" }), annotation: cell("after_review", "waiting"), final: cell("after_review", "waiting") }, {
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "ready_for_review" })],
      work: [],
    });
    const { onAssign } = renderCard({ row, initialSegment: "translation" });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    const next = within(part).getByRole("group", { name: "Next step: assign someone to review this machine translation." });
    const assign = within(next).getByRole("button", { name: "Assign review…" });
    expect(assign.className).toContain("btn-primary");
    expect(within(part).getAllByRole("button", { name: "Assign review…" })).toHaveLength(1);
    expect(part.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(within(next).queryByRole("link", { name: "Compare with source" })).toBeNull();
    expect(within(part).getByRole("link", { name: "Compare with source" })).toBeTruthy();
    fireEvent.click(assign);
    expect(onAssign).toHaveBeenCalledWith(row, "translation_review");
  });

  it("names the open reviewers and the actions, without a separate version line", () => {
    const row = assignRow({
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "ready_for_review" })],
      work: [work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "in_progress", author_label: "ann-0003", person: ana })],
    });
    const { onAssign, onNavigate } = renderCard({ row, initialSegment: "translation" });
    expect(within(card()).queryByText(/^Version 1/)).toBeNull();
    expect(within(card()).queryByText("Automatic check passed")).toBeNull();
    expect(within(card()).getByText("Ready for review")).toBeTruthy();
    expect(within(card()).getByText("Ana Weber").closest(".assignment-chip")!.textContent).toContain("in progress");
    fireEvent.click(within(card()).getByRole("button", { name: "Assign review…" }));
    expect(onAssign).toHaveBeenCalledWith(row, "translation_review");
    fireEvent.click(within(card()).getByRole("link", { name: "Compare with source" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", compare: "case-200-en", documents: query });
  });

  it("after a review: the newest version per chain, older ones collapsed, one Request correction…, submitted reviews under their version", () => {
    const versions = [
      version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", translation_status: "reviewed", chain_name: "m1", is_newest_in_chain: false }),
      version({ document_id: "case-200-de-v2", version: 2, origin: "correction", derived_from: "case-200-de", chain_id: "case-200-de", chain_name: "m1", translation_status: "accepted" }),
      version({ document_id: "case-200-mt", origin: "machine_translation", derived_from: "case-200-en", chain_name: "mt", translation_status: "ready_for_review" }),
    ];
    const reviewed = work({ assignment_id: 5, document_id: "case-200-de", task: "translation_review", status: "submitted", author_label: "ann-0003", person: ana });
    const open = work({ assignment_id: 6, document_id: "case-200-mt", task: "translation_review", status: "open", author_label: "ann-0004", person: tom });
    const variant = { document_id: "case-200-de-v2", translation_status: "accepted" } as never;
    const onRequestCorrection = vi.fn();
    const assignment = (id: number, documentId: string, status: string) => ({ id, document_id: documentId, status, task: "translation_review", pseudonym: "ann-0004", username: "tom", project_key: "p", revoked_at: null }) as never;
    const textVersionTools = { username: "lead", members: [], assignments: [assignment(6, "case-200-mt", "open"), assignment(5, "case-200-de", "submitted")],
      variants: new Map([["case-200-de-v2", variant]]), requiredLanguages: () => ["de"], onAssignmentsChanged: vi.fn(), onRequestCorrection };
    const row = assignRow({ versions, parallel_roots: true, work: [reviewed, open] });
    renderCard({ row, initialSegment: "translation", textVersionTools });
    const part = within(card()).getByRole("heading", { name: "Translation" }).closest("section")!;
    // Only the open reviewer is a chip; its menu holds Reassign and Remove.
    expect(within(part).queryByText("Ana Weber")?.closest(".assignment-chip") ?? null).toBeNull();
    fireEvent.click(within(part).getByRole("button", { name: "Tom Reis, not started: actions" }));
    expect(screen.getByRole("menuitem", { name: /^Reassign to someone else…/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Remove assignment…" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    const older = within(part).getByText("Older versions (1)").closest("details")!;
    expect(older.open).toBe(false);
    expect(within(older).getByText("m1 v1")).toBeTruthy();
    expect(within(part).getAllByRole("button", { name: "Request correction…" })).toHaveLength(1);
    fireEvent.click(within(part).getByRole("button", { name: "Request correction…" }));
    expect(onRequestCorrection).toHaveBeenCalledWith(row, variant);
    expect(within(part).queryByRole("button", { name: "Request translation correction" })).toBeNull();
  });

  it("calls a native text the source text and a failed check failed", () => {
    renderCard({ row: assignRow({ is_source: true, versions: [version({ document_id: "case-200-de" })] }), initialSegment: "translation" });
    expect(within(card()).getByText("Source text")).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Assign review…" })).toBeNull();
    cleanup();
    renderCard({ row: assignRow({ versions: [version({ document_id: "case-200-de", origin: "machine_translation", translation_status: "automatic_check_failed" })] }), initialSegment: "translation" });
    expect(within(card()).getByText("Check failed")).toBeTruthy();
  });
});

describe("finalization part", () => {
  it("the finalization part embeds the decision block", () => {
    renderCard({ initialSegment: "finalization", decision: <section aria-label="Decision">Compare results…</section> });
    expect(within(card()).getByRole("region", { name: "Decision" })).toBeTruthy();
  });

  it("opens the final result", () => {
    const chosen = final({ case_id: "case-200", language: "de", document_id: "case-200-de", submission_id: "s-final" });
    const row = assignRow({ final: chosen, stages: { review: cell("accepted", "done"), annotation: cell("submitted", "done", { submitted: 2, total: 2 }), final: cell("final", "done") } });
    const { onNavigate } = renderCard({ row });
    expect(segmentButton("Finalization").getAttribute("aria-current")).toBe("step");
    fireEvent.click(within(card()).getByRole("link", { name: "Open result" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectCase", key: "p", caseId: "case-200", variant: "case-200-de", show: "final:s-final", documents: query });
  });
});

describe("footer", () => {
  it("History and Text details open inside the card with Back", async () => {
    renderCard();
    fireEvent.click(await within(card()).findByRole("button", { name: /^History \(\d+\)$/ }));
    expect(within(card()).getByRole("list", { name: "Activity" })).toBeTruthy();
    expect(within(card()).queryByRole("navigation", { name: "Text path" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    expect(within(card()).getByRole("navigation", { name: "Text path" })).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Details" }));
    expect(await within(card()).findByRole("heading", { name: "Technical details" })).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    expect(within(card()).getByRole("navigation", { name: "Text path" })).toBeTruthy();
  });

  it("no Change plan… in the footer; a text outside the plan offers Add to plan… (the dialog)", () => {
    renderCard({ row: assignRow() });
    expect(within(card()).queryByRole("button", { name: "Change plan…" })).toBeNull();
    expect(within(card()).queryByText("This text is not worked on.")).toBeNull();
    cleanup();
    const outside = { ...assignRow(), in_plan: false } as DocumentRowView;
    const { onChangePlan } = renderCard({ row: outside });
    expect(within(card()).getByText("This text is not worked on.")).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: "Add to plan…" }));
    expect(onChangePlan).toHaveBeenCalledWith(outside);
  });

  it("has no tabs", () => {
    renderCard();
    expect(within(card()).queryByRole("tablist")).toBeNull();
  });
});

describe("problem reports (from the row panel)", () => {
  type RowReport = NonNullable<DocumentRowView["problem_reports"]>[number];
  const report = (overrides: Partial<RowReport> & Pick<RowReport, "report_id">): RowReport =>
    ({ title: "Text is cut off", reporter_label: "ann-0004", created_at: "2026-10-19T08:00:00Z", state: "open", active_hold_count: 1, ...overrides });

  it("lists every problem report of the row, open and closed, under Text details", async () => {
    const { onNavigate } = renderCard({ initialView: "details", row: assignRow({ problem_reports: [
      report({ report_id: "r-2", title: "Wrong language…", created_at: "2026-10-19T10:00:00Z", state: "withdrawn", active_hold_count: 0 }),
      report({ report_id: "r-1", state: "resolved", active_hold_count: 1 }),
    ] }) });
    const section = (await within(card()).findByRole("heading", { name: "Problem reports (2)" })).closest("section")!;
    const items = within(section).getAllByRole("listitem");
    expect(items.map(item => item.textContent)).toEqual([
      `Wrong language…, ann-0004, ${formatTime("2026-10-19T10:00:00Z", { now })}, Report: Withdrawn, Paused tasks: 0, Open report`,
      `Text is cut off, ann-0004, ${formatTime("2026-10-19T08:00:00Z", { now })}, Report: Closed, Paused tasks: 1, Open report`,
    ]);
    fireEvent.click(within(items[0]).getByRole("link", { name: "Open report" }));
    expect(onNavigate).toHaveBeenCalledWith(reportRoute("r-2"));
    expect(card().querySelector(".text-card-banner")).toBeNull();
  });

  it("banners open reports above the path", () => {
    const { onNavigate } = renderCard({ row: assignRow({ problem_reports: [report({ report_id: "r-3" }), report({ report_id: "r-4", title: "Second" })] }) });
    const banner = card().querySelector<HTMLElement>(".text-card-banner")!;
    expect(banner.textContent).toBe("2 open problem reports, Open");
    fireEvent.click(within(banner).getByRole("link", { name: "Open problem report, Text is cut off" }));
    expect(onNavigate).toHaveBeenCalledWith(reportRoute("r-3"));
  });
});

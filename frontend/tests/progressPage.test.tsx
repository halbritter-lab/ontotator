import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, AuthError, type DocumentLinkQuery, type ProjectProgress } from "../src/api/client";
import { ProgressPage } from "../src/admin/ProgressPage";
import { settings } from "./projectFixtures";

const REVIEW_ON = { plan: ["review", "review_and_annotate"] } satisfies DocumentLinkQuery;
const ANNOTATE_ON = { plan: ["annotate", "review_and_annotate"] } satisfies DocumentLinkQuery;
const progress: ProjectProgress = {
  totals: { documents: 9, unassigned: 3, open: 12, in_progress: 4, submitted: 8, reopened: 2 },
  people: [],
  documents: [{ document_id: "old-document", language: "de", position: null, assignees: [] }],
  lede: { cases: 10, translations_to_review: 5, versions_to_annotate: 11, not_in_plan: 6, needs_decision: 2, to_assign: 6 },
  stages: {
    translation_review: { scope: "review", done: 2, total: 7, counts: { to_assign: 3, in_review: 2, check_failed: 1, check_failed_with_reviewer: 1, rejected_or_queried: 0, accepted: 2 }, links: {
      to_assign: { ...REVIEW_ON, step: ["assign_translation_review"] },
      in_review: { ...REVIEW_ON, step: ["translation_review_in_progress"] },
      check_failed: { ...REVIEW_ON, translation_status: "automatic_check_failed" },
      check_failed_with_reviewer: { ...REVIEW_ON, step: ["translation_review_in_progress"], translation_status: "automatic_check_failed" },
      rejected_or_queried: { ...REVIEW_ON, step: ["resolve_rejected", "resolve_queried"] },
      accepted: { ...REVIEW_ON, translation_status: "accepted" },
    } },
    annotation: { scope: "annotate", done: 2, total: 11, counts: { waiting_for_review: 4, to_assign: 3, in_progress: 1, paused: 1, submitted: 2 }, links: {
      waiting_for_review: { ...ANNOTATE_ON, step: ["translation_review_in_progress", "waiting_for_translation_review"] },
      to_assign: { ...ANNOTATE_ON, step: ["assign_annotation"] },
      in_progress: { ...ANNOTATE_ON, step: ["annotation_in_progress", "consolidation_in_progress"], paused: "no" },
      paused: { ...ANNOTATE_ON, paused: "yes" },
      submitted: { ...ANNOTATE_ON, stage: ["final", "done"], paused: "no" },
    } },
    final: { scope: "annotate", done: 1, total: 11, counts: { not_ready: 9, to_choose: 1, to_confirm: 0, final: 1, would_be_omitted: 10 }, links: {
      not_ready: { ...ANNOTATE_ON, stage: ["translation_review", "annotation"] },
      to_choose: { ...ANNOTATE_ON, step: ["choose_final"] },
      to_confirm: { ...ANNOTATE_ON, step: ["confirm_final"] },
      final: { ...ANNOTATE_ON, final: "any" },
      would_be_omitted: { ...ANNOTATE_ON, final: "none" },
    } },
  },
  workload: [
    { person: { pseudonym: "ann-0005", display_name: "Second annotator", is_me: false }, username: "second", translation_reviews_open: 0, annotations_open: 1, reviews_open: 0, paused: 0, submitted: 1 },
    { person: { pseudonym: "ann-0003", display_name: "Translation reviewer", is_me: false }, username: "reviewer", translation_reviews_open: 2, annotations_open: 0, reviews_open: 0, paused: 0, submitted: 1 },
    { person: { pseudonym: "ann-0002", display_name: "Lead", is_me: true }, username: "lead", translation_reviews_open: 0, annotations_open: 1, reviews_open: 0, paused: 1, submitted: 0 },
    { person: { pseudonym: "ann-0006", display_name: null, is_me: false }, username: "former", translation_reviews_open: 0, annotations_open: 0, reviews_open: 0, paused: 0, submitted: 3 },
  ],
};

beforeEach(() => {
  vi.spyOn(api, "getProgress").mockResolvedValue(progress);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ ...settings, annotations_per_text: 1 });
  vi.spyOn(api, "listDocumentRows");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pipeline = async () => screen.findByRole("list", { name: "Pipeline" });
const card = (name: string) => screen.getByRole("region", { name });

it("renders the lede with links to the bar segments", async () => {
  const navigate = vi.fn();
  render(<ProgressPage projectKey="p" onNavigate={navigate} />);
  await pipeline();
  expect(screen.getByText("10 cases, 5 translations to review, 11 language versions to annotate (6 not in plan).", { exact: false })).toBeTruthy();
  const decision = screen.getByRole("link", { name: "2 need your decision" });
  expect(decision.getAttribute("href")).toBe("#/projects/p/documents?segment=decision");
  expect(screen.getByRole("link", { name: "6 to assign" }).getAttribute("href")).toBe("#/projects/p/documents?segment=assign");
  expect(screen.getByText(/updated \d\d:\d\d/)).toBeTruthy();
  fireEvent.click(decision);
  expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", segment: "decision" });
  expect(api.listDocumentRows).not.toHaveBeenCalled();
});

it("renders three stage cards as an ordered list with decorative arrows", async () => {
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  const list = await pipeline();
  expect(list.tagName).toBe("OL");
  const items = Array.from(list.children) as HTMLElement[];
  items.forEach(item => expect(item.tagName).toBe("LI"));
  expect(items).toHaveLength(3);
  expect(items.map(item => within(item).getByRole("heading").textContent)).toEqual(["Translation review", "Annotation", "Final result"]);
  const arrows = list.querySelectorAll(".progress-arrow");
  expect(arrows).toHaveLength(2);
  arrows.forEach(arrow => expect(arrow.getAttribute("aria-hidden")).toBe("true"));
  expect(within(card("Translation review")).getByText("7 translations selected for review")).toBeTruthy();
  expect(within(card("Translation review")).getByText("2 of 7", { exact: false }).closest("p")?.textContent).toBe("2 of 7 accepted");
  expect(within(card("Annotation")).getByText("11 language versions selected")).toBeTruthy();
  expect(within(card("Annotation")).getByText("2 of 11", { exact: false }).closest("p")?.textContent).toBe("2 of 11 annotated");
  expect(within(card("Final result")).getByText("1 of 11", { exact: false }).closest("p")?.textContent).toBe("1 of 11 final");
  for (const meter of list.querySelectorAll(".progress-meter")) expect(meter.getAttribute("aria-hidden")).toBe("true");
});

it("links every count to the server's query", async () => {
  const navigate = vi.fn();
  render(<ProgressPage projectKey="p" onNavigate={navigate} />);
  await pipeline();
  const href = (name: string, label: string) => within(card(name)).getByRole("link", { name: label }).getAttribute("href");
  const review = "plan=review,review_and_annotate", annotate = "plan=annotate,review_and_annotate";
  expect(href("Translation review", "To assign: 3")).toBe(`#/projects/p/documents?step=assign_translation_review&${review}`);
  expect(href("Translation review", "Check failed, with reviewer: 1"))
    .toBe(`#/projects/p/documents?translation_status=automatic_check_failed&step=translation_review_in_progress&${review}`);
  expect(href("Translation review", "Rejected or queried, your decision: 0")).toBe(`#/projects/p/documents?step=resolve_rejected,resolve_queried&${review}`);
  expect(href("Translation review", "Accepted: 2")).toBe(`#/projects/p/documents?translation_status=accepted&${review}`);
  expect(href("Annotation", "Waiting for translation review: 4")).toBe(`#/projects/p/documents?step=translation_review_in_progress,waiting_for_translation_review&${annotate}`);
  expect(href("Annotation", "In progress: 1")).toBe(`#/projects/p/documents?step=annotation_in_progress,consolidation_in_progress&${annotate}&paused=no`);
  expect(href("Annotation", "Paused by a problem report: 1")).toBe(`#/projects/p/documents?${annotate}&paused=yes`);
  expect(href("Annotation", "Submitted: 2")).toBe(`#/projects/p/documents?stage=final,done&${annotate}&paused=no`);
  expect(href("Final result", "Not ready (work open): 9")).toBe(`#/projects/p/documents?stage=translation_review,annotation&${annotate}`);
  expect(href("Final result", "To choose, your decision: 1")).toBe(`#/projects/p/documents?step=choose_final&${annotate}`);
  expect(href("Final result", "Final: 1")).toBe(`#/projects/p/documents?final=any&${annotate}`);
  const exportLink = within(card("Final result")).getByRole("link", { name: "Export final results…" });
  expect(exportLink.getAttribute("href")).toBe("#/projects/p/export");
  expect(exportLink.parentElement?.textContent).toContain("(1 final, 10 would be omitted)");
  fireEvent.click(within(card("Translation review")).getByRole("link", { name: "Rejected or queried, your decision: 0" }));
  expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", plan: "review,review_and_annotate", step: "resolve_rejected,resolve_queried" });
  fireEvent.click(exportLink);
  expect(navigate).toHaveBeenCalledWith({ name: "projectExport", key: "p" });
});

it("shows a count without a server query as text", async () => {
  const { links: _links, ...review } = progress.stages!.translation_review;
  vi.mocked(api.getProgress).mockResolvedValueOnce({ ...progress, stages: { ...progress.stages!, translation_review: review } });
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  await pipeline();
  expect(within(card("Translation review")).queryByRole("link", { name: "To assign: 3" })).toBeNull();
  expect(within(card("Translation review")).getByText("To assign").closest("li")?.textContent).toBe("To assign3");
});

it("mutes zero counts", async () => {
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  await pipeline();
  const zero = within(card("Translation review")).getByRole("link", { name: "Rejected or queried, your decision: 0" });
  expect(zero.closest("li")?.className).toContain("progress-count--zero");
  const nonZero = within(card("Translation review")).getByRole("link", { name: "Accepted: 2" });
  expect(nonZero.closest("li")?.className).not.toContain("progress-count--zero");
});

it("renders People sorted by open work in the identity format, linked by owner", async () => {
  const navigate = vi.fn();
  render(<ProgressPage projectKey="p" onNavigate={navigate} />);
  const table = await screen.findByRole("table", { name: "People" });
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent))
    .toEqual(["Person", "Translation reviews open", "Annotations open", "Reviews open", "Paused", "Submitted"]);
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map(row => within(row).getByRole("rowheader").textContent)).toEqual([
    "Translation reviewer (ann-0003)", "Lead (ann-0002, you)", "Second annotator (ann-0005)", "ann-0006",
  ]);
  expect(rows[0].textContent).toBe("Translation reviewer (ann-0003)20001");
  expect(table.textContent).not.toContain("reviewer\u0000");
  expect(table.textContent).not.toMatch(/\bsecond\b|\bformer\b/);
  const link = within(rows[0]).getByRole("link", { name: "Translation reviewer (ann-0003)" });
  expect(link.getAttribute("href")).toBe("#/projects/p/documents?owner=ann-0003");
  fireEvent.click(link);
  expect(navigate).toHaveBeenCalledWith({ name: "projectDocuments", key: "p", owner: "ann-0003" });
  expect(progress.workload?.[0].username).toBe("second");
});

it("shows skeleton cards while loading and Error with Retry", async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(api.getProgress).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  const loading = screen.getByRole("status");
  expect(loading.textContent).toContain("Loading progress");
  expect(document.querySelectorAll(".progress-stage--skeleton")).toHaveLength(3);
  await act(async () => { reject(new ApiError(500, "boom", "INTERNAL")); });
  expect(document.querySelectorAll(".progress-stage--skeleton")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await pipeline();
  expect(api.getProgress).toHaveBeenCalledTimes(2);
});

it("shows No texts yet for an empty project and no access on refusal", async () => {
  vi.mocked(api.getProgress).mockResolvedValueOnce({ ...progress, lede: { cases: 0, translations_to_review: 0, versions_to_annotate: 0, not_in_plan: 0, needs_decision: 0, to_assign: 0 }, workload: [] });
  const { unmount } = render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  await screen.findByText("No texts yet");
  expect(screen.queryByRole("list", { name: "Pipeline" })).toBeNull();
  unmount();
  vi.mocked(api.getProgress).mockRejectedValueOnce(new AuthError("Forbidden", undefined, "NOT_ALLOWED"));
  render(<ProgressPage projectKey="q" onNavigate={vi.fn()} />);
  await screen.findByText("You do not have access to this page.");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("ignores an earlier project reply", async () => {
  let resolve!: (value: ProjectProgress) => void;
  vi.mocked(api.getProgress).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockRejectedValueOnce(new AuthError("Forbidden", undefined, "NOT_ALLOWED"));
  const { rerender } = render(<ProgressPage projectKey="old" onNavigate={vi.fn()} />);
  rerender(<ProgressPage projectKey="new" onNavigate={vi.fn()} />);
  await screen.findByText("You do not have access to this page.");
  await act(async () => { resolve(progress); });
  expect(screen.queryByRole("list", { name: "Pipeline" })).toBeNull();
});

it("no longer renders Totals or the documents table", async () => {
  render(<ProgressPage projectKey="p" onNavigate={vi.fn()} />);
  await pipeline();
  expect(screen.queryByRole("region", { name: "Project totals" })).toBeNull();
  expect(screen.queryByText("Totals")).toBeNull();
  expect(screen.queryByRole("table", { name: "Progress documents" })).toBeNull();
  expect(screen.queryByText("old-document")).toBeNull();
  expect(screen.queryByLabelText("Document status")).toBeNull();
  expect(screen.queryByRole("link", { name: "Assign" })).toBeNull();
});

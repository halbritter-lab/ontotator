import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AssignmentView, type GuidelineNotice } from "../src/api/client";
import { TaskGuidelines } from "../src/tasks/TaskGuidelines";
import { TaskEditor } from "../src/tasks/TaskEditor";
import { guidelineDocument, guidelineListing, guidelineSummary, withdrawnGuideline } from "./projectFixtures";
import { reviewWorkspace } from "./translationFixtures";
import { assigned, workspaceFixture } from "./assignments";
import { testUser } from "./session";

// Load the lazy Markdown chunk once, so the first drawer test does not pay for it.
beforeAll(async () => { await import("../src/ui/MarkdownBody"); }, 30_000);
beforeEach(() => {
  vi.spyOn(api, "recordGuidelineRead").mockResolvedValue(undefined);
  vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(3), guidelineSummary(2), guidelineSummary(1)], { my_latest_seen: 3 }));
  vi.spyOn(api, "getGuideline").mockImplementation(async (_key, version) => guidelineDocument(guidelineSummary(version)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const T = `${new Date().getFullYear()}-10-20T14:02:00`;
const inForce = (version: number) => ({ version, kind: "markdown" as const, created_at: T });
function task(over: Partial<AssignmentView> = {}): AssignmentView {
  return { id: 4, workflow_revision: 3, held: false, hold_reason: null, active_holds: [], lead_correction: false, project_key: "p/key", document_id: "doc",
    user_id: 9, display_name: "Ann", username: "ann", pseudonym: "ann-0004", task: "annotate", status: "in_progress", created_at: T,
    updated_at: T, revoked_at: null, last_submission_id: null, guideline: inForce(3), guideline_notice: null, ...over } as AssignmentView;
}
const update: GuidelineNotice = { from_version: 1, to_version: 3, more: 2, changes: [
  { version: 3, change_note: "Negations are now annotated with the negated axis.", created_at: T, withdrawn: false },
  { version: 2, change_note: null, created_at: T, withdrawn: true },
] };
const first: GuidelineNotice = { from_version: null, to_version: 3, more: 0, changes: [{ version: 3, change_note: "Initial rules", created_at: T, withdrawn: false }] };

function Harness({ assignment, readOnly = false }: { assignment: AssignmentView; readOnly?: boolean }) {
  return <TaskGuidelines assignment={assignment} readOnly={readOnly}>{({ button, notice, drawer }) => <>
    <div role="group" aria-label="Task actions">{button}<button>Report a text problem</button></div>
    <div data-testid="notice-slot">{notice}</div>
    <button>Editor</button>
    {drawer}
  </>}</TaskGuidelines>;
}
const entry = () => screen.getByRole("button", { name: /^Guidelines v\d+, open the project guidelines/ });
const notified = () => vi.mocked(api.recordGuidelineRead).mock.calls.filter(call => call[2] === "notified");
const opened = () => vi.mocked(api.recordGuidelineRead).mock.calls.filter(call => call[2] === "opened");
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe("task guidelines button", () => {
  it("button reads Guidelines v3 with accessible name Guidelines v3, open the project guidelines", async () => {
    render(<Harness assignment={task()} />);
    await waitFor(() => expect(api.listGuidelines).toHaveBeenCalledWith("p/key"));
    await settle();
    const button = screen.getByRole("button", { name: "Guidelines v3, open the project guidelines" });
    expect(button.textContent).toBe("Guidelines v3");
    expect(button.classList.contains("btn-sm")).toBe(true);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("New")).toBeNull();
  });

  it("shows the New badge and , updated in the name when a newer version than my_latest_seen exists", async () => {
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(3)], { my_latest_seen: 2 }));
    render(<Harness assignment={task()} />);
    const button = await screen.findByRole("button", { name: "Guidelines v3, open the project guidelines, updated" });
    expect(within(button).getByText("New")).toBeDefined();
    expect(button.textContent).toBe("Guidelines v3 New");
    cleanup();
    // Never opened at all: also new.
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(3)], { my_latest_seen: null }));
    render(<Harness assignment={task()} />);
    expect(await screen.findByRole("button", { name: "Guidelines v3, open the project guidelines, updated" })).toBeDefined();
    // Opening the drawer clears the badge.
    fireEvent.click(entry());
    await screen.findByText("Annotate negations.");
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getByRole("button", { name: "Guidelines v3, open the project guidelines" })).toBeDefined();
  });

  it("is absent without a version in force", async () => {
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([withdrawnGuideline(3)], { my_latest_seen: null }));
    render(<Harness assignment={task({ guideline: null })} />);
    await settle();
    expect(screen.queryByRole("button", { name: /^Guidelines/ })).toBeNull();
    expect(screen.getByTestId("notice-slot").textContent).toBe("");
    expect(api.recordGuidelineRead).not.toHaveBeenCalled();
  });

  it("opening records opened and keeps the scroll position while the task stays open", async () => {
    render(<Harness assignment={task()} />);
    fireEvent.click(entry());
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
    // GuidelineReader records the read when it shows the text; TaskGuidelines adds no second call.
    await waitFor(() => expect(opened()).toEqual([["p/key", 3, "opened"]]));
    expect(notified()).toEqual([]);
    const scroller = () => screen.getByText("Annotate negations.").closest<HTMLElement>(".ui-drawer-body, .ui-dialog-body")!;
    scroller().scrollTop = 180;
    fireEvent.scroll(scroller());
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByText("Annotate negations.")).toBeNull();
    fireEvent.click(entry());
    await screen.findByText("Annotate negations.");
    expect(scroller().scrollTop).toBe(180);
  });

  it("All versions opens #/projects/{key}/guidelines in a new tab", async () => {
    render(<Harness assignment={task()} />);
    fireEvent.click(entry());
    const link = await screen.findByRole("link", { name: "All versions" });
    expect(link.getAttribute("href")).toBe("#/projects/p%2Fkey/guidelines");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("task guidelines focus return", () => {
  it("returns focus to the task toolbar when the Guidelines button is gone after a withdrawal", async () => {
    const view = render(<Harness assignment={task()} />);
    await settle();
    fireEvent.click(entry());
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    view.rerender(<Harness assignment={task({ guideline: null })} />);
    expect(screen.queryByRole("button", { name: /^Guidelines v\d+, open/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Report a text problem" }));
  });
});

describe("task guidelines notice", () => {
  it("reading the guidelines from the notice closes the notice", async () => {
    render(<Harness assignment={task({ guideline_notice: update })} />);
    const notice = within(screen.getByTestId("notice-slot"));
    fireEvent.click(await notice.findByRole("button", { name: "Read guidelines v3" }));
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
  });

  it("update notice lists change notes, v2: withdrawn and and 2 earlier changes", async () => {
    render(<Harness assignment={task({ guideline_notice: update })} />);
    const notice = within(screen.getByTestId("notice-slot"));
    expect(await notice.findByText("Guidelines updated to v3")).toBeDefined();
    const items = notice.getAllByRole("listitem").map(item => item.textContent);
    expect(items).toEqual(["v3: Negations are now annotated with the negated axis.", "v2: withdrawn"]);
    expect(notice.getByText("and 2 earlier changes")).toBeDefined();
    fireEvent.click(notice.getByRole("button", { name: "Read guidelines v3" }));
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
  });

  it("first-exposure notice copy", async () => {
    render(<Harness assignment={task({ guideline_notice: first })} />);
    const notice = within(screen.getByTestId("notice-slot"));
    expect(await notice.findByText("This project has guidelines (v3)")).toBeDefined();
    expect(notice.getByText("Read them before you start; they are available at any time under Guidelines in the toolbar.")).toBeDefined();
    expect(notice.getByRole("button", { name: "Read guidelines v3" })).toBeDefined();
    expect(notice.queryByRole("listitem")).toBeNull();
  });

  it("records notified once; Close only hides", async () => {
    const view = render(<Harness assignment={task({ guideline_notice: update })} />);
    await screen.findByText("Guidelines updated to v3");
    await waitFor(() => expect(notified()).toEqual([["p/key", 3, "notified"]]));
    // A later metadata reload no longer offers the notice: the shown one stays until closed.
    view.rerender(<Harness assignment={task({ guideline_notice: null })} />);
    view.rerender(<Harness assignment={task({ guideline_notice: update })} />);
    expect(screen.getByText("Guidelines updated to v3")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
    view.rerender(<Harness assignment={task({ guideline_notice: update })} />);
    await settle();
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
    expect(notified()).toHaveLength(1);
    expect(opened()).toEqual([]);
    expect(entry()).toBeDefined();
  });

  it("no notice on a submitted task, button stays", async () => {
    render(<Harness assignment={task({ status: "submitted", guideline_notice: update })} readOnly />);
    await settle();
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
    expect(api.recordGuidelineRead).not.toHaveBeenCalled();
    expect(entry()).toBeDefined();
  });

  it("no notice and nothing recorded on a held task or a read-only round, button stays", async () => {
    // Held: readOnly from assignment.held while the status is not submitted.
    const view = render(<Harness assignment={task({ held: true, guideline_notice: first })} readOnly />);
    await settle();
    expect(screen.queryByText("This project has guidelines (v3)")).toBeNull();
    expect(entry()).toBeDefined();
    // A read-only round: workspace.read_only on an in-progress task.
    view.rerender(<Harness assignment={task({ status: "in_progress", guideline_notice: update })} readOnly />);
    await settle();
    expect(screen.queryByText("Guidelines updated to v3")).toBeNull();
    expect(api.recordGuidelineRead).not.toHaveBeenCalled();
    expect(entry()).toBeDefined();
  });
});

describe("task guidelines in the task screens", () => {
  function translationTask(workspace = reviewWorkspace()) {
    vi.spyOn(api, "listSourceObligations").mockResolvedValue([]);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([]);
    vi.spyOn(api, "openTranslationReview").mockResolvedValue(workspace);
    vi.spyOn(api, "saveTranslationReviewDraft").mockResolvedValue({ revision: 7 });
    vi.spyOn(api, "getVariantMetadata").mockResolvedValue({ ...workspace.variant, translation: null, version: 7, assigned_to_me: false });
    const metadata = vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue({ ...workspace.assignment, display_name: "Alice", guideline: inForce(3), guideline_notice: null } as AssignmentView);
    render(<TaskEditor assignmentId={17} user={testUser("alice")} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
    return { metadata, assignment: { ...workspace.assignment, display_name: "Alice" } as AssignmentView };
  }
  function annotationTask() {
    const initial = assigned(workspaceFixture());
    const assignment = { ...initial.assignment, workflow_revision: 3, guideline: inForce(3), guideline_notice: null } as AssignmentView;
    vi.spyOn(api, "getAssignmentMetadata").mockResolvedValue(assignment);
    vi.spyOn(api, "openAssignment").mockResolvedValue({ ...initial, assignment });
    vi.spyOn(api, "listMyTasks").mockResolvedValue([]);
    vi.spyOn(api, "listProjects").mockResolvedValue([]);
    vi.spyOn(api, "resolveTermLabels").mockResolvedValue([]);
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
    vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
    vi.spyOn(api, "listWorkRounds").mockResolvedValue([]);
    vi.spyOn(api, "listRoundInputs").mockResolvedValue([]);
    vi.spyOn(api, "listTaskProblemReports").mockResolvedValue([]);
    render(<TaskEditor assignmentId={1} user={testUser("alice")} onNavigate={vi.fn()} routeLeaveRef={{ current: null }} leaveGuardRef={{ current: null }} />);
  }
  const before = (a: HTMLElement, b: HTMLElement) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("sits in the editor's More menu after the text problems, and before Report a text problem in the translation review", async () => {
    annotationTask();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    await waitFor(() => expect(screen.getAllByRole("menuitem").map(item => item.textContent))
      .toEqual(["Work rounds", "Report a text problem…", "Guidelines v3", "Keyboard shortcuts (?)"]));
    expect(screen.queryByRole("button", { name: /^Guidelines v3, open the project guidelines/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Guidelines v3" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
    cleanup();
    translationTask();
    await screen.findByRole("textbox", { name: "Translation (de)" });
    const reviewGuidelines = await screen.findByRole("button", { name: /^Guidelines v3, open the project guidelines/ });
    expect(before(reviewGuidelines, screen.getByRole("button", { name: /^Report a text problem/ }))).toBe(true);
    expect(reviewGuidelines.closest(".translation-review-tools")).not.toBeNull();
  });

  it("stays visible in lead-correction mode of the translation review", async () => {
    const workspace = reviewWorkspace({ lead_correction: true, assignment: { ...reviewWorkspace().assignment, lead_correction: true } });
    translationTask(workspace);
    await screen.findByRole("textbox", { name: "Translation (de)" });
    expect(await screen.findByRole("button", { name: /^Guidelines v3, open the project guidelines/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Report a text problem/ })).toBeNull();
  });

  it("a focus reload in lead-correction mode re-reads the task and shows the new version and its notice once", async () => {
    const workspace = reviewWorkspace({ lead_correction: true, assignment: { ...reviewWorkspace().assignment, lead_correction: true } });
    const { metadata, assignment } = translationTask(workspace);
    await screen.findByRole("textbox", { name: "Translation (de)" });
    await screen.findByRole("button", { name: /^Guidelines v3, open the project guidelines/ });
    const calls = metadata.mock.calls.length;
    metadata.mockResolvedValue({ ...assignment, guideline: inForce(4), guideline_notice: { ...update, from_version: 3, to_version: 4, more: 0,
      changes: [{ version: 4, change_note: "Units are checked.", created_at: T, withdrawn: false }] } } as AssignmentView);
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(4), guidelineSummary(3)], { my_latest_seen: 3 }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("button", { name: "Guidelines v4, open the project guidelines, updated" })).toBeDefined();
    expect(await screen.findByText("Guidelines updated to v4")).toBeDefined();
    // One metadata request per focus: no problem reporter runs a second one.
    expect(metadata.mock.calls.length).toBe(calls + 1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(screen.getAllByText("Guidelines updated to v4")).toHaveLength(1);
    expect(notified()).toEqual([["proj", 4, "notified"]]);
  });

  it("a focus reload refetches the text of an open drawer", async () => {
    render(<Harness assignment={task()} />);
    fireEvent.click(entry());
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    expect(api.getGuideline).toHaveBeenCalledTimes(1);
    vi.mocked(api.getGuideline).mockResolvedValue({ ...guidelineDocument(guidelineSummary(3)), body: "Corrected text." });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("Corrected text.")).toBeDefined();
    expect(api.getGuideline).toHaveBeenCalledTimes(2);
  });

  it("a focus reload with a new version updates the button and shows the notice in place", async () => {
    const { metadata, assignment } = translationTask();
    await screen.findByRole("textbox", { name: "Translation (de)" });
    await screen.findByRole("button", { name: /^Guidelines v3, open the project guidelines/ });
    expect(screen.queryByText("Guidelines updated to v4")).toBeNull();
    metadata.mockResolvedValue({ ...assignment, guideline: inForce(4), guideline_notice: { ...update, from_version: 3, to_version: 4, more: 0,
      changes: [{ version: 4, change_note: "Units are checked.", created_at: T, withdrawn: false }] } } as AssignmentView);
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(4), guidelineSummary(3)], { my_latest_seen: 3 }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("button", { name: "Guidelines v4, open the project guidelines, updated" })).toBeDefined();
    const notice = await screen.findByText("Guidelines updated to v4");
    // Above the review bar.
    expect(before(notice, document.querySelector<HTMLElement>(".translation-review-bar")!)).toBe(true);
    expect(screen.getByText("v4: Units are checked.")).toBeDefined();
    await waitFor(() => expect(notified()).toEqual([["proj", 4, "notified"]]));
  });

  it("a focus reload after withdrawal removes the button; an open drawer shows v3 was withdrawn by the project lead.", async () => {
    const { metadata, assignment } = translationTask();
    await screen.findByRole("textbox", { name: "Translation (de)" });
    fireEvent.click(await screen.findByRole("button", { name: /^Guidelines v3, open the project guidelines/ }));
    expect(await screen.findByText("Annotate negations.")).toBeDefined();
    metadata.mockResolvedValue({ ...assignment, guideline: null, guideline_notice: null } as AssignmentView);
    vi.mocked(api.getGuideline).mockResolvedValue(guidelineDocument(withdrawnGuideline(3, "Wrong file")));
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([withdrawnGuideline(3, "Wrong file")], { my_latest_seen: 3 }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText("v3 was withdrawn by the project lead.")).toBeDefined();
    expect(screen.queryByText("Annotate negations.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Guidelines v3, open the project guidelines/ })).toBeNull();
  });
});

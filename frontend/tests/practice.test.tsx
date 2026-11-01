import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AdminPracticeProject, type PracticeState, type PracticeTask, type TaskSummary } from "../src/api/client";
import { CHAPTERS, slugger } from "../src/help/handbook";
import { PracticeCard, PracticeGroup } from "../src/practice/PracticeOnMyTasks";
import { PracticeFrame } from "../src/practice/PracticeFrame";
import { PracticeSection } from "../src/practice/PracticeSection";
import { AdminPracticeProjects } from "../src/practice/AdminPracticeProjects";
import { PRACTICE_STEPS, PRACTICE_TERMS, practiceProgress } from "../src/practice/practiceSteps";
import { MyTasks } from "../src/tasks/MyTasks";
import { SummaryDialog } from "../src/consolidation/SummaryDialog";
import { guidelineListing } from "./projectFixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const practiceTask = (assignment_id: number, kind: PracticeTask["kind"], extra: Partial<PracticeTask> = {}): PracticeTask => ({
  assignment_id, kind, status: "open", case_id: `PRACTICE-${assignment_id}`, language: "de", findings: [], decisions: [], ...extra,
});
const project = (tasks: PracticeTask[], done = 0): NonNullable<PracticeState["project"]> => ({
  project_key: "practice-7-abc123", name: "Practice · Ann", created_at: "2026-11-01T09:00:00Z", last_activity_at: "2026-11-01T09:00:00Z",
  expires_at: "2026-12-01T09:00:00Z", tasks, done, total: tasks.length,
});
const state = (change: Partial<PracticeState> = {}): PracticeState => ({
  offered: true, available: true, show_card: true, card_hidden: false, reads_german: true, project: null, ...change,
});
const summary = (id: number, status: TaskSummary["status"], practice: boolean): TaskSummary => ({
  assignment_id: id, workflow_revision: 0, held: false, report_answered: false, waiting_for_translation_review: false, waiting_for_lead: false,
  project_key: practice ? "practice-7-abc123" : "real", project_name: practice ? "Practice · Ann" : "Real project", document_id: `doc-${id}`,
  case_id: `CASE-${id}`, language: "de", task: "annotate", status, updated_at: "2026-11-01T10:30:00Z", practice,
});

/** Heading ids of a handbook chapter (as in help.test.tsx). */
function headingIds(chapter: string): string[] {
  const next = slugger();
  return [...CHAPTERS[chapter].replace(/^```[\s\S]*?^```/gm, "").matchAll(/^#{1,6} +(.+?)\s*$/gm)]
    .map(match => next(match[1].replace(/[*`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
}

describe("practice steps", () => {
  it.each(Object.entries(PRACTICE_STEPS).flatMap(([kind, steps]) => steps.map(step => [`${kind}/${step.id}`, step] as const)))(
    "%s links an existing handbook section", (_, step) => {
      expect(headingIds(step.help.chapter)).toContain(step.help.section);
    });

  it("ticks the from-proposals steps from the real decisions and findings", () => {
    const fresh = practiceProgress(practiceTask(2, "proposals"));
    expect(fresh.steps.every(item => !item.done)).toBe(true);
    expect(fresh.next?.id).toBe("confirm");
    const worked = practiceProgress(practiceTask(2, "proposals", {
      decisions: [
        { term_id: PRACTICE_TERMS.seizure, outcome: "confirmed" },
        { term_id: PRACTICE_TERMS.hearingImpairment, outcome: "changed", replacement_term_id: "HP:0000407" },
      ],
      findings: [{ term_id: "HP:0000407", defaulted: [], replacement: true }],
    }));
    expect(worked.steps.map(item => [item.step.id, item.done])).toEqual([
      ["confirm", true], ["default", false], ["replace", true], ["missed", false], ["submit", false],
    ]);
    expect(worked.next?.id).toBe("default");
  });

  it("ticks the consolidation steps after Keep and Choose, never after an automatic keep", () => {
    const auto = practiceProgress(practiceTask(4, "consolidation", { decisions: [
      { term_id: PRACTICE_TERMS.areflexia, outcome: "changed", action: "auto" },
    ] }));
    expect(auto.steps.map(item => item.done)).toEqual([false, false, false]);
    const kept = practiceProgress(practiceTask(4, "consolidation", { decisions: [
      { term_id: PRACTICE_TERMS.hypotonia, outcome: "changed", action: "choose" },
      { term_id: PRACTICE_TERMS.areflexia, outcome: "changed", action: "keep" },
    ] }));
    expect(kept.steps.map(item => [item.step.id, item.done])).toEqual([["differ", true], ["partial", true], ["submit", false]]);
  });

  it("ticks the translation review from the saved text and decision", () => {
    const { steps, next } = practiceProgress(practiceTask(3, "translation_review", {
      translation_text: "… eine leichte Hypotonie der Arme …", translation_decision: "corrected", status: "submitted",
    }));
    expect(steps.every(item => item.done)).toBe(true);
    expect(next).toBeNull();
  });
});

describe("My tasks: the New here? card", () => {
  it("starts practice with Try it out", async () => {
    const onChange = vi.fn();
    const started = state({ show_card: false, project: project([practiceTask(1, "scratch")]) });
    vi.spyOn(api, "startPractice").mockResolvedValue(started);
    render(<PracticeCard state={state()} onChange={onChange} onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "New here? Try it out first" })).toBeDefined();
    expect(screen.getByText(/short, invented texts in German/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try it out" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(started));
  });

  it("hints only when German is not in the Profile", () => {
    const hint = /German is not among the languages in your Profile/;
    const { rerender } = render(<PracticeCard state={state()} onChange={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByText(hint)).toBeNull();
    rerender(<PracticeCard state={state({ reads_german: false })} onChange={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText(hint)).toBeDefined();
  });

  it("Not now hides the card for good and says where practice stays", async () => {
    const onNavigate = vi.fn();
    const hide = vi.spyOn(api, "setPracticeCard").mockResolvedValue(state({ show_card: false, card_hidden: true }));
    render(<PracticeCard state={state()} onChange={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByText(/Practice is in your/)).toBeDefined();
    expect(hide).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "Try it out" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Profile" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "me" });
  });

  it("explains why practice is not available instead of failing", () => {
    const start = vi.spyOn(api, "startPractice");
    render(<PracticeCard state={state({ available: false, unavailable_reason: "no_ontology", unavailable_message: "Practice is not available: this server has no suitable HPO release." })}
      onChange={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Try it out" }));
    expect(screen.getByText(/no suitable HPO release/)).toBeDefined();
    expect(start).not.toHaveBeenCalled();
  });

  it("is not shown once hidden or with a practice project", () => {
    const { container } = render(<PracticeCard state={state({ show_card: false })} onChange={vi.fn()} onNavigate={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

it("a practice consolidation does not promise a lead", () => {
  const dialog = (practice: boolean) => <SummaryDialog open practice={practice} summary="3 groups" busy={false} warning={null} error={null} onSubmit={vi.fn()} onClose={vi.fn()} />;
  const { rerender } = render(dialog(false));
  expect(screen.getByText("The lead then accepts the result.")).toBeDefined();
  rerender(dialog(true));
  expect(screen.queryByText("The lead then accepts the result.")).toBeNull();
});

describe("My tasks: the Practice group", () => {
  beforeEach(() => { vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([])); });

  it("lists practice tasks apart from real tasks", async () => {
    vi.spyOn(api, "listMyTasks").mockResolvedValue([summary(1, "open", false), summary(2, "open", true), summary(3, "submitted", true)]);
    vi.spyOn(api, "getPractice").mockResolvedValue(state({ show_card: false, project: project([practiceTask(2, "scratch"), practiceTask(3, "proposals")], 1) }));
    render(<MyTasks projects={[]} onNavigate={vi.fn()} />);
    expect(await screen.findAllByTestId("task-row")).toHaveLength(1);
    const group = await screen.findByTestId("practice-group");
    // The pill names the group; no second "Practice" beside it.
    expect(within(group).getAllByText("Practice")).toHaveLength(1);
    expect(within(group).getAllByTestId("practice-task-row")).toHaveLength(2);
    expect(within(group).getByText(/1 of 2 tasks done/)).toBeDefined();
    expect(within(group).getByText("Annotate from scratch")).toBeDefined();
    expect(within(group).queryByRole("button", { name: "Delete" })).toBeNull();
    expect((group as HTMLDetailsElement).open).toBe(true);
  });

  it("folds to Practice complete with Delete when every practice task is done", async () => {
    const remove = vi.spyOn(api, "deletePractice").mockResolvedValue(state());
    const onChange = vi.fn();
    render(<PracticeGroup tasks={[summary(2, "submitted", true)]} state={state({ project: project([practiceTask(2, "scratch", { status: "submitted" })], 1) })}
      actionLabel={() => "View"} onChange={onChange} onNavigate={vi.fn()} />);
    const group = screen.getByTestId("practice-group") as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(within(group).getByText("Practice complete")).toBeDefined();
    fireEvent.click(within(group).getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete practice project" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(remove).toHaveBeenCalled();
  });
});

describe("Profile › Practice", () => {
  it("shows progress, the deletion date and the actions of a practice project", async () => {
    const onNavigate = vi.fn();
    vi.spyOn(api, "getPractice").mockResolvedValue(state({ show_card: false, project: project([practiceTask(1, "scratch", { status: "submitted" }),
      practiceTask(2, "proposals"), practiceTask(3, "translation_review"), practiceTask(4, "consolidation")], 1) }));
    render(<PracticeSection onNavigate={onNavigate} />);
    expect(await screen.findByRole("heading", { name: "Practice" })).toBeDefined();
    expect(screen.getByText("1 of 4 tasks done")).toBeDefined();
    expect(screen.getByText("1 Dec 2026")).toBeDefined();
    // The name already says Practice: no pill next to it.
    expect(screen.getByText("Practice · Ann")).toBeDefined();
    expect(document.querySelector(".practice-pill")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", status: "all" });
    const reset = vi.spyOn(api, "resetPractice").mockResolvedValue(state({ project: project([practiceTask(5, "scratch")]) }));
    fireEvent.click(screen.getByRole("button", { name: "Reset…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset practice" }));
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Delete…" })).toBeDefined();
  });

  it("starts practice and switches the card", async () => {
    vi.spyOn(api, "getPractice").mockResolvedValue(state({ card_hidden: true, show_card: false }));
    const card = vi.spyOn(api, "setPracticeCard").mockResolvedValue(state());
    const start = vi.spyOn(api, "startPractice").mockResolvedValue(state({ project: project([practiceTask(1, "scratch")]) }));
    render(<PracticeSection onNavigate={vi.fn()} />);
    const box = await screen.findByLabelText("Show the card New here? on My tasks") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(card).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
  });

  it("stays away when practice is not offered and there is no project", async () => {
    const read = vi.spyOn(api, "getPractice").mockResolvedValue(state({ offered: false, available: false, show_card: false, unavailable_reason: "not_eligible" }));
    const { container } = render(<PracticeSection />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

describe("the practice task frame", () => {
  it("shows the banner and Your practice, ticked from the task's state", async () => {
    const onNavigate = vi.fn();
    vi.spyOn(api, "getPractice").mockResolvedValue(state({ show_card: false, project: project([practiceTask(9, "scratch", {
      findings: [{ term_id: PRACTICE_TERMS.seizure, assertion: "present", defaulted: ["temporality"], replacement: false }],
    })]) }));
    render(<PracticeFrame assignmentId={9} onNavigate={onNavigate}><p>editor</p></PracticeFrame>);
    expect(await screen.findByText("Nothing here counts. Invented texts only.")).toBeDefined();
    expect(screen.getByText("editor")).toBeDefined();
    const steps = screen.getAllByRole("listitem");
    expect(steps.map(step => step.getAttribute("data-done"))).toEqual(["true", "false", "false", "false"]);
    expect(screen.getByRole("status").textContent).toContain("Next: “Ein Status epilepticus trat nicht auf”");
    const panel = screen.getByRole("group", { name: "Your practice" }) as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(panel.querySelector("summary")!.textContent).toContain("Your practice · 1 of 4 · Next:");
    expect(panel.querySelectorAll("input").length).toBe(0);
    expect(steps[1].textContent).toContain("not done");
    expect(within(steps[0]).getByRole("link", { name: "Help" }).getAttribute("href")).toBe("#/help/annotator?section=mark-text-and-add-a-finding");
    fireEvent.click(screen.getByRole("button", { name: "Leave practice" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "tasks", status: "all" });
  });

  it("leaves a real task unchanged", async () => {
    const read = vi.spyOn(api, "getPractice").mockResolvedValue(state({ project: project([practiceTask(9, "scratch")]) }));
    render(<PracticeFrame assignmentId={10} onNavigate={vi.fn()}><p>editor</p></PracticeFrame>);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("practice-banner")).toBeNull();
    expect(screen.getByText("editor")).toBeDefined();
  });
});

describe("Projects page: practice projects for administrators", () => {
  const row: AdminPracticeProject = {
    project_key: "practice-7-abc123", name: "Practice · Ann", owner_username: "ann", owner_display_name: "Ann",
    created_at: "2026-11-01T09:00:00Z", last_activity_at: "2026-11-01T09:00:00Z", expires_at: "2026-12-01T09:00:00Z", done: 1, total: 3,
  };

  it("hides them by default and lists them with a Practice pill and Delete…", async () => {
    vi.spyOn(api, "adminListPracticeProjects").mockResolvedValueOnce([row]).mockResolvedValue([]);
    const remove = vi.spyOn(api, "adminDeletePracticeProject").mockResolvedValue(undefined);
    render(<AdminPracticeProjects />);
    const filter = await screen.findByLabelText("Show practice projects (1)") as HTMLInputElement;
    expect(filter.checked).toBe(false);
    expect(screen.queryByTestId("practice-project-row")).toBeNull();
    fireEvent.click(filter);
    const listed = screen.getByTestId("practice-project-row");
    expect(within(listed).getByText("Practice")).toBeDefined();
    // The pill says Practice once; the name "Practice · Ann" would repeat it and the owner.
    expect(within(listed).queryByText("Practice · Ann")).toBeNull();
    expect(within(listed).getByText("Ann")).toBeDefined();
    expect(within(listed).getByText("1 of 3 tasks done")).toBeDefined();
    fireEvent.click(within(listed).getByRole("button", { name: "Delete…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete practice project" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("practice-7-abc123"));
    expect(await screen.findByLabelText("Show practice projects (0)")).toBeDefined();
  });
});

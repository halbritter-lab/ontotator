import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type BatchAssignRequest, type BatchPersonView, type BatchPreview, type DocumentRowView, type SelectionSummary } from "../src/api/client";
import { AssignWorkDialog } from "../src/admin/AssignWorkDialog";
import { assignment } from "./assignmentFixtures";

type Person = Omit<BatchPersonView, "open_after" | "gets" | "first_case" | "last_case">;
const person = (username: string, display_name: string, pseudonym: string, reads: string[], open_before: number, extra: Partial<Person> = {}): Person => ({
  username, person: { pseudonym, display_name, is_me: false }, reads, open_before, language_mismatch: !reads.includes("de"), unavailable: reads.includes("de") ? null : "does_not_read", already_assigned: 0, ...extra,
});
// Deliberately unsorted: the dialog sorts by reads, then open tasks, then name.
const people: Person[] = [
  person("clara", "Clara Diaz", "ann-0009", ["en", "de", "es"], 14),
  person("eva", "Eva Klein", "ann-0012", ["de"], 0, { unavailable: "role_missing" }),
  person("dan", "Dan Mertens", "ann-0011", ["en", "fr"], 2),
  person("ben", "Ben Roth", "ann-0007", ["en", "de", "fr"], 11),
  person("ana", "Ana Weber", "ann-0004", ["en", "de"], 3),
];
const caseIds = Array.from({ length: 20 }, (_, index) => `case-0${101 + index}`);
let skipped: BatchPreview["skipped"] = [];
let perText = 1;
let remainingOf: (caseId: string) => number = () => 1;
let needsPeople: number | null = null;
let digest = "digest-1";

function preview(body: BatchAssignRequest): BatchPreview & { needs_people?: number | null } {
  const usernames = body.usernames ?? [];
  const ids = body.case_ids.filter(id => !skipped.some(item => item.case_id === id));
  const blocks = new Map<string, string[]>();
  if (body.mode === "one" && usernames.length === 1) for (const id of ids) blocks.set(id, [usernames[0]]);
  if (body.mode === "split" && usernames.length && needsPeople === null) {
    const size = Math.ceil(ids.length / usernames.length);
    ids.forEach((id, index) => blocks.set(id, [usernames[Math.floor(index / size)]]));
  }
  const targets = ids.map(id => ({ case_id: id, language: body.language, document_id: `doc-${id}`, version: 1, remaining: remainingOf(id), usernames: blocks.get(id) ?? [] }));
  return {
    task: body.task, language: body.language, versions: targets.length, targets, skipped, per_text: perText, digest, needs_people: needsPeople,
    people: people.map(item => {
      const cases = targets.filter(target => target.usernames.includes(item.username)).map(target => target.case_id);
      return { ...item, gets: cases.length, open_after: item.open_before + cases.length, first_case: cases[0] ?? null, last_case: cases.at(-1) ?? null };
    }),
  };
}
const summary = (steps: SelectionSummary["steps"]): SelectionSummary => ({ cases: 20, steps, skipped: {}, common: steps[0] ?? null, not_shown: 0 });

beforeEach(() => {
  skipped = []; perText = 1; remainingOf = () => 1; needsPeople = null; digest = "digest-1";
  vi.spyOn(api, "selectionSummary").mockResolvedValue(summary([{ task: "translation_review", language: "de", versions: 20, cases: 20 }]));
  vi.spyOn(api, "previewAssignmentBatch").mockImplementation(async (_key, body) => preview(body));
  vi.spyOn(api, "commitAssignmentBatch").mockImplementation(async (_key, body) => ({ created: preview(body).targets.flatMap(target => target.usernames.map(username => ({ ...assignment, username, document_id: target.document_id, task: body.task }))) }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const casesProps = () => ({ mode: "cases" as const, projectKey: "p/key", caseIds, sort: "import" as const, filters: { segment: "assign" as const, language: "de" }, onClose: vi.fn(), onAssigned: vi.fn() });
const radio = (name: RegExp | string) => screen.getByRole("radio", { name });
const memberNames = () => within(screen.getByRole("table", { name: "Members" })).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[0].textContent);
const lastPreview = () => vi.mocked(api.previewAssignmentBatch).mock.lastCall![1];
async function ready() { await screen.findByRole("table", { name: "Members" }); }
async function waitForPreviewOf(usernames: string[]) { await waitFor(() => expect(lastPreview().usernames).toEqual(usernames)); await waitFor(() => expect(screen.queryByText("Calculating…")).toBeNull()); }

it("preselects the task from the plan and lets several steps be chosen", async () => {
  const view = render(<AssignWorkDialog {...casesProps()} />);
  expect(await screen.findByText("Translation review · de · 20 versions")).toBeDefined();
  expect(screen.getByText("from the plan")).toBeDefined();
  expect(screen.getByRole("dialog", { name: "Assign · 20 cases" })).toBeDefined();
  view.unmount();
  vi.mocked(api.selectionSummary).mockResolvedValue(summary([{ task: "annotate", language: "fr", versions: 12, cases: 12 }, { task: "translation_review", language: "de", versions: 20, cases: 20 }]));
  render(<AssignWorkDialog {...casesProps()} />);
  const select = await screen.findByRole("combobox", { name: "Task" });
  expect((select as HTMLSelectElement).selectedOptions[0].textContent).toBe("Translation review · de · 20 versions");
  expect(screen.getByRole("option", { name: "Annotation · fr · 12 versions" })).toBeDefined();
  await ready();
  fireEvent.change(select, { target: { value: "annotate:fr" } });
  await waitFor(() => expect(lastPreview()).toMatchObject({ task: "annotate", language: "fr" }));
});

it("sorts members by reads, then open tasks, then name; nobody preselected", async () => {
  render(<AssignWorkDialog {...casesProps()} />); await ready();
  expect(memberNames().map(name => name?.split(" (")[0])).toEqual(["Ana Weber", "Ben Roth", "Clara Diaz", "Dan Mertens", "Eva Klein"]);
  expect(screen.getAllByRole("radio").filter(item => (item as HTMLInputElement).name.startsWith("assign-member")).some(item => (item as HTMLInputElement).checked)).toBe(false);
  expect(lastPreview().usernames).toEqual([]);
});

it("shows ineligible members muted with the reason and aria-disabled", async () => {
  vi.mocked(api.selectionSummary).mockResolvedValue(summary([{ task: "annotate", language: "de", versions: 20, cases: 20 }]));
  people.push(person("finn", "Finn Ott", "ann-0013", ["de"], 5, { already_assigned: 3 }));
  try {
    render(<AssignWorkDialog {...casesProps()} />); await ready();
    const eva = radio(/Eva Klein/);
    expect(eva.getAttribute("aria-disabled")).toBe("true");
    expect(eva.hasAttribute("disabled")).toBe(false);
    expect(document.getElementById(eva.getAttribute("aria-describedby")!)!.textContent).toContain("Not an annotator in this project");
    expect(eva.closest("tr")!.className).toContain("is-unavailable");
    fireEvent.click(eva);
    expect((eva as HTMLInputElement).checked).toBe(false);
    expect(radio(/Dan Mertens.*does not read de/)).toBeDefined();
    const finn = radio(/Finn Ott.*Already annotating 3 of these cases/);
    expect(finn.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(finn);
    expect((finn as HTMLInputElement).checked).toBe(true);
  } finally { people.pop(); }
});

it("One person: radio per member and live summary", async () => {
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  fireEvent.click(radio(/Ana Weber/));
  await waitForPreviewOf(["ana"]);
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("Ana Weber gets 20 translation reviews (de). Open tasks: 3 → 23.");
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  await waitFor(() => expect(props.onAssigned).toHaveBeenCalled());
  expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ task: "translation_review", language: "de", mode: "one", usernames: ["ana"], expected_preview_digest: "digest-1", confirm_language: false }));
});

it("Split evenly: checkboxes with Gets and contiguous blocks", async () => {
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Split evenly" }));
  expect(screen.getByRole("columnheader", { name: "Gets" })).toBeDefined();
  fireEvent.click(screen.getByRole("checkbox", { name: /Ana Weber/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Ben Roth/ }));
  await waitForPreviewOf(["ana", "ben"]);
  expect(lastPreview().mode).toBe("split");
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("Cases in list order: case-0101…0110 → Ana, case-0111…0120 → Ben.");
  expect(within(screen.getByRole("checkbox", { name: /Ana Weber/ }).closest("tr")!).getByText("10")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith("20 translation reviews split between Ana Weber (10) and Ben Roth (10)", []));
});

it("keeps Assign unavailable with a reason until a choice exists", async () => {
  vi.mocked(api.selectionSummary).mockResolvedValue(summary([{ task: "annotate", language: "de", versions: 20, cases: 20 }]));
  render(<AssignWorkDialog {...casesProps()} />); await ready();
  const assign = screen.getByRole("button", { name: "Assign 20" });
  expect(assign.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(assign.getAttribute("aria-describedby")!)!.textContent).toBe("Choose a person first.");
  fireEvent.click(assign);
  expect(api.commitAssignmentBatch).not.toHaveBeenCalled();
  perText = 2; remainingOf = () => 2; needsPeople = 2;
  fireEvent.click(screen.getByRole("radio", { name: "Split evenly" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Ana Weber/ }));
  await waitForPreviewOf(["ana"]);
  const button = screen.getByRole("button", { name: /^Assign \d+$/ });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("Choose at least 2 annotators for 2 annotations per text.");
  fireEvent.click(button);
  expect(api.commitAssignmentBatch).not.toHaveBeenCalled();
});

it("asks Assign anyway in the dialog for a language mismatch", async () => {
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  fireEvent.click(radio(/Dan Mertens/));
  await waitForPreviewOf(["dan"]);
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("Dan Mertens does not read de.");
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  expect(api.commitAssignmentBatch).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Assign anyway" }));
  await waitFor(() => expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ usernames: ["dan"], confirm_language: true })));
  await waitFor(() => expect(props.onAssigned).toHaveBeenCalled());
});

it("closes and reports the result for one person and split", async () => {
  skipped = [{ case_id: "case-0120", language: "de", reason: "waiting_for_review" }];
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("1 still in translation review: waiting for review, they join the next batch");
  fireEvent.click(radio(/Ana Weber/));
  await waitForPreviewOf(["ana"]);
  fireEvent.click(screen.getByRole("button", { name: "Assign 19" }));
  await waitFor(() => expect(props.onAssigned).toHaveBeenCalledWith("19 translation reviews assigned to Ana Weber", ["case-0120"]));
});

it("keeps the dialog open listing refused cases by text and person", async () => {
  vi.mocked(api.commitAssignmentBatch).mockRejectedValue(new ApiError(409, "refused", "ASSIGNMENT_BATCH_REFUSED", { refused: [{ case_id: "case-0101", language: "de", document_id: "doc-case-0101", username: "ana", code: "NOT_IN_WORK_PLAN" }] }));
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  fireEvent.click(radio(/Ana Weber/)); await waitForPreviewOf(["ana"]);
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  const list = await screen.findByRole("list", { name: "Refused assignments" });
  expect(list.textContent).toContain("case-0101 · de — Ana Weber (ann-0004)");
  expect(screen.getByText(/Nothing was assigned/)).toBeDefined();
  expect(props.onAssigned).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Assign · 20 cases" })).toBeDefined();
});

it("reloads the preview after ASSIGNMENT_BATCH_STALE", async () => {
  vi.mocked(api.commitAssignmentBatch).mockRejectedValueOnce(new ApiError(409, "stale", "ASSIGNMENT_BATCH_STALE"));
  const props = casesProps(); render(<AssignWorkDialog {...props} />); await ready();
  fireEvent.click(radio(/Ana Weber/)); await waitForPreviewOf(["ana"]);
  const calls = vi.mocked(api.previewAssignmentBatch).mock.calls.length;
  digest = "digest-2";
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  expect(await screen.findByText(/The cases or people changed/)).toBeDefined();
  await waitFor(() => expect(vi.mocked(api.previewAssignmentBatch).mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() => expect(screen.queryByText("Calculating…")).toBeNull());
  expect((radio(/Ana Weber/) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Assign 20" }));
  await waitFor(() => expect(api.commitAssignmentBatch).toHaveBeenLastCalledWith("p/key", expect.objectContaining({ expected_preview_digest: "digest-2" })));
});

const row = {
  case_id: "case-0101", language: "de", is_source: false, position: 1, parallel_roots: false, final: null, issues: [], notes: [], categories: [], pinned: false, retained: false, matches_decision: false, in_plan: true, own_open_assignment_id: null, last_activity_at: null,
  versions: [{ document_id: "doc-case-0101", external_id: "e", version: 1, origin: "machine_translation", derived_from: "src", chain_id: "c", chain_name: "c", translation_status: "accepted", accepted_without_review: false, latest_review_decision: null, is_newest_in_chain: true, matches_filter: true, last_activity_at: null }],
  work: [{ assignment_id: 9, document_id: "doc-case-0101", version: 1, author_label: "ann-0004", is_me: false, task: "annotate", status: "in_progress", held: false, round_ordinal: null, round_state: null, person: { pseudonym: "ann-0004", display_name: "Ana Weber", is_me: false } }],
} as unknown as DocumentRowView;

it("row mode shows context, Currently and Change task", async () => {
  perText = 2; remainingOf = () => 1;
  const onAssigned = vi.fn();
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={row} task="annotate" onClose={vi.fn()} onAssigned={onAssigned} />);
  expect(screen.getByRole("dialog", { name: "Assign annotation" })).toBeDefined();
  expect(screen.getByText("case-0101 · de")).toBeDefined();
  await ready();
  expect(screen.getByText(/Currently: Ana Weber \(ann-0004\)/)).toBeDefined();
  expect(screen.getByText("1 of 2 annotators assigned")).toBeDefined();
  expect(lastPreview()).toMatchObject({ task: "annotate", language: "de", case_ids: ["case-0101"] });
  // Nobody chosen yet: no count on the button, the reason beside it.
  expect(screen.getByRole("button", { name: "Assign" }).getAttribute("aria-disabled")).toBe("true");
  // 3 activations: the row action (outside), the person, Assign.
  fireEvent.click(screen.getByRole("checkbox", { name: /Ben Roth/ }));
  await waitForPreviewOf(["ben"]);
  fireEvent.click(screen.getByRole("button", { name: "Assign 1" }));
  await waitFor(() => expect(onAssigned).toHaveBeenCalledWith("1 annotation assigned to Ben Roth"));
  cleanup();
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={row} task="annotate" onClose={vi.fn()} onAssigned={vi.fn()} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Change task" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Task" }), { target: { value: "translation_review:de" } });
  await waitFor(() => expect(lastPreview().task).toBe("translation_review"));
});

it("shows the annotation mode of the text", async () => {
  const withMode = (mode: "proposals" | "scratch", source: "project" | "no_proposals") => ({ ...row, annotation_mode: { mode, source, locked: false, override: null, proposal_count: mode === "proposals" ? 4 : 0 } }) as unknown as DocumentRowView;
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={withMode("proposals", "project")} task="annotate" onClose={vi.fn()} onAssigned={vi.fn()} />);
  await ready();
  expect(screen.getByText("Annotation, from proposals")).toBeDefined();
  cleanup();
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={withMode("scratch", "no_proposals")} task="annotate" onClose={vi.fn()} onAssigned={vi.fn()} />);
  await ready();
  expect(screen.getByText("Annotation, from scratch")).toBeDefined();
  expect(screen.getByText("This text has no tool proposals, so it is annotated from scratch.")).toBeDefined();
});

it("lists holders with their assignment date", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 15, 0));
  try {
    const dated = { ...row, work: row.work.map(item => ({ ...item, assigned_at: new Date(2026, 9, 23, 10, 40).toISOString() })) } as DocumentRowView;
    render(<AssignWorkDialog mode="row" projectKey="p/key" row={dated} task="annotate" onClose={vi.fn()} onAssigned={vi.fn()} />);
    await ready();
    expect(screen.getByText("Currently: Ana Weber (ann-0004), assigned today 10:40")).toBeDefined();
  } finally { vi.useRealTimers(); }
});

it("offers Random distribution… as a secondary button", async () => {
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  render(<AssignWorkDialog {...casesProps()} />); await ready();
  const link = screen.getByRole("button", { name: "Random distribution…" });
  expect(link.className).toContain("btn-secondary");
  fireEvent.click(link);
  expect(await screen.findByRole("dialog", { name: "Propose distribution" })).toBeDefined();
});

it("arrow keys in the member radios skip aria-disabled members", async () => {
  render(<AssignWorkDialog {...casesProps()} />); await ready();
  const ana = radio(/Ana Weber/); const dan = radio(/Dan Mertens/); const eva = radio(/Eva Klein/);
  // One tab stop for the group.
  expect(ana.tabIndex).toBe(0); expect(dan.tabIndex).toBe(-1); expect(eva.tabIndex).toBe(-1);
  ana.focus();
  fireEvent.keyDown(ana, { key: "End" });
  expect(document.activeElement).toBe(dan);
  expect((dan as HTMLInputElement).checked).toBe(true);
  fireEvent.keyDown(dan, { key: "ArrowDown" });
  expect(document.activeElement).toBe(ana);
  fireEvent.keyDown(ana, { key: "ArrowUp" });
  expect(document.activeElement).toBe(dan);
  fireEvent.keyDown(dan, { key: "Home" });
  expect(document.activeElement).toBe(ana);
  fireEvent.keyDown(ana, { key: "ArrowDown" });
  expect(document.activeElement).toBe(radio(/Ben Roth/));
  expect((eva as HTMLInputElement).checked).toBe(false);
});

it("sends the Documents sort and filters with the selected case IDs", async () => {
  render(<AssignWorkDialog {...casesProps()} />); await ready();
  expect(api.selectionSummary).toHaveBeenCalledWith("p/key", caseIds, { segment: "assign", language: "de" });
  expect(lastPreview()).toMatchObject({ case_ids: caseIds, sort: "import", filters: { segment: "assign", language: "de" }, mode: "one" });
});

it("shows remaining assignments for versions already partly assigned", async () => {
  vi.mocked(api.selectionSummary).mockResolvedValue(summary([{ task: "annotate", language: "de", versions: 1, cases: 1 }]));
  perText = 2; remainingOf = () => 1;
  render(<AssignWorkDialog {...casesProps()} caseIds={["case-0101"]} />); await ready();
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("case-0101 · de: 1 of 2 assigned");
  fireEvent.click(radio(/Ana Weber/)); await waitForPreviewOf(["ana"]);
  expect(screen.getByRole("status", { name: "Summary" }).textContent).toContain("Ana Weber gets 1 annotation (de).");
});

it("row mode can assign a new review of an accepted translation", async () => {
  const onAssigned = vi.fn();
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={row} task="translation_review" newReviewOfAccepted onClose={vi.fn()} onAssigned={onAssigned} />);
  await ready();
  expect(lastPreview()).toMatchObject({ task: "translation_review", review_accepted_translation: true, case_ids: ["case-0101"] });
  fireEvent.click(radio(/Ana Weber/)); await waitForPreviewOf(["ana"]);
  fireEvent.click(screen.getByRole("button", { name: "Assign 1" }));
  await waitFor(() => expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ task: "translation_review", review_accepted_translation: true, usernames: ["ana"] })));
  await waitFor(() => expect(onAssigned).toHaveBeenCalledWith("1 translation review assigned to Ana Weber"));
});

it("row mode assigns a translation review after a source change with review_reason source_changed", async () => {
  const onAssigned = vi.fn();
  render(<AssignWorkDialog mode="row" projectKey="p/key" row={row} task="translation_review" reviewReason="source_changed" onClose={vi.fn()} onAssigned={onAssigned} />);
  await ready();
  expect(screen.getByRole("dialog", { name: "Assign review after source change" })).toBeDefined();
  expect(screen.getByText("Review after a source change")).toBeDefined();
  expect(lastPreview()).toMatchObject({ task: "translation_review", review_reason: "source_changed", case_ids: ["case-0101"] });
  fireEvent.click(radio(/Ana Weber/)); await waitForPreviewOf(["ana"]);
  fireEvent.click(screen.getByRole("button", { name: "Assign 1" }));
  await waitFor(() => expect(api.commitAssignmentBatch).toHaveBeenCalledWith("p/key", expect.objectContaining({ review_reason: "source_changed", usernames: ["ana"] })));
});

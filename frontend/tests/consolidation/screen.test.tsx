import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type ConsolidationGroupView, type ConsolidationView } from "../../src/api/client";
import { ConsolidationScreen } from "../../src/consolidation/ConsolidationScreen";
import { ShortcutHelpHost } from "../../src/ui/ShortcutHelp";
import { ANA, BEN, decidedView, draft, exampleView, group, member, mockViewport, MOD_TEXT, modSpan, resetViewport, seizure, severe, span, TEXT, withGroup, workspaceView } from "./fixtures";

beforeEach(() => { vi.restoreAllMocks(); resetViewport(); });
afterEach(() => { cleanup(); resetViewport(); });

const toggle = (name: RegExp) => screen.getByRole("button", { name, expanded: true });
const expandedTitle = () => document.querySelector(".cons-group-expanded .cons-group-title")?.textContent;
/** M-7d: a choice stages, Keep saves. */
const takeAbsentAndKeep = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Take Absent from Tom Reis for Assertion" }));
  fireEvent.click(within(document.querySelector(".cons-group-expanded") as HTMLElement).getByRole("button", { name: "Keep" }));
};
/** M-7b: a resolved row has no Change button; the row expands and Change is inside. */
const changeRow = async (title: string) => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${title} `), expanded: false }));
  fireEvent.click(await within(await waitFor(() => document.querySelector(".cons-group-expanded") as HTMLElement)).findByRole("button", { name: "Reopen" }));
};

function load(...views: ConsolidationView[]) {
  const spy = vi.spyOn(api, "getConsolidation");
  for (const view of views.slice(0, -1)) spy.mockResolvedValueOnce(view);
  spy.mockResolvedValue(views[views.length - 1]);
  vi.spyOn(api, "openWorkRound").mockResolvedValue({ workspace_id: "ws-c", view: workspaceView(), read_only: false });
  return spy;
}

async function renderScreen(props: Partial<Parameters<typeof ConsolidationScreen>[0]> = {}) {
  const onNavigate = vi.fn();
  render(<><ConsolidationScreen projectKey="pkg-1" roundId="round-c" onNavigate={onNavigate} {...props} /><ShortcutHelpHost /></>);
  await screen.findByRole("heading", { name: /^(Consolidate|Consolidation of) case-107 de v2$/ });
  return { onNavigate };
}

describe("ConsolidationScreen", () => {
  it("the screen shows the text path with Finalization current and the first open group", async () => {
    load(exampleView());
    await renderScreen();
    const path = screen.getByRole("navigation", { name: "Text path" });
    expect(path.textContent).toContain("Finalization");
    expect(path.textContent).toContain("consolidating, 4 of 8 groups open");
    expect(path.textContent).toContain("2 submitted");
    await waitFor(() => expect(expandedTitle()).toBe("muscular hypotonia"));
    // No internal ids, HPO codes shown.
    const text = document.body.textContent ?? "";
    for (const id of ["in-hl", "a-in-hl", "g-hypo", "ws-c", "round-c"]) expect(text).not.toContain(id);
    expect(text).toContain("HP:0001252");
    expect(text).not.toContain("·");
  });

  it("agreed groups are in the same list, marked agreed", async () => {
    load(exampleView());
    await renderScreen();
    const list = screen.getByRole("list", { name: "Groups" });
    const titles = [...list.querySelectorAll(".cons-group-title")].map(element => element.textContent);
    expect(titles).toEqual(["seizures", "muscular hypotonia", "Delayed development", "below the 3rd percentile", "Unsteady gait",
      "Normal hearing", "Short stature", "Recurrent fever"]);
    expect(within(list).getByRole("button", { name: /^seizures agreed/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Kept automatically" })).toBeNull();
  });

  it("collapses a resolved group, opens the next open one and offers Undo inline in its row (M-7g)", async () => {
    const after = withGroup(exampleView(), "g-hypo", { state: "choose", annotation_ids: ["cons-1"] });
    load(exampleView(), after, exampleView());
    const resolve = vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(5));
    await renderScreen();
    // The first open group is selected by an effect after the heading renders: wait for its check.
    await takeAbsentAndKeep();
    await waitFor(() => expect(expandedTitle()).toBe("Delayed development"));
    expect(resolve).toHaveBeenCalledTimes(1);
    const [workspaceId, envelope] = resolve.mock.calls[0];
    expect(workspaceId).toBe("ws-c");
    expect(envelope.expected_revision).toBe(3);
    expect(envelope.payload).toEqual({ input_ids: ["in-hl", "in-ht"], action: "choose", choice: { term_id: "HP:0001252", span_from_input_id: "in-hl", axes: { assertion: "absent" } } });
    expect(screen.getByRole("button", { name: /^muscular hypotonia decided: Hypotonia \(HP:0001252\), Absent, Patient, Current$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
    // No toast: the Undo sits in the decided row; the live region names the decision.
    expect(document.querySelector(".ui-toast-region .ui-toast")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo, muscular hypotonia" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("muscular hypotonia: Hypotonia (HP:0001252), Absent, Patient, Current.")).toBeTruthy());
    // Ctrl+Z in a text field stays the field's own undo.
    fireEvent.click(screen.getByRole("button", { name: "+ note" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note for the lead" }), { key: "z", ctrlKey: true });
    expect(reopen).not.toHaveBeenCalled();
    // Ctrl+Z elsewhere runs the inline Undo: the group reopens with its previous choice (F19).
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(reopen.mock.calls[0][1].payload).toEqual({ input_ids: ["in-hl", "in-ht"] });
    expect(reopen.mock.calls[0][1].expected_revision).toBe(4);
    await waitFor(() => expect(expandedTitle()).toBe("muscular hypotonia"));
    expect(screen.getByRole("button", { name: "Take Absent from Tom Reis for Assertion" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("More… > Reopen all decisions… asks with the count, reopens in one command and offers one Undo (R-10)", async () => {
    load(decidedView(), exampleView(), decidedView());
    const reopenAll = vi.spyOn(api, "reopenAllConsolidationGroups").mockResolvedValue(draft(4));
    const undo = vi.spyOn(api, "undoReopenAllConsolidationGroups").mockResolvedValue(draft(5));
    await renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "More task actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reopen all decisions…" }));
    const dialog = await screen.findByRole("dialog", { name: "Reopen 4 decided groups?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen all" }));
    await waitFor(() => expect(reopenAll).toHaveBeenCalledTimes(1));
    expect(reopenAll.mock.calls[0][1].payload).toEqual({ command: "consolidation_reopen_all" });
    const toast = await waitFor(() => document.querySelector(".ui-toast-region .ui-toast") as HTMLElement);
    expect(toast.textContent).toContain("Reopened 4 decided groups.");
    fireEvent.click(within(toast).getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(undo.mock.calls[0][1]).toMatchObject({ payload: { command: "consolidation_undo_reopen_all" } });
  });

  it("a failed Undo keeps the inline Undo available (M-7g)", async () => {
    const after = withGroup(exampleView(), "g-hypo", { state: "choose", annotation_ids: ["cons-1"] });
    load(exampleView(), after);
    vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockRejectedValue(new Error("offline"));
    await renderScreen();
    await takeAbsentAndKeep();
    fireEvent.click(await screen.findByRole("button", { name: "Undo, muscular hypotonia" }));
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Undo, muscular hypotonia" })).toBeTruthy();
  });

  it("J and K walk the open groups, not while typing, and are listed in the help", async () => {
    load(exampleView());
    await renderScreen();
    fireEvent.keyDown(window, { key: "j" });
    expect(expandedTitle()).toBe("Delayed development");
    await waitFor(() => expect(document.activeElement).toBe(toggle(/^Delayed development/)));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(expandedTitle()).toBe("muscular hypotonia"));
    fireEvent.click(screen.getByRole("button", { name: "+ note" }));
    const note = screen.getByLabelText("Note for the lead");
    note.focus();
    fireEvent.keyDown(note, { key: "j" });
    expect(expandedTitle()).toBe("muscular hypotonia");
    note.blur();
    fireEvent.keyDown(window, { key: "?" });
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Next open group")).toBeTruthy();
    expect(within(help).getByText("Previous open group")).toBeTruthy();
  });

  it("skips agreed groups with J and K and announces the ends", async () => {
    load(exampleView());
    await renderScreen();
    expect(expandedTitle()).toBe("muscular hypotonia");
    fireEvent.keyDown(window, { key: "k" });
    expect(expandedTitle()).toBe("muscular hypotonia");
    await waitFor(() => expect(document.body.textContent).toContain("First open group"));
    for (let step = 0; step < 3; step++) fireEvent.keyDown(window, { key: "j" });
    expect(expandedTitle()).toBe("Unsteady gait");
    fireEvent.keyDown(window, { key: "j" });
    expect(expandedTitle()).toBe("Unsteady gait");
    await waitFor(() => expect(document.body.textContent).toContain("Last open group"));
  });

  it("names the Undo shortcut of a decision in the help", async () => {
    const after = withGroup(exampleView(), "g-hypo", { state: "choose", annotation_ids: ["cons-1"] });
    load(exampleView(), after);
    vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    await renderScreen();
    await takeAbsentAndKeep();
    await screen.findByRole("button", { name: "Undo, muscular hypotonia" });
    fireEvent.keyDown(window, { key: "?" });
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Undo the last decision")).toBeTruthy();
    expect(within(help).queryByText("Undo the last plan change")).toBeNull();
  });

  it("lists the Undo shortcut in the help before the first decision (R-25)", async () => {
    load(exampleView());
    await renderScreen();
    fireEvent.keyDown(window, { key: "?" });
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Undo the last decision")).toBeTruthy();
  });

  it("shows header actions (guidelines, problem report) next to the title", async () => {
    load(exampleView());
    await renderScreen({ headerActions: <button type="button">Report a text problem</button> });
    expect(within(document.querySelector(".cons-header") as HTMLElement).getByRole("button", { name: "Report a text problem" })).toBeTruthy();
  });

  it("shows the guidelines notice inside the screen, right under its header (R-14)", async () => {
    load(exampleView());
    await renderScreen({ notice: <p>This project has guidelines (v1)</p> });
    const notice = screen.getByText("This project has guidelines (v1)");
    expect(notice.closest(".cons-screen")).toBeTruthy();
    expect(document.querySelector(".cons-header")?.nextElementSibling).toBe(notice);
  });

  it("lists added findings with their label: by you live, by the consolidator for the lead", async () => {
    mockViewport(1280);
    const [start, end] = span("last week");
    const added = [{ input_id: "ann-new", person_id: "ann-0005", annotation_id: "ann-new", term_id: "HP:0001250", term_label: "Seizure",
      layer_id: "phenotype", type_id: "default", axes: {}, spans: [[start, end] as [number, number]], cues: [], note: null, from_tool_proposal: false, modifiers: [] }];
    load({ ...decidedView(), added, added_by: "Ana Weber (ann-0005)" });
    await renderScreen({ assignmentId: 42 });
    const list = screen.getByRole("region", { name: "Added findings" });
    expect(within(list).getByRole("heading", { name: "Added by you" })).toBeTruthy();
    expect(list.textContent).toContain("Seizure (HP:0001250), “last week”");
    expect(document.querySelector(".cons-added")?.textContent).toBe("last week");
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    expect(within(screen.getByRole("dialog", { name: "Submit consolidation?" })).getByText("8 groups, 8 findings, 1 not in result")).toBeTruthy();
    cleanup();
    load({ ...decidedView(), read_only: true, read_only_reason: "submitted", workspace_id: null, added, added_by: "Ana Weber (ann-0005)" });
    await renderScreen({ readOnly: true });
    const lead = screen.getByRole("region", { name: "Added findings" });
    expect(within(lead).getByRole("heading", { name: "Added by Ana Weber" })).toBeTruthy();
    expect(lead.textContent).toContain("Seizure (HP:0001250)");
  });

  it("offers Back to documents in the lead's read-only view", async () => {
    load({ ...decidedView(), read_only: true, read_only_reason: "submitted", workspace_id: null });
    const back = { name: "projectDocuments" as const, key: "pkg-1", panel: "case-107:de" };
    const { onNavigate } = await renderScreen({ readOnly: true, back });
    expect(screen.getByRole("heading", { name: "Consolidation of case-107 de v2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Back to documents" }));
    expect(onNavigate).toHaveBeenCalledWith(back);
  });

  it("tells a lead consolidator to accept the result in Documents", async () => {
    load(decidedView());
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s-1" } as never);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([] as never);
    await renderScreen({ assignmentId: 42, lead: true });
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Submit consolidation?" })).getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Consolidation submitted. Accept the result in Documents.")).toBeTruthy();
  });

  it("adds a finding from a typed passage without a mouse selection", async () => {
    mockViewport(1280);
    load(exampleView());
    vi.spyOn(api, "searchOntology").mockResolvedValue({ route: "auto", query: "fever", shuffled: false, search_id: "search-1",
      candidates: [{ term_id: "HP:0001945", label: "Fever", definition: "", matched_term: "Fever", rank: 1 }] } as never);
    const save = vi.spyOn(api, "applyCommand").mockResolvedValue(draft(4));
    await renderScreen({ workspaceView: workspaceView() });
    fireEvent.click(screen.getByRole("button", { name: "Add finding" }));
    const form = await screen.findByRole("dialog", { name: "Add finding" });
    fireEvent.change(within(form).getByLabelText("Passage from the text"), { target: { value: "fever" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    const picker = await screen.findByRole("dialog", { name: "Add finding" });
    fireEvent.click(await within(picker).findByRole("option", { name: /Fever/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [start, end] = span("fever");
    expect(save.mock.calls[0][1].payload).toMatchObject({ term_id: "HP:0001945", segments: [{ start, end }] });
  });

  it("Submit is unavailable until every group is resolved", async () => {
    load(exampleView());
    await renderScreen();
    const submit = screen.getByRole("button", { name: "Submit consolidation" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(submit.getAttribute("aria-describedby")!)?.textContent).toBe("Resolve the 4 open groups first.");
    fireEvent.click(submit);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Ready to submit")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next open group" }));
    expect(expandedTitle()).toBe("Delayed development");
  });

  it("drops the inline Undo once the consolidation is submitted", async () => {
    load(withGroup(decidedView(), "g-hypo", { state: "open", note: null, annotation_ids: [] }), decidedView());
    vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    vi.spyOn(api, "submitWorkspace").mockResolvedValue({ submission_id: "s-1" } as never);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([] as never);
    await renderScreen({ assignmentId: 42 });
    await takeAbsentAndKeep();
    expect(await screen.findByRole("button", { name: /^Undo/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit consolidation" }).getAttribute("aria-disabled")).toBeNull());
    // Every group decided: the progress card turns green, reads Ready to submit, Submit is its one primary (B5-5, B5-6).
    const card = screen.getByText("Ready to submit").closest(".cons-progress")!;
    expect(card.classList.contains("cons-progress--ready")).toBe(true);
    expect(within(card as HTMLElement).getAllByRole("button").map(button => [button.textContent, button.className.includes("btn-primary")])).toEqual([["Submit consolidation", true]]);
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Submit consolidation?" })).getByRole("button", { name: "Submit" }));
    await screen.findByText("Consolidation submitted. The lead then accepts the result.");
    const path = screen.getByRole("navigation", { name: "Text path" }).textContent;
    expect(path).toContain("submitted, waiting for the lead");
    expect(path).not.toContain("needs work now");
    expect(screen.queryByText("Ready to submit")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("names a term kept by two groups in the submit summary (R-3)", async () => {
    const fatigue = { term_id: "HP:0012378", term_label: "Fatigue", layer_id: "phenotype", axes: {}, modifiers: [] };
    load(withGroup(withGroup(decidedView(), "g-hypo", { result: fatigue }), "g-micro", { result: fatigue }));
    await renderScreen({ assignmentId: 42 });
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    const dialog = screen.getByRole("dialog", { name: "Submit consolidation?" });
    expect(within(dialog).getByText("More than one finding with the same term: Fatigue.")).toBeTruthy();
  });

  it("submits after the one summary step, acknowledging an axis warning itself, and offers the next task", async () => {
    load(decidedView());
    const warning = new ApiError(409, "Check values", "AXIS_CONFIRMATION_WARNING", {
      acknowledgement: { draft_revision: 3, policy_revision: 1, warning_digest: "abc" }, warnings: [{ annotation_id: "cons-1", detail: { axis: "assertion" } }],
    });
    const submit = vi.spyOn(api, "submitWorkspace").mockRejectedValueOnce(warning).mockResolvedValue({ submission_id: "s-1" } as never);
    vi.spyOn(api, "listMyTasks").mockResolvedValue([
      { assignment_id: 42, project_key: "pkg-1", status: "in_progress", case_id: "case-107", language: "de" },
      { assignment_id: 43, project_key: "pkg-1", status: "assigned", case_id: "case-108", document_id: "doc-2", language: "de" },
    ] as never);
    const { onNavigate } = await renderScreen({ assignmentId: 42 });
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    const dialog = screen.getByRole("dialog", { name: "Submit consolidation?" });
    expect(within(dialog).getByText("8 groups, 7 findings, 1 not in result")).toBeTruthy();
    expect(within(dialog).queryByText(/same term/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await screen.findByText("Consolidation submitted. The lead then accepts the result.");
    expect(submit.mock.calls[0][1].payload).toEqual({ command: "submit_workspace", document_checked: true });
    expect(submit.mock.calls[1][1].payload).toEqual({ command: "submit_workspace", document_checked: true,
      warning_acknowledgement: { draft_revision: 3, policy_revision: 1, warning_digest: "abc" } });
    fireEvent.click(await screen.findByRole("button", { name: "Next task: case-108 de" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 43 });
    fireEvent.click(screen.getByRole("button", { name: "Back to my tasks" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks", status: "all" });
  });

  it("is read-only for the lead and opens the group from the route", async () => {
    load({ ...decidedView(), read_only: true, read_only_reason: "submitted", workspace_id: null, consolidator: "Carla Consolidator (ann-0006)" });
    await renderScreen({ group: "g-dd" });
    expect(expandedTitle()).toBe("Delayed development");
    expect(screen.getByText("Submitted by Carla Consolidator. Read-only; accept it in Documents.")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Text path" }).textContent).toContain("ready to accept");
    for (const name of [/^Submit/, /^Change/, "Not in result", "Open in full editor"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("Guidelines unclear here")).toBeNull();
    expect(api.openWorkRound).not.toHaveBeenCalled();
  });

  it("reads accepted on the path once the lead chose the final result (X-8)", async () => {
    load({ ...decidedView(), read_only: true, read_only_reason: "submitted", workspace_id: null, accepted_at: "2026-10-27T10:00:00" });
    await renderScreen({ assignmentId: 42 });
    const path = screen.getByRole("navigation", { name: "Text path" }).textContent;
    expect(path).toContain("accepted 27 Oct");
    expect(path).not.toContain("consolidating");
  });

  it("offers no action while an input is withdrawn", async () => {
    load({ ...exampleView(), read_only: true, read_only_reason: "input_withdrawn" });
    await renderScreen();
    expect(screen.getByText(/A submission used here was withdrawn/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take Absent from Tom Reis for Assertion" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Submit/ })).toBeNull();
  });

  it("lays out text and groups by width (1100 / 700 px) and hides the text on request", async () => {
    mockViewport(1280);
    load(exampleView());
    await renderScreen();
    expect(document.querySelector(".cons-layout-wide")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Clinical text" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide text" })).toBeNull();
    cleanup();
    mockViewport(900);
    await renderScreen();
    expect(document.querySelector(".cons-layout-medium")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide text" }));
    expect(screen.queryByRole("region", { name: "Clinical text" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show text" }));
    expect(screen.getByRole("region", { name: "Clinical text" })).toBeTruthy();
    cleanup();
    mockViewport(360);
    await renderScreen();
    expect(screen.queryByRole("region", { name: "Clinical text" })).toBeNull();
    expect(document.querySelectorAll(".cons-snippet").length).toBeGreaterThan(0);
  });

  it("draws one lane per person and names them in the legend", async () => {
    mockViewport(1280);
    load(exampleView());
    await renderScreen();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Line 1 (solid): Luc Martin (ann-0004)")).toBeTruthy();
    expect(within(legend).getByText("Line 2 (dashed): Tom Reis (ann-0007)")).toBeTruthy();
    const delayed = [...document.querySelectorAll<HTMLElement>(".cons-mark")].find(element => element.textContent === "Delayed ");
    expect(delayed?.dataset.lanes).toBe("1");
    const development = [...document.querySelectorAll<HTMLElement>(".cons-mark")].find(element => element.textContent === "development");
    expect(development?.dataset.lanes).toBe("1 2");
  });

  it("scrolls the selected group into view only when it is off-screen, instantly under reduced motion", async () => {
    mockViewport(1280, true);
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    load(exampleView());
    await renderScreen();
    expect(scroll).not.toHaveBeenCalled();
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5020, left: 0, right: 10, width: 10, height: 20, x: 0, y: 5000, toJSON: () => ({}) });
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" }));
    rect.mockRestore();
  });

  it("opens the editor for the consolidation task from the header's Open in full editor (M-7a)", async () => {
    load(exampleView());
    const { onNavigate } = await renderScreen({ assignmentId: 42, headerActions: <button type="button">Report a text problem</button> });
    expect(screen.queryByRole("button", { name: "Edit in editor…" })).toBeNull();
    const header = within(screen.getByRole("group", { name: "Task" }));
    expect(header.getAllByRole("button").map(button => button.textContent)).toEqual(["Open in full editor", "Report a text problem"]);
    const open = header.getByRole("button", { name: "Open in full editor" });
    expect(open.getAttribute("title")).toBe("For span changes and findings the comparison cannot express");
    fireEvent.click(open);
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 42, view: "editor" });
  });

  it("adds a finding everyone missed from selected text through the draft save", async () => {
    mockViewport(1280);
    load(exampleView());
    vi.spyOn(api, "searchOntology").mockResolvedValue({ route: "auto", query: "two", shuffled: false, search_id: "search-1",
      candidates: [{ term_id: "HP:0001250", label: "Seizure", definition: "", matched_term: "Seizure", rank: 1 }] } as never);
    const [start, end] = span("last week");
    const saved = draft(4, [{ annotation: { annotation_id: "ann-new", term_id: "HP:0001250" }, evidence: [{ mention: { segments: [{ start, end }] } }] }]);
    const save = vi.spyOn(api, "applyCommand").mockResolvedValue(saved);
    // After the save the view is read again: the server lists the added finding.
    vi.mocked(api.getConsolidation).mockResolvedValueOnce(exampleView()).mockResolvedValue({ ...exampleView(),
      added: [{ input_id: "ann-new", person_id: "ann-0009", annotation_id: "ann-new", term_id: "HP:0001250", term_label: "Seizure",
        layer_id: "phenotype", type_id: "default", axes: {}, spans: [[start, end]], cues: [], note: null, from_tool_proposal: false, modifiers: [] }], added_by: "Ada Judicator (ann-0009)" });
    await renderScreen({ workspaceView: workspaceView() });
    const add = screen.getByRole("button", { name: "Add finding" });
    const body = document.querySelector(".cons-text-body")!;
    const node = [...body.querySelectorAll<HTMLElement>("[data-start]")].find(element => element.textContent?.includes("last week"))!;
    const textNode = node.firstChild!;
    const offset = Number(node.dataset.start);
    const range = document.createRange();
    range.setStart(textNode, start - offset); range.setEnd(textNode, end - offset);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(body);
    fireEvent.click(add);
    const picker = await screen.findByRole("dialog", { name: "Add finding" });
    expect((within(picker).getByRole("combobox") as HTMLInputElement).value).toBe("last week");
    fireEvent.click(await within(picker).findByRole("option", { name: /Seizure/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const payload = save.mock.calls[0][1].payload;
    expect(payload).toMatchObject({ command: "create_annotation", layer_id: "phenotype", type_id: "default", term_id: "HP:0001250",
      segments: [{ start, end }], axes_values: { assertion: "present", experiencer: "patient", temporality: "current" } });
    await waitFor(() => expect(document.querySelector(".cons-added")?.textContent).toBe("last week"));
    expect(TEXT.slice(start, end)).toBe("last week");
  });

  it("reloads the view after a revision conflict", async () => {
    const spy = load(exampleView());
    vi.spyOn(api, "resolveConsolidationGroup").mockRejectedValue(new ApiError(409, "conflict", "REVISION_CONFLICT"));
    await renderScreen();
    await takeAbsentAndKeep();
    const review = await screen.findByRole("button", { name: "Review again" });
    expect(expandedTitle()).toBe("muscular hypotonia");
    await act(async () => { fireEvent.click(review); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});

describe("ConsolidationScreen, modifiers", () => {
  const people = [{ ...ANA, lane: 1 }, BEN];
  const [ss, se] = modSpan("schwere");
  const onSeizure = (state: Partial<ConsolidationGroupView> = {}) => seizure("g-seiz", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, []]], state);
  const onHypotonia = (state: Partial<ConsolidationGroupView> = {}) => group("g-hypo", ["modifiers_differ"], [
    member("h-a", ANA, "HP:0001252", "Hypotonia", [modSpan("Muskelhypotonie")]),
    member("h-b", BEN, "HP:0001252", "Hypotonia", [modSpan("Muskelhypotonie")], { modifiers: [severe("schwere")] }),
  ], state);
  const s9 = (seiz: Partial<ConsolidationGroupView> = {}) => exampleView({ text: MOD_TEXT, people, groups: [onSeizure(seiz), onHypotonia()] });
  const standalone = (state: Partial<ConsolidationGroupView> = {}) =>
    group("g-sev", ["partial", "modifier_as_finding"], [member("sev-a", ANA, "HP:0012828", "Severe", [modSpan("schwere")])], state);
  const kept = (state: Partial<ConsolidationGroupView> = { state: "keep", annotation_ids: ["cons-seiz"] }) =>
    group("g-seiz", ["partial"], [member("seiz-b", BEN, "HP:0001250", "Seizure", [modSpan("Krampfanfälle")])], state);
  const s18 = (sev: Partial<ConsolidationGroupView>, seiz?: Partial<ConsolidationGroupView>) =>
    exampleView({ text: MOD_TEXT, people, groups: [standalone(sev), kept(seiz)] });

  it("a cross-link hint selects the other group; the text names modifier texts in words (S9, DN-7)", async () => {
    mockViewport(1440);
    load(s9());
    await renderScreen();
    await waitFor(() => expect(expandedTitle()).toBe("Krampfanfälle"));
    const piece = [...document.querySelectorAll<HTMLElement>(".cons-mark")].find(element => element.textContent === "schwere")!;
    expect(piece.title).toBe("Severe, modifier of Seizure (Ana Weber); Severe, modifier of Hypotonia (Ben Roth)");
    expect(piece.nextElementSibling?.textContent).toBe(" (Severe, modifier of Seizure (Ana Weber); Severe, modifier of Hypotonia (Ben Roth))");
    expect(piece.classList.contains("cons-selected")).toBe(true);
    expect(document.body.textContent).not.toContain("·");
    fireEvent.click(screen.getByRole("link", { name: "Ben Roth linked “schwere” (Severe) to Hypotonia." }));
    await waitFor(() => expect(expandedTitle()).toBe("Muskelhypotonie"));
    expect(screen.getByRole("link", { name: "Ana Weber linked “schwere” (Severe) to Seizure." })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(toggle(/Muskelhypotonie/)));
  });

  it("several holders of one modifier text are named together", async () => {
    mockViewport(1440);
    load(exampleView({ text: MOD_TEXT, people, groups: [seizure("g-seiz", ["match"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere")]]])] }));
    await renderScreen();
    const piece = [...document.querySelectorAll<HTMLElement>(".cons-mark")].find(element => element.textContent === "schwere")!;
    expect(piece.title).toBe("Severe, modifier of Seizure (Ana Weber, Ben Roth)");
  });

  it("Keep collapses to decided with the modifiers and opens the next group; Undo reopens with the previous choices (S21, F19)", async () => {
    load(s9(), s9({ state: "choose", annotation_ids: ["cons-1"] }), s9());
    const resolve = vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(5));
    await renderScreen();
    await waitFor(() => expect(expandedTitle()).toBe("Krampfanfälle"));
    fireEvent.click(screen.getByRole("button", { name: "Take Severe “schwere” from Ana Weber for Modifiers" }));
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(expandedTitle()).toBe("Muskelhypotonie"));
    expect(resolve.mock.calls[0][1].payload).toEqual({ input_ids: ["g-seiz-0", "g-seiz-1"], action: "choose", choice: {
      term_id: "HP:0001250", span_from_input_id: "g-seiz-0", axes: {}, modifiers: [{ term_id: "HP:0012828", segments: [{ start: ss, end: se }] }] } });
    expect(screen.getByRole("button", { name: "Krampfanfälle decided: Seizure (HP:0001250), Present, Patient, Current, modifiers: Severe “schwere”" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(reopen.mock.calls[0][1].payload).toEqual({ input_ids: ["g-seiz-0", "g-seiz-1"] });
    await waitFor(() => expect(expandedTitle()).toBe("Krampfanfälle"));
    expect(screen.getByRole("button", { name: "Take Severe “schwere” from Ana Weber for Modifiers" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Take No modifiers from Ben Roth for Modifiers" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
  });

  it("Change on a resolved modifier group sends the reopen (S21)", async () => {
    load(s9({ state: "choose", annotation_ids: ["cons-1"] }), s9());
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(4));
    await renderScreen();
    await changeRow("Krampfanfälle");
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(expandedTitle()).toBe("Krampfanfälle"));
    expect(screen.getByRole("button", { name: "Take Severe “schwere” from Ana Weber for Modifiers" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reopening an attach removes the attached modifier from the target (S18, S21)", async () => {
    load(s18({ state: "leave_out", attached_to: "cons-seiz" }), s18({}));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(4));
    await renderScreen({ group: "g-seiz" });
    expect(screen.getByText("Attached modifier: Severe “schwere” from Ana Weber")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^schwere attached$/ })).toBeTruthy();
    await changeRow("schwere");
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(reopen.mock.calls[0][1].payload).toEqual({ input_ids: ["sev-a"] });
    await waitFor(() => expect(screen.queryByText(/^Attached modifier/)).toBeNull());
  });

  it("reopening the target also reopens the standalone group (S21 B)", async () => {
    load(s18({ state: "leave_out", attached_to: "cons-seiz" }), s18({}, { state: "open", annotation_ids: [] }));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(4));
    await renderScreen();
    await changeRow("Krampfanfälle");
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(reopen.mock.calls[0][1].payload).toEqual({ input_ids: ["seiz-b"] });
    await waitFor(() => expect(screen.getByRole("button", { name: /^schwere to decide/ })).toBeTruthy());
  });

  it("a warning that changes between the two submit calls is shown, nothing is submitted", async () => {
    load(decidedView());
    const warning = (digest: string) => new ApiError(409, "Check values", "AXIS_CONFIRMATION_WARNING", {
      acknowledgement: { draft_revision: 3, policy_revision: 1, warning_digest: digest }, warnings: [{ annotation_id: "cons-1", rule: "cohort_modifier" }],
    });
    vi.spyOn(api, "submitWorkspace").mockRejectedValueOnce(warning("abc")).mockRejectedValueOnce(warning("def"));
    await renderScreen({ assignmentId: 42 });
    fireEvent.click(screen.getByRole("button", { name: "Submit consolidation" }));
    const dialog = screen.getByRole("dialog", { name: "Submit consolidation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    expect(await within(dialog).findByText("The consolidation changed while submitting. Submit again.")).toBeTruthy();
    expect(screen.queryByText(/^Consolidation submitted/)).toBeNull();
  });
});

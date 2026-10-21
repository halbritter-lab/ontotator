import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type ConsolidationView } from "../../src/api/client";
import { ConsolidationScreen } from "../../src/consolidation/ConsolidationScreen";
import { ShortcutHelpHost } from "../../src/ui/ShortcutHelp";
import { decidedView, draft, exampleView, mockViewport, resetViewport, span, TEXT, withGroup, workspaceView } from "./fixtures";

beforeEach(() => { vi.restoreAllMocks(); resetViewport(); });
afterEach(() => { cleanup(); resetViewport(); });

const toggle = (name: RegExp) => screen.getByRole("button", { name, expanded: true });
const expandedTitle = () => document.querySelector(".cons-group-expanded .cons-group-title")?.textContent;

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
  await screen.findByRole("heading", { name: "Consolidate case-107 · de v2" });
  return { onNavigate };
}

describe("ConsolidationScreen", () => {
  it("shows the header, the automatic banner and the first open group", async () => {
    load(exampleView());
    await renderScreen();
    expect(screen.getByText("Luc Martin, Tom Reis · 4 open")).toBeTruthy();
    expect(screen.getByText("4 findings matched and were kept automatically. Check them in the text.")).toBeTruthy();
    // More than 3 matches: the list starts collapsed behind "Show".
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("aria-expanded")).toBe("false");
    expect(expandedTitle()).toBe("Hypotonia");
    // No internal ids, HPO codes shown.
    const text = document.body.textContent ?? "";
    for (const id of ["in-hl", "a-in-hl", "g-hypo", "ws-c", "round-c"]) expect(text).not.toContain(id);
    expect(text).toContain("HP:0001252");
  });

  it("expands the automatic list by default with up to 3 matches", async () => {
    const view = exampleView();
    load({ ...view, groups: view.groups.filter(value => value.group_id !== "g-fever") });
    await renderScreen();
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses a resolved group, opens the next open one and offers Undo", async () => {
    const after = withGroup(exampleView(), "g-hypo", { state: "choose", annotation_ids: ["cons-1"] });
    load(exampleView(), after, exampleView());
    const resolve = vi.spyOn(api, "resolveConsolidationGroup").mockResolvedValue(draft(4));
    const reopen = vi.spyOn(api, "reopenConsolidationGroup").mockResolvedValue(draft(5));
    await renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "absent · Tom Reis" }));
    await waitFor(() => expect(expandedTitle()).toBe("Global developmental delay"));
    expect(resolve).toHaveBeenCalledTimes(1);
    const [workspaceId, envelope] = resolve.mock.calls[0];
    expect(workspaceId).toBe("ws-c");
    expect(envelope.expected_revision).toBe(3);
    expect(envelope.payload).toEqual({ input_ids: ["in-hl", "in-ht"], action: "choose", choice: { term_id: "HP:0001252", span_from_input_id: "in-hl", axes: { assertion: "absent" } } });
    expect(screen.getByRole("button", { name: /^Hypotonia ✓ absent \(Tom Reis\)$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change, Hypotonia" })).toBeTruthy();
    expect(screen.getByText("Hypotonia: absent (Tom Reis).")).toBeTruthy();
    // Ctrl+Z runs the toast's Undo: the group reopens.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(reopen.mock.calls[0][1].payload).toEqual({ input_ids: ["in-hl", "in-ht"] });
    expect(reopen.mock.calls[0][1].expected_revision).toBe(4);
    await waitFor(() => expect(expandedTitle()).toBe("Hypotonia"));
  });

  it("moves between groups with J and K, not while typing, and lists them in the help", async () => {
    load(exampleView());
    await renderScreen();
    fireEvent.keyDown(window, { key: "j" });
    expect(expandedTitle()).toBe("Global developmental delay");
    await waitFor(() => expect(document.activeElement).toBe(toggle(/^Global developmental delay/)));
    fireEvent.keyDown(window, { key: "k" });
    expect(expandedTitle()).toBe("Hypotonia");
    fireEvent.click(screen.getByRole("button", { name: "+ note" }));
    const note = screen.getByLabelText("Note for the lead");
    note.focus();
    fireEvent.keyDown(note, { key: "j" });
    expect(expandedTitle()).toBe("Hypotonia");
    note.blur();
    fireEvent.keyDown(window, { key: "?" });
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getByText("Next group")).toBeTruthy();
    expect(within(help).getByText("Previous group")).toBeTruthy();
  });

  it("keeps Submit unavailable with a reason and Next open group while groups are open", async () => {
    load(exampleView());
    await renderScreen();
    const submit = screen.getByRole("button", { name: "Submit · 4 open" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(submit.getAttribute("aria-describedby")!)?.textContent).toBe("Resolve the 4 open groups first.");
    fireEvent.click(submit);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next open group" }));
    expect(expandedTitle()).toBe("Global developmental delay");
  });

  it("submits after the summary, acknowledges an axis warning and offers the next task", async () => {
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
    expect(within(dialog).getByText("8 decisions → 7 findings: 4 kept automatically (all matched) · 2 decided · 1 kept from Luc Martin · 1 left out · 1 note · 1 flagged")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await within(dialog).findByLabelText("I checked these values");
    expect(submit.mock.calls[0][1].payload).toEqual({ command: "submit_workspace", document_checked: true });
    expect(within(dialog).getByRole("button", { name: "Submit" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(dialog).getByLabelText("I checked these values"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await screen.findByText("Consolidation submitted. The lead accepts it as the final result.");
    expect(submit.mock.calls[1][1].payload).toEqual({ command: "submit_workspace", document_checked: true,
      warning_acknowledgement: { draft_revision: 3, policy_revision: 1, warning_digest: "abc" } });
    fireEvent.click(await screen.findByRole("button", { name: "Next task: case-108 (de)" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "task", assignmentId: 43 });
    fireEvent.click(screen.getByRole("button", { name: "Back to my tasks" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "tasks" });
  });

  it("is read-only for the lead and opens the group from the route", async () => {
    load({ ...decidedView(), read_only: true, read_only_reason: "submitted", workspace_id: null });
    await renderScreen({ group: "g-dd" });
    expect(expandedTitle()).toBe("Global developmental delay");
    expect(screen.getByText("This consolidation was submitted. You see its final state.")).toBeTruthy();
    for (const name of [/^Submit/, /^Change/, "Leave out", "Edit in editor…"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("Guidelines unclear here")).toBeNull();
    expect(api.openWorkRound).not.toHaveBeenCalled();
  });

  it("offers no action while an input is withdrawn", async () => {
    load({ ...exampleView(), read_only: true, read_only_reason: "input_withdrawn" });
    await renderScreen();
    expect(screen.getByText(/A submission used here was withdrawn/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "absent · Tom Reis" })).toBeNull();
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
    expect(within(legend).getByText("Line 1: Luc Martin (ann-0004)")).toBeTruthy();
    expect(within(legend).getByText("Line 2: Tom Reis (ann-0007)")).toBeTruthy();
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

  it("opens the editor for the consolidation task from Edit in editor…", async () => {
    load(exampleView());
    const { onNavigate } = await renderScreen({ assignmentId: 42 });
    fireEvent.click(screen.getByRole("button", { name: "Edit in editor…" }));
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
    await renderScreen({ workspaceView: workspaceView() });
    const add = screen.getByRole("button", { name: "Add finding" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    const body = document.querySelector(".cons-text-body")!;
    const node = [...body.querySelectorAll<HTMLElement>("[data-start]")].find(element => element.textContent?.includes("last week"))!;
    const textNode = node.firstChild!;
    const offset = Number(node.dataset.start);
    const range = document.createRange();
    range.setStart(textNode, start - offset); range.setEnd(textNode, end - offset);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(body);
    expect(add.getAttribute("aria-disabled")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "absent · Tom Reis" }));
    const review = await screen.findByRole("button", { name: "Review again" });
    expect(expandedTitle()).toBe("Hypotonia");
    await act(async () => { fireEvent.click(review); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});

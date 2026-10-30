import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ConsolidationGroupView } from "../../src/api/client";
import { GroupCard, type GroupCardProps } from "../../src/consolidation/GroupCard";
import { ANA, BEN, exampleGroups, group, hypotoniaThree, LUC, member, MOD_PEOPLE, MOD_TEXT, modSpan, recurrent, seizure, severe, span, TEXT, THREE, TOM, workspaceView } from "./fixtures";

afterEach(cleanup);

const byId = (id: string) => exampleGroups().find(value => value.group_id === id)!;

function renderCard(value: ConsolidationGroupView, extra: Partial<GroupCardProps> = {}) {
  const props: GroupCardProps = {
    group: value, people: [LUC, TOM], text: TEXT, expanded: true, readOnly: false, busy: false,
    onExpand: vi.fn(), onResolve: vi.fn(async () => true), onAnnotate: vi.fn(async () => true), onReopen: vi.fn(async () => true),
    onDismissOutcome: vi.fn(), ...extra,
  };
  const view = render(<ul><GroupCard {...props} /></ul>);
  return { props, container: view.container };
}

const result = () => document.querySelector(".cons-result")?.textContent ?? "";
const keep = () => fireEvent.click(screen.getByRole("button", { name: "Keep" }));

describe("GroupCard", () => {
  it("the card shows the conflict marker, the name and the count of fields to decide", () => {
    renderCard(hypotoniaThree(), { people: THREE });
    const toggle = screen.getByRole("button", { expanded: true });
    expect(toggle.textContent).toContain("muscular hypotonia");
    expect(toggle.textContent).toContain("2 fields to decide");
    expect(within(toggle).getByText("Conflict")).toBeTruthy();
  });

  it("a choice only stages; Keep saves once every conflicting row has a choice (M-7d)", () => {
    const { props } = renderCard(hypotoniaThree(), { people: THREE });
    const take = screen.getByRole("button", { name: "Take Absent from Mia Berg for Assertion" });
    expect(result()).not.toContain("Not saved yet.");
    fireEvent.click(take);
    expect(take.getAttribute("aria-pressed")).toBe("true");
    expect(result()).toContain("Absent");
    expect(result()).toContain("Not saved yet.");
    // R-18: no space before a comma, and a full stop before the staged note.
    expect(result()).toMatch(/Absent, \w+, \w+\. Not saved yet\./);
    // The term is still open: the line names no term and nothing as not taken (#160); Keep is unavailable with its reason.
    expect(result()).toContain("Term not chosen yet");
    expect(result()).not.toContain("Not taken");
    const button = screen.getByRole("button", { name: "Keep" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("Choose a value in each highlighted row first.");
    keep();
    expect(props.onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take Hypotonia from Tom Reis for Term" }));
    expect(result()).toContain("Not taken: Axial hypotonia (Ali)");
    expect(props.onResolve).not.toHaveBeenCalled();
    keep();
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-tom", "in-mia", "in-ali"], action: "choose",
      choice: { term_id: "HP:0001252", span_from_input_id: "in-tom", axes: { assertion: "absent" } },
    }, "Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("hints when the result repeats a term another group already keeps (R-3)", () => {
    const spanless = group("g-f", ["partial"], [member("in-f", TOM, "HP:0012378", "Fatigue", [])]);
    const other = group("g-f2", ["partial"], [member("in-g", LUC, "HP:0012378", "Fatigue", [span("hypotonia")])], { state: "keep",
      result: { term_id: "HP:0012378", term_label: "Fatigue", layer_id: "phenotype", axes: {}, modifiers: [], spans: [span("hypotonia")] } });
    renderCard(spanless, { groups: [other, spanless] });
    expect(screen.getByText("Fatigue is already in the result (“hypotonia”). Keep adds a second Fatigue finding.")).toBeTruthy();
    cleanup();
    renderCard(spanless, { groups: [spanless] });
    expect(screen.queryByText(/is already in the result/)).toBeNull();
  });

  it("does not hint when the other group keeps the term on a separate span (#132)", () => {
    const here = group("g-f", ["partial"], [member("in-f", TOM, "HP:0012378", "Fatigue", [span("Unsteady gait")])]);
    const result = { term_id: "HP:0012378", term_label: "Fatigue", layer_id: "phenotype", axes: {}, modifiers: [] };
    const elsewhere = group("g-f2", ["partial"], [member("in-g", LUC, "HP:0012378", "Fatigue", [span("hypotonia")])], { state: "keep",
      result: { ...result, spans: [span("hypotonia")] } });
    renderCard(here, { groups: [elsewhere, here] });
    expect(screen.queryByText(/is already in the result/)).toBeNull();
    cleanup();
    const overlapping = group("g-f3", ["partial"], [member("in-h", LUC, "HP:0012378", "Fatigue", [span("Unsteady")])], { state: "keep",
      result: { ...result, spans: [span("Unsteady")] } });
    renderCard(here, { groups: [elsewhere, overlapping, here] });
    expect(screen.getByText("Fatigue is already in the result (“Unsteady”). Keep adds a second Fatigue finding.")).toBeTruthy();
  });

  it("a decided group shows what was kept without this session's summary, also read-only (R-2)", () => {
    const decided = hypotoniaThree({ state: "choose", annotation_ids: ["cons-1"],
      result: { term_id: "HP:0001252", term_label: "Hypotonia", layer_id: "phenotype", axes: { assertion: "absent", experiencer: "patient", temporality: "current" }, modifiers: [], spans: [span("muscular hypotonia")] } });
    renderCard(decided, { people: THREE, readOnly: true });
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("decided: Hypotonia (HP:0001252), Absent, Patient, Current");
    expect(result()).toBe("Result: 1 finding, Hypotonia (HP:0001252), Absent, Patient, Current");
    const assertion = screen.getByRole("rowheader", { name: "Assertion" }).closest("tr")!;
    expect(within(assertion).getAllByText("kept")).toHaveLength(1);
    expect(within(assertion).getByText("kept").closest("td")!.textContent).toContain("Absent");
  });

  it("agreed rows are one grey line", () => {
    renderCard(hypotoniaThree(), { people: THREE });
    const cells = [...document.querySelectorAll(".cons-agreed")].filter(cell => cell.textContent === "Patient (all agree)");
    expect(cells).toHaveLength(1);
    expect(cells[0].querySelector(".axis-value--patient")?.textContent).toBe("Patient");
  });

  it("axis values use the fixed colour slots", () => {
    renderCard(byId("g-hypo"));
    const row = screen.getByRole("row", { name: /Assertion/ });
    expect(within(row).getByText("Present").classList.contains("axis-value--present")).toBe(true);
  });

  it("no pill buttons and no differs text", () => {
    const { container } = renderCard(hypotoniaThree(), { people: THREE });
    expect(screen.queryByText(/differs/)).toBeNull();
    expect(container.querySelector(".cons-chip")).toBeNull();
    expect(container.textContent).not.toContain("·");
  });

  it("resolves a value group with two axes only after both choices", () => {
    const value = group("g-two", ["values_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent", experiencer: "patient", temporality: "historical" } }),
    ], { differing_axes: ["assertion", "temporality"] });
    const { props } = renderCard(value);
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("2 fields to decide");
    fireEvent.click(screen.getByRole("button", { name: "Take Absent from Tom Reis for Assertion" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Current from Luc Martin for Temporality" }));
    expect(props.onResolve).not.toHaveBeenCalled();
    keep();
    expect(props.onResolve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice?.axes).toEqual({ assertion: "absent", temporality: "current" });
  });

  it("has no per-person whole-finding shortcut (M-7d)", () => {
    renderCard(hypotoniaThree(), { people: THREE });
    expect(screen.queryByRole("button", { name: /'s finding$/ })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "Whole finding" })).toBeNull();
  });

  it("asks to keep a finding only one person marked or to leave it out of the result (M-7f)", () => {
    const { props } = renderCard(byId("g-micro"));
    expect(screen.getByText("Luc Martin marked this. Tom Reis has nothing here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep Luc Martin's finding" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["in-ml"], action: "keep" }, "Microcephaly (HP:0000252), Present, Patient, Current");
    fireEvent.click(screen.getByRole("button", { name: "Not in result" }));
    expect(props.onResolve).toHaveBeenLastCalledWith({ input_ids: ["in-ml"], action: "leave_out" }, "not in result");
    expect(screen.queryByRole("button", { name: "Leave out" })).toBeNull();
  });

  it("shows each person's colour key next to their column", () => {
    renderCard(byId("g-hypo"));
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map(header => header.querySelector(".cons-lane-key")?.getAttribute("data-lane"))).toEqual(["1", "2"]);
  });

  it("findings from a tool proposal carry the robot icon", () => {
    renderCard(hypotoniaThree({}, { mia: { from_tool_proposal: true } }), { people: THREE });
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    const named = (name: string) => headers.find(header => header.textContent?.includes(name))!;
    expect(within(named("Mia Berg")).getByRole("img", { name: "From a tool proposal" })).toBeTruthy();
    expect(within(named("Tom Reis")).queryByRole("img", { name: "From a tool proposal" })).toBeNull();
  });

  it("offers Keep, Not in result and More… (Edit values…, Other term…) on a reopened match (M-7c)", () => {
    const reopened = { ...byId("g-seiz"), state: "open" as const, annotation_ids: [] };
    const { props, container } = renderCard(reopened, { workspace: workspaceView() });
    const actions = container.querySelector(".cons-group-body > .cons-actions")!;
    expect(within(actions as HTMLElement).getAllByRole("button").map(button => button.textContent)).toEqual(["Keep", "Not in result", "More…"]);
    expect(actions.querySelector(".btn-primary")?.textContent).toBe("Keep");
    // One size across the row (B5-3).
    expect(within(actions as HTMLElement).getAllByRole("button").filter(button => button.classList.contains("btn-sm"))).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Edit in editor/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^More actions/ }));
    expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Edit values…", "Other term…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit values…" }));
    fireEvent.change(screen.getByLabelText("Assertion"), { target: { value: "absent" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep with these values" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["g-seiz-l", "g-seiz-t"], action: "choose",
      choice: { term_id: "HP:0001250", span_from_input_id: "g-seiz-l", axes: { assertion: "absent", experiencer: "patient", temporality: "current" } },
    }, "Absent, Patient, Current");
  });

  it("sends the note and the flag with the decision of an open group", () => {
    const { props } = renderCard(byId("g-hypo"));
    fireEvent.click(screen.getByRole("button", { name: "+ note" }));
    fireEvent.change(screen.getByLabelText("Note for the lead"), { target: { value: "Negated in the text." } });
    fireEvent.click(screen.getByLabelText("Guidelines unclear here"));
    expect(props.onAnnotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take Absent from Tom Reis for Assertion" }));
    keep();
    expect(props.onResolve).toHaveBeenCalledWith(expect.objectContaining({ note: "Negated in the text.", guidelines_unclear: true, action: "choose" }),
      "Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("shows the note of a closed group in the list, not only after opening it (#198)", () => {
    const long = `Negated in the text, ${"x".repeat(80)}`;
    renderCard({ ...byId("g-hypo"), state: "choose", note: `${long}\nSecond line.`, guidelines_unclear: true }, { expanded: false });
    const preview = document.querySelector(".cons-note-preview")!;
    expect(preview.textContent).toBe(`Note: ${long.slice(0, 79)}…`);
    expect(preview.getAttribute("title")).toBe(`${long}\nSecond line.`);
    cleanup();
    renderCard({ ...byId("g-hypo"), state: "choose", note: "Short.\nMore." }, { expanded: false });
    expect(document.querySelector(".cons-note-preview")!.textContent).toBe("Note: Short. …");
    cleanup();
    renderCard({ ...byId("g-hypo"), state: "choose", note: "Short." });
    expect(document.querySelector(".cons-note-preview")).toBeNull();
  });

  it("shows each person's overlapping passage, the default one marked: Keep takes the default member (#159)", () => {
    const value = { ...byId("g-dd"), kinds: ["span_differs", "notes_differ"],
      members: byId("g-dd").members.map((item, index) => ({ ...item, note: index ? "Late." : "Early." })) };
    const { props } = renderCard(value);
    const row = screen.getByRole("rowheader", { name: "Text" }).closest("tr")!;
    expect(row.className).not.toContain("cons-row--conflict");
    expect([...row.querySelectorAll("td")].map(cell => cell.textContent)).toEqual(["“Delayed development”", "“development”"]);
    expect(screen.getByRole("button", { name: "Take “Delayed development” from Luc Martin for Text" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Take “development” from Tom Reis for Text" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("rowheader", { name: "Note" })).toBeTruthy();
    expect(result()).toBe("Result: 1 finding, Global developmental delay (HP:0001263), Present, Patient, Current, text “Delayed development”");
    expect(screen.getByRole("button", { name: "Keep" }).getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["in-dl", "in-dt"], action: "keep" },
      "Global developmental delay (HP:0001263), Present, Patient, Current, text “Delayed development”");
  });

  it("a ✓ chooses another person's overlapping passage, with its evidence and note (#159)", () => {
    const { props } = renderCard(byId("g-dd"));
    fireEvent.click(screen.getByRole("button", { name: "Take “development” from Tom Reis for Text" }));
    expect(screen.getByRole("button", { name: "Take “development” from Tom Reis for Text" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Take “Delayed development” from Luc Martin for Text" }).getAttribute("aria-pressed")).toBe("false");
    expect(result()).toContain("text “development”. Not saved yet.");
    keep();
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-dl", "in-dt"], action: "choose", choice: { term_id: "HP:0001263", span_from_input_id: "in-dt", axes: {} },
    }, "Global developmental delay (HP:0001263), Present, Patient, Current, text “development”");
  });

  it("marks the kept passage and modifiers in a decided group, also read-only (#163)", () => {
    const decided = { ...byId("g-dd"), state: "choose" as const, annotation_ids: ["cons-2"],
      result: { term_id: "HP:0001263", term_label: "Global developmental delay", layer_id: "phenotype", axes: { assertion: "present", experiencer: "patient", temporality: "current" },
        modifiers: [], spans: [span("development")] } };
    renderCard(decided, { readOnly: true });
    expect(result()).toBe("Result: 1 finding, Global developmental delay (HP:0001263), Present, Patient, Current, text “development”");
    const row = screen.getByRole("rowheader", { name: "Text" }).closest("tr")!;
    expect(within(row).getAllByText("kept")).toHaveLength(1);
    expect(within(row).getByText("kept").closest("td")!.textContent).toBe("“development”kept");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("asks the text when the spans conflict", () => {
    const { props } = renderCard({ ...byId("g-dd"), span_conflict: true });
    expect(screen.getByRole("button", { name: "Keep" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Take “development” from Tom Reis for Text" }));
    keep();
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-dl", "in-dt"], action: "choose", choice: { term_id: "HP:0001263", span_from_input_id: "in-dt", axes: {} },
    }, "Global developmental delay (HP:0001263), Present, Patient, Current, text “development”");
  });

  it("renders no text node inside a table row", () => {
    renderCard(byId("g-hypo"));
    for (const row of screen.getByRole("table").querySelectorAll("tr")) {
      expect([...row.childNodes].every(node => node.nodeType === Node.ELEMENT_NODE)).toBe(true);
    }
  });

  it("marks an automatically kept group agreed and flags it through annotate", () => {
    const { props } = renderCard(byId("g-seiz"));
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("agreed");
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Guidelines unclear here"));
    expect(props.onAnnotate).toHaveBeenCalledWith({ input_ids: ["g-seiz-l", "g-seiz-t"], guidelines_unclear: true });
  });

  it("keeps a failed decision open with Retry", () => {
    const onRetry = vi.fn();
    renderCard(byId("g-hypo"), { outcome: { kind: "error", onRetry } });
    expect(screen.getByRole("alert").textContent).toContain("Could not save. Nothing changed.");
    expect(screen.getByRole("button", { name: "Take Absent from Tom Reis for Assertion" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the conflict outcome with Review again", () => {
    const onReview = vi.fn();
    renderCard(byId("g-hypo"), { outcome: { kind: "conflict", onReview } });
    expect(screen.getByRole("alert").textContent).toContain("This consolidation changed elsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    expect(onReview).toHaveBeenCalled();
  });

  it("warns before reopening a group edited in the editor", () => {
    const edited = { ...byId("g-hypo"), state: "choose" as const, edited: true, annotation_ids: ["cons-1"] };
    const { props } = renderCard(edited, { expanded: false, summary: "Hypotonia (HP:0001252), Absent, Patient, Current" });
    expect(screen.getByRole("button", { name: /muscular hypotonia decided: Hypotonia \(HP:0001252\), Absent, Patient, Current edited in editor/ })).toBeTruthy();
    // M-7b: the collapsed row has no Reopen button of its own.
    expect(screen.queryByRole("button", { name: /^Reopen/ })).toBeNull();
    cleanup();
    renderCard(edited, { expanded: true, onReopen: props.onReopen });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(props.onReopen).not.toHaveBeenCalled();
    expect(screen.getByText("Reopening drops your edit from the editor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(props.onReopen).toHaveBeenCalled();
  });

  it("Reopen preselects the decided result's values; a bulk reopen (not restoring) does not (R-10)", () => {
    const decided = { ...byId("g-hypo"), state: "choose" as const, annotation_ids: ["cons-1"] };
    for (const restoring of [true, false]) {
      const { props } = renderCard(decided, { result: { term_id: "HP:0001252", axes_values: { assertion: "absent" } } });
      const view = render(<ul><GroupCard {...props} /></ul>);
      view.rerender(<ul><GroupCard {...props} group={byId("g-hypo")} result={null} restoring={restoring} /></ul>);
      expect(within(view.container).getByRole("button", { name: "Take Absent from Tom Reis for Assertion" }).getAttribute("aria-pressed")).toBe(String(restoring));
      cleanup();
    }
  });

  it("shows a text snippet of the passage below 700 px", () => {
    renderCard(byId("g-hypo"), { narrow: true, expanded: false });
    expect(screen.getByText("muscular hypotonia", { selector: "mark" })).toBeTruthy();
  });

  it("a reopened group starts without the old choices", () => {
    const props: GroupCardProps = {
      group: hypotoniaThree(), people: THREE, text: TEXT, expanded: true, readOnly: false, busy: false, onExpand: vi.fn(),
      onResolve: vi.fn(async () => true), onAnnotate: vi.fn(async () => true), onReopen: vi.fn(async () => true), onDismissOutcome: vi.fn(),
    };
    const view = render(<ul><GroupCard {...props} /></ul>);
    const rerender = (state: ConsolidationGroupView["state"]) => view.rerender(<ul><GroupCard {...props} group={hypotoniaThree({ state })} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Take Absent from Mia Berg for Assertion" }));
    rerender("choose");
    rerender("open");
    fireEvent.click(screen.getByRole("button", { name: "Take Hypotonia from Tom Reis for Term" }));
    keep();
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it("takes a person who left a differing axis empty: shown as Not specified, sent as null", () => {
    const value = hypotoniaThree({ differing_axes: ["assertion", "temporality"] }, { ali: { axes: { assertion: "present", experiencer: "patient" } } });
    const { props } = renderCard(value, { people: THREE });
    expect(within(screen.getByRole("row", { name: /Temporality/ })).getByText("Not specified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take Axial hypotonia from Ali Kaya for Term" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Present from Ali Kaya for Assertion" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Not specified from Ali Kaya for Temporality" }));
    keep();
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice?.axes).toEqual({ assertion: "present", temporality: null });
  });

  it("a resolved table has no conflict mark or tint", () => {
    const { container } = renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"] });
    expect(container.querySelector(".cons-row--conflict, .cons-conflict-mark")).toBeNull();
  });

  it("offers no actions when read-only", () => {
    renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"], guidelines_unclear: true }, { readOnly: true });
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    expect(screen.queryByLabelText("Guidelines unclear here")).toBeNull();
    expect(screen.getByText("Flagged: guidelines unclear")).toBeTruthy();
  });
});

describe("GroupCard, inline Undo (M-7g)", () => {
  it("the row of the last decision offers Undo; other rows do not", () => {
    const onUndo = vi.fn();
    renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"] }, { expanded: false, summary: "Hypotonia (HP:0001252), Absent, Patient, Current", onUndo });
    const undo = screen.getByRole("button", { name: "Undo, muscular hypotonia" });
    expect(undo.getAttribute("aria-keyshortcuts")).toBe("Control+Z Meta+Z");
    // In the row, in the look of the app's toast (B5-4).
    expect(undo.closest(".ui-toast")?.textContent).toBe("Decision savedUndo");
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalled();
    cleanup();
    renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"] }, { expanded: false });
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });
});

describe("GroupCard, modifiers", () => {
  const mod = { people: MOD_PEOPLE, text: MOD_TEXT, workspace: workspaceView() };
  const editValues = () => { fireEvent.click(screen.getByRole("button", { name: /^More actions/ })); fireEvent.click(screen.getByRole("menuitem", { name: "Edit values…" })); };
  const [ss, se] = modSpan("schwere"), [rs, re] = modSpan("wiederholt");
  const s4 = () => seizure("g-s4", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [recurrent("wiederholt")]]]);

  it("S4: checks send nothing; Keep becomes available after the first check and sends both modifiers (DN-11)", () => {
    const { props } = renderCard(s4(), mod);
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("1 field to decide");
    expect(screen.getByRole("button", { name: "Keep" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Take Ana's finding/ })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "Whole finding" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take Recurrent “wiederholt” from Ben Roth for Modifiers" }));
    expect(screen.getByRole("button", { name: "Keep" }).getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take Severe “schwere” from Ana Weber for Modifiers" }));
    expect(props.onResolve).not.toHaveBeenCalled();
    expect(result()).toContain("modifiers: Recurrent “wiederholt”, Severe “schwere”");
    expect(screen.getByRole("button", { name: "Not in result" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit in editor…" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^More actions/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["g-s4-0", "g-s4-1"], action: "choose", choice: {
      term_id: "HP:0001250", span_from_input_id: "g-s4-0", axes: {},
      modifiers: [{ term_id: "HP:0031796", segments: [{ start: rs, end: re }] }, { term_id: "HP:0012828", segments: [{ start: ss, end: se }] }],
    } }, "Seizure (HP:0001250), Present, Patient, Current, modifiers: Recurrent “wiederholt”, Severe “schwere”");
  });

  it("S10: checking every row by hand waits for Keep", () => {
    const value = seizure("g", ["values_differ", "modifiers_differ"], [[ANA, [severe("schwere")]],
      [BEN, [], { axes: { assertion: "uncertain", experiencer: "patient", temporality: "current" } }]], { differing_axes: ["assertion"] });
    const { props } = renderCard(value, mod);
    fireEvent.click(screen.getByRole("button", { name: "Take Uncertain from Ben Roth for Assertion" }));
    fireEvent.click(screen.getByRole("button", { name: "Take No modifiers from Ben Roth for Modifiers" }));
    expect(props.onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice).toMatchObject({ axes: { assertion: "uncertain" }, modifiers: [] });
  });

  it("shows Two severities in words for the chosen modifiers", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe()]], [BEN, [{ ...severe(), term_id: "HP:0012825", term_label: "Mild" }]]]);
    renderCard(value, mod);
    fireEvent.click(screen.getByRole("button", { name: "Take Severe from Ana Weber for Modifiers" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Mild from Ben Roth for Modifiers" }));
    expect(screen.getByRole("rowheader", { name: /Modifiers/ }).textContent).toContain("Two severities");
  });

  describe("Edit values… with modifiers", () => {
    const modWorkspace = () => ({ ...workspaceView(), modifier_layer_ids: ["phenotype"] });
    const chips = () => [...screen.getByRole("list", { name: "Modifiers of Seizure" }).querySelectorAll("li")].map(chip => chip.textContent);
    const searchOntology = () => vi.spyOn(api, "searchOntology").mockResolvedValue({ route: "auto", query: "rec", shuffled: false, search_id: "s1",
      candidates: [{ term_id: "HP:0031796", label: "Recurrent", rank: 1, role: "modifier" }] } as never);
    afterEach(() => vi.restoreAllMocks());

    it("S1 reopened: the Modifiers section edits the set and Keep with these values sends it, incl. a modifier nobody had", async () => {
      const search = searchOntology();
      const reopened = seizure("g-s1", ["match"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere")]]], { state: "open", annotation_ids: [] });
      const { props } = renderCard(reopened, { ...mod, workspace: modWorkspace() });
      editValues();
      const section = document.querySelector("[data-modifiers-section]") as HTMLElement;
      expect(within(section).getByRole("heading", { name: "Modifiers" })).toBeTruthy();
      // No "·" on the consolidation screen (DN-10).
      expect(chips()).toEqual(["Severe “schwere”"]);
      fireEvent.click(screen.getByRole("button", { name: "+ Add modifier…" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Search modifier" }), { target: { value: "rec" } });
      await waitFor(() => expect(within(screen.getByRole("group", { name: "Add modifier to Seizure" })).getAllByRole("option")).toHaveLength(1), { timeout: 3000 });
      expect(search.mock.calls[0][0].within).toEqual(["HP:0012823", "HP:0040279"]);
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Search modifier" }), { key: "Enter" });
      await waitFor(() => expect(chips()).toEqual(["Recurrent", "Severe “schwere”"]));
      fireEvent.click(screen.getByRole("button", { name: "Keep with these values" }));
      expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["g-s1-0", "g-s1-1"], action: "choose", choice: {
        term_id: "HP:0001250", span_from_input_id: "g-s1-0", axes: { assertion: "present", experiencer: "patient", temporality: "current" },
        modifiers: [{ term_id: "HP:0031796", segments: [] }, { term_id: "HP:0012828", segments: [{ start: ss, end: se }] }],
      } }, "Present, Patient, Current, modifiers: Recurrent, Severe “schwere”");
    });

    it("S13 partial: removing the only modifier keeps the finding without modifiers", async () => {
      const partial = seizure("g-s13", ["partial"], [[ANA, [severe("schwere")]]]);
      const { props } = renderCard(partial, { ...mod, workspace: modWorkspace() });
      editValues();
      fireEvent.click(screen.getByRole("button", { name: "Actions, Severe" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove modifier" }));
      expect(screen.queryByRole("list", { name: "Modifiers of Seizure" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Keep with these values" }));
      expect(vi.mocked(props.onResolve).mock.calls[0]).toEqual([expect.objectContaining({ choice: expect.objectContaining({ modifiers: [] }) }),
        "Present, Patient, Current, no modifiers"]);
    });

    it("Remove modifier keeps focus on + Add modifier… and announces it", async () => {
      const partial = seizure("g-s13", ["partial"], [[ANA, [severe("schwere")]]]);
      renderCard(partial, { ...mod, workspace: modWorkspace() });
      editValues();
      fireEvent.click(screen.getByRole("button", { name: "Actions, Severe" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Remove modifier" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ Add modifier…" })));
      expect(screen.getAllByRole("status").map(status => status.textContent)).toContain("Removed Severe.");
    });

    it("an added cohort term shows Cohort term, a second severity warns", async () => {
      vi.spyOn(api, "searchOntology").mockImplementation(async request => ({ route: "auto", query: request.query, shuffled: false, search_id: "s1",
        candidates: request.query === "freq" ? [{ term_id: "HP:0040282", label: "Frequent", rank: 1, role: "cohort" }]
          : [{ term_id: "HP:0012825", label: "Mild", rank: 1, role: "modifier" }] }) as never);
      vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term,
        label: term.term_id, role: term.term_id === "HP:0040282" ? "cohort" : "modifier", exclusive_class: term.term_id === "HP:0012825" ? "severity" : null })) as never);
      const partial = seizure("g-s13", ["partial"], [[ANA, [severe("schwere")]]]);
      renderCard(partial, { ...mod, workspace: modWorkspace() });
      editValues();
      const add = async (query: string) => {
        fireEvent.click(screen.getByRole("button", { name: "+ Add modifier…" }));
        fireEvent.change(screen.getByRole("combobox", { name: "Search modifier" }), { target: { value: query } });
        await waitFor(() => expect(within(screen.getByRole("group", { name: "Add modifier to Seizure" })).getAllByRole("option")).toHaveLength(1), { timeout: 3000 });
        fireEvent.keyDown(screen.getByRole("combobox", { name: "Search modifier" }), { key: "Enter" });
      };
      await add("freq");
      await waitFor(() => expect(chips()).toContain("Frequent Cohort term"));
      expect(screen.queryByText("Two severities")).toBeNull();
      await add("mild");
      await waitFor(() => expect(screen.getByText("Two severities")).toBeTruthy());
    });

    it("a layer without modifiers shows no Modifiers section and sends no modifiers", () => {
      const reopened = seizure("g-s1", ["match"], [[ANA, []], [BEN, []]], { state: "open", annotation_ids: [] });
      const { props } = renderCard(reopened, mod);
      editValues();
      expect(document.querySelector("[data-modifiers-section]")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Keep with these values" }));
      expect(vi.mocked(props.onResolve).mock.calls[0][0].choice).not.toHaveProperty("modifiers");
    });
  });

  describe("standalone modifier card (S18, DN-8 B)", () => {
    const standalone = () => group("g-sev", ["partial", "modifier_as_finding"], [member("sev-a", ANA, "HP:0012828", "Severe", [modSpan("schwere")])]);
    const seizureKept = group("g-seiz", ["partial"], [member("seiz-b", BEN, "HP:0001250", "Seizure", [modSpan("Krampfanfälle")])],
      { state: "keep", annotation_ids: ["cons-seiz"] });

    it("warns, keeps the usual actions (a modifier term may name a finding) and offers Attach", () => {
      const value = standalone();
      const { props } = renderCard(value, { ...mod, groups: [value, seizureKept] });
      expect(screen.getByText(/Ana Weber used the modifier term Severe as a finding\. Keep it only if it names the finding itself; otherwise attach it to a finding\./)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Not in result" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Attach to a finding…" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Seizure (HP:0001250), “Krampfanfälle”" }));
      expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["sev-a"], action: "leave_out", attach_to: "cons-seiz" },
        "Severe “schwere” to Seizure (HP:0001250), “Krampfanfälle”");
      fireEvent.click(screen.getByRole("button", { name: /^Keep/ }));
      expect(props.onResolve).toHaveBeenLastCalledWith(expect.objectContaining({ input_ids: ["sev-a"], action: "keep" }), expect.any(String));
    });

    it("without a resolved finding in the sentence, Attach is not offered", () => {
      const value = standalone();
      const { props } = renderCard(value, { ...mod, groups: [value, { ...seizureKept, state: "open", annotation_ids: [] }] });
      expect(screen.queryByRole("button", { name: "Attach to a finding…" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Not in result" }));
      expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["sev-a"], action: "leave_out" }, "not in result");
    });
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsolidationGroupView } from "../../src/api/client";
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

describe("GroupCard", () => {
  it("the card shows the conflict marker, the name and the count of fields to decide", () => {
    renderCard(hypotoniaThree(), { people: THREE });
    const toggle = screen.getByRole("button", { expanded: true });
    expect(toggle.textContent).toContain("muscular hypotonia");
    expect(toggle.textContent).toContain("2 fields to decide");
    expect(within(toggle).getByText("Conflict")).toBeTruthy();
  });

  it("a conflicting row has a check per person and takes the value", () => {
    const { props } = renderCard(hypotoniaThree(), { people: THREE });
    const take = screen.getByRole("button", { name: "Take Absent from Mia Berg for Assertion" });
    fireEvent.click(take);
    expect(take.getAttribute("aria-pressed")).toBe("true");
    expect(result()).toContain("Absent");
    expect(result()).toContain("Not taken: Axial hypotonia (Ali)");
    // The term is still open: nothing is saved yet.
    expect(props.onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take Hypotonia from Tom Reis for Term" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-tom", "in-mia", "in-ali"], action: "choose",
      choice: { term_id: "HP:0001252", span_from_input_id: "in-tom", axes: { assertion: "absent" } },
    }, "Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("agreed rows are one grey line", () => {
    renderCard(hypotoniaThree(), { people: THREE });
    expect(screen.getAllByText("Patient (all agree)")).toHaveLength(1);
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
    expect(props.onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take Current from Luc Martin for Temporality" }));
    expect(props.onResolve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice?.axes).toEqual({ assertion: "absent", temporality: "current" });
  });

  it("takes one person's whole finding", () => {
    const { props } = renderCard(hypotoniaThree(), { people: THREE });
    fireEvent.click(screen.getByRole("button", { name: "Take Ali's finding" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-tom", "in-mia", "in-ali"], action: "choose",
      choice: { term_id: "HP:0008936", span_from_input_id: "in-ali", axes: { assertion: "present" } },
    }, "Axial hypotonia (HP:0008936), Present, Patient, Current");
  });

  it("asks to keep or leave out a finding only one person marked", () => {
    const { props } = renderCard(byId("g-micro"));
    expect(screen.getByText("Luc Martin marked this. Tom Reis has nothing here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep Luc Martin's finding" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["in-ml"], action: "keep" }, "Microcephaly (HP:0000252), Present, Patient, Current");
    fireEvent.click(screen.getByRole("button", { name: "Leave out" }));
    expect(props.onResolve).toHaveBeenLastCalledWith({ input_ids: ["in-ml"], action: "leave_out" }, "left out");
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

  it("offers Keep, Leave out, Edit values… and Other term… on a reopened match", () => {
    const reopened = { ...byId("g-seiz"), state: "open" as const, annotation_ids: [] };
    const { props } = renderCard(reopened, { workspace: workspaceView() });
    for (const name of ["Keep", "Leave out", "Edit values…", "Other term…"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit values…" }));
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
    expect(props.onResolve).toHaveBeenCalledWith(expect.objectContaining({ note: "Negated in the text.", guidelines_unclear: true, action: "choose" }),
      "Hypotonia (HP:0001252), Absent, Patient, Current");
  });

  it("shows overlapping text and differing notes as information: Keep takes the default member", () => {
    const value = { ...byId("g-dd"), kinds: ["span_differs", "notes_differ"],
      members: byId("g-dd").members.map((item, index) => ({ ...item, note: index ? "Late." : "Early." })) };
    const { props } = renderCard(value);
    expect(screen.getByText("“Delayed development” (overlapping, comes with the chosen finding)")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Note" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Take .* for / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["in-dl", "in-dt"], action: "keep" },
      "Global developmental delay (HP:0001263), Present, Patient, Current");
  });

  it("asks the text when the spans conflict", () => {
    const { props } = renderCard({ ...byId("g-dd"), span_conflict: true });
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take “development” from Tom Reis for Text" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-dl", "in-dt"], action: "choose", choice: { term_id: "HP:0001263", span_from_input_id: "in-dt", axes: {} },
    }, "Global developmental delay (HP:0001263), Present, Patient, Current");
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
    fireEvent.click(screen.getByRole("button", { name: "Change, muscular hypotonia" }));
    expect(props.onReopen).not.toHaveBeenCalled();
    expect(screen.getByText("Reopening drops your edit from the editor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(props.onReopen).toHaveBeenCalled();
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
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it("takes a person who left a differing axis empty: shown as Not specified, sent as null", () => {
    const value = hypotoniaThree({ differing_axes: ["assertion", "temporality"] }, { ali: { axes: { assertion: "present", experiencer: "patient" } } });
    const { props } = renderCard(value, { people: THREE });
    expect(within(screen.getByRole("row", { name: /Temporality/ })).getByText("Not specified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take Ali's finding" }));
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice?.axes).toEqual({ assertion: "present", temporality: null });
  });

  it("a resolved table has no conflict mark or tint", () => {
    const { container } = renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"] });
    expect(container.querySelector(".cons-row--conflict, .cons-conflict-mark")).toBeNull();
  });

  it("offers no actions when read-only", () => {
    renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"], guidelines_unclear: true }, { readOnly: true });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    expect(screen.queryByLabelText("Guidelines unclear here")).toBeNull();
    expect(screen.getByText("Flagged: guidelines unclear")).toBeTruthy();
  });
});

describe("GroupCard, modifiers", () => {
  const mod = { people: MOD_PEOPLE, text: MOD_TEXT, workspace: workspaceView(), onEditInEditor: vi.fn() };
  const [ss, se] = modSpan("schwere"), [rs, re] = modSpan("wiederholt");
  const s4 = () => seizure("g-s4", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [recurrent("wiederholt")]]]);

  it("S4: checks send nothing; Keep appears after the first check and sends both modifiers (DN-11)", () => {
    const { props } = renderCard(s4(), mod);
    expect(screen.getByRole("button", { expanded: true }).textContent).toContain("1 field to decide");
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take Ana's finding/ })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "Whole finding" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take Recurrent “wiederholt” from Ben Roth for Modifiers" }));
    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take Severe “schwere” from Ana Weber for Modifiers" }));
    expect(props.onResolve).not.toHaveBeenCalled();
    expect(result()).toContain("modifiers: Recurrent “wiederholt”, Severe “schwere”");
    expect(screen.getByRole("button", { name: "Leave out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit in editor…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit values…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["g-s4-0", "g-s4-1"], action: "choose", choice: {
      term_id: "HP:0001250", span_from_input_id: "g-s4-0", axes: {},
      modifiers: [{ term_id: "HP:0031796", segments: [{ start: rs, end: re }] }, { term_id: "HP:0012828", segments: [{ start: ss, end: se }] }],
    } }, "Seizure (HP:0001250), Present, Patient, Current, modifiers: Recurrent “wiederholt”, Severe “schwere”");
  });

  it("S10: Take Ana's finding resolves at once with her values and modifiers", () => {
    const value = seizure("g", ["values_differ", "modifiers_differ"], [[ANA, [severe("schwere")]],
      [BEN, [], { axes: { assertion: "uncertain", experiencer: "patient", temporality: "current" } }]], { differing_axes: ["assertion"] });
    const { props } = renderCard(value, mod);
    fireEvent.click(screen.getByRole("button", { name: "Take Ana's finding" }));
    expect(props.onResolve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice).toEqual({ term_id: "HP:0001250", span_from_input_id: "g-0", axes: { assertion: "present" },
      modifiers: [{ term_id: "HP:0012828", segments: [{ start: ss, end: se }] }] });
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

  describe("standalone modifier card (S18, DN-8 B)", () => {
    const standalone = () => group("g-sev", ["partial", "modifier_as_finding"], [member("sev-a", ANA, "HP:0012828", "Severe", [modSpan("schwere")])]);
    const seizureKept = group("g-seiz", ["partial"], [member("seiz-b", BEN, "HP:0001250", "Seizure", [modSpan("Krampfanfälle")])],
      { state: "keep", annotation_ids: ["cons-seiz"] });

    it("explains the card and resolves only with Attach or Leave out", () => {
      const value = standalone();
      const { props } = renderCard(value, { ...mod, groups: [value, seizureKept] });
      expect(screen.getByText(/Ana Weber marked a modifier as a finding\. Severe can only describe another finding\./)).toBeTruthy();
      expect(result()).toBe("Result: no finding of its own. Severe “schwere” goes to the finding you attach it to, or is left out.");
      for (const name of ["Keep", "Keep Ana Weber's finding", "Edit values…", "Other term…"]) expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.getByRole("button", { name: "Leave out" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Edit in editor…" }));
      expect(mod.onEditInEditor).toHaveBeenCalled();
      expect(props.onResolve).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Attach to a finding…" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Seizure (HP:0001250), “Krampfanfälle”" }));
      expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["sev-a"], action: "leave_out", attach_to: "cons-seiz" },
        "Severe “schwere” to Seizure (HP:0001250), “Krampfanfälle”");
    });

    it("without a resolved finding in the sentence, Attach is unavailable with the reason", () => {
      const value = standalone();
      const { props } = renderCard(value, { ...mod, groups: [value, { ...seizureKept, state: "open", annotation_ids: [] }] });
      const attach = screen.getByRole("button", { name: "Attach to a finding…" });
      expect(attach.getAttribute("aria-disabled")).toBe("true");
      expect(document.getElementById(attach.getAttribute("aria-describedby")!)?.textContent).toBe("No resolved finding in this sentence yet.");
      fireEvent.click(attach);
      expect(props.onResolve).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Leave out" }));
      expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["sev-a"], action: "leave_out" }, "left out");
    });
  });
});

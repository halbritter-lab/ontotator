import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsolidationGroupView } from "../../src/api/client";
import { GroupCard, type GroupCardProps } from "../../src/consolidation/GroupCard";
import { ANA, exampleGroups, group, LUC, member, span, TEXT, TOM, workspaceView } from "./fixtures";

afterEach(cleanup);

const byId = (id: string) => exampleGroups().find(value => value.group_id === id)!;

function renderCard(value: ConsolidationGroupView, extra: Partial<GroupCardProps> = {}) {
  const props: GroupCardProps = {
    group: value, people: [LUC, TOM], text: TEXT, expanded: true, readOnly: false, busy: false,
    onExpand: vi.fn(), onResolve: vi.fn(async () => true), onAnnotate: vi.fn(async () => true), onReopen: vi.fn(async () => true),
    onDismissOutcome: vi.fn(), ...extra,
  };
  render(<ul><GroupCard {...props} /></ul>);
  return props;
}

describe("GroupCard", () => {
  it("names the person on every value chip and resolves a one-row group with one click", () => {
    const props = renderCard(byId("g-hypo"));
    expect(screen.getByRole("button", { name: "present · Luc Martin" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "absent · Tom Reis" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-hl", "in-ht"], action: "choose",
      choice: { term_id: "HP:0001252", span_from_input_id: "in-hl", axes: { assertion: "absent" } },
    }, "absent (Tom Reis)");
  });

  it("resolves a value group with two axes only after both choices", () => {
    const value = group("g-two", ["values_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent", experiencer: "patient", temporality: "historical" } }),
    ], { differing_axes: ["assertion", "temporality"] });
    const props = renderCard(value);
    fireEvent.click(screen.getByRole("button", { name: "absent · Tom Reis" }));
    expect(props.onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "absent · Tom Reis" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "current · Luc Martin" }));
    expect(props.onResolve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onResolve).mock.calls[0][0].choice?.axes).toEqual({ assertion: "absent", temporality: "current" });
  });

  it("marks differences by weight and the word, never by colour alone", () => {
    renderCard(byId("g-hypo"));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Assertion · differs" })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: "Luc Martin (ann-0004)" })).toBeTruthy();
    expect(within(table).getAllByRole("cell", { name: "Hypotonia (HP:0001252)" })).toHaveLength(2);
  });

  it("asks to keep or leave out a finding only one person marked", () => {
    const props = renderCard(byId("g-micro"));
    expect(screen.getByText("Luc Martin marked this · Tom Reis has nothing here")).toBeTruthy();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep Luc Martin's finding" }));
    expect(props.onResolve).toHaveBeenCalledWith({ input_ids: ["in-ml"], action: "keep" }, "kept from Luc Martin");
    fireEvent.click(screen.getByRole("button", { name: "Leave out" }));
    expect(props.onResolve).toHaveBeenLastCalledWith({ input_ids: ["in-ml"], action: "leave_out" }, "left out");
  });

  it("shows a majority as 2 of 3 without preselecting it", () => {
    const value = group("g-maj", ["values_differ"], [
      member("i1", LUC, "HP:0001252", "Hypotonia", [span("muscular hypotonia")]),
      member("i2", TOM, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent" } }),
      member("i3", ANA, "HP:0001252", "Hypotonia", [span("muscular hypotonia")], { axes: { assertion: "absent" } }),
    ], { majority: { assertion: "absent" } });
    renderCard(value, { people: [LUC, TOM, ANA] });
    expect(screen.getByRole("button", { name: "absent · Tom Reis, Ana Weber (2 of 3)" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("offers one term, keep both or another term when terms differ", () => {
    const props = renderCard(byId("g-gait"), { workspace: workspaceView() });
    expect(screen.getByRole("button", { name: "Keep both" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Other term…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ataxia (HP:0001251) · Luc Martin" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["in-gl", "in-gt"], action: "choose", choice: { term_id: "HP:0001251", span_from_input_id: "in-gl", axes: {} },
    }, "Ataxia (HP:0001251) (Luc Martin)");
  });

  it("offers Keep, Leave out, Edit values… and Other term… on a reopened match", () => {
    const reopened = { ...byId("g-seiz"), state: "open" as const, annotation_ids: [] };
    const props = renderCard(reopened, { workspace: workspaceView() });
    for (const name of ["Keep", "Leave out", "Edit values…", "Other term…"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit values…" }));
    fireEvent.change(screen.getByLabelText("Assertion"), { target: { value: "absent" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep with these values" }));
    expect(props.onResolve).toHaveBeenCalledWith({
      input_ids: ["g-seiz-l", "g-seiz-t"], action: "choose",
      choice: { term_id: "HP:0001250", span_from_input_id: "g-seiz-l", axes: { assertion: "absent", experiencer: "patient", temporality: "current" } },
    }, "absent · patient · current");
  });

  it("sends the note and the flag with the decision of an open group", () => {
    const props = renderCard(byId("g-dd"));
    fireEvent.click(screen.getByRole("button", { name: "+ note" }));
    fireEvent.change(screen.getByLabelText("Note for the lead"), { target: { value: "Shorter span is enough." } });
    fireEvent.click(screen.getByLabelText("Guidelines unclear here"));
    expect(props.onAnnotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "“development” · Tom Reis" }));
    expect(props.onResolve).toHaveBeenCalledWith(expect.objectContaining({ note: "Shorter span is enough.", guidelines_unclear: true, action: "choose" }), "“development” (Tom Reis)");
  });

  it("places note and flag of an open group above its choices, so they are set before the last chip", () => {
    renderCard(byId("g-dd"));
    const note = screen.getByRole("button", { name: "+ note" });
    const flag = screen.getByLabelText("Guidelines unclear here");
    const chip = screen.getByRole("button", { name: "“development” · Tom Reis" });
    expect(note.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flag.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no text node inside a table row", () => {
    renderCard(byId("g-hypo"));
    for (const row of screen.getByRole("table").querySelectorAll("tr")) {
      expect([...row.childNodes].every(node => node.nodeType === Node.ELEMENT_NODE)).toBe(true);
    }
  });

  it("flags an automatically kept group through annotate", () => {
    const props = renderCard(byId("g-seiz"));
    expect(screen.getByText("✓ kept automatically")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Guidelines unclear here"));
    expect(props.onAnnotate).toHaveBeenCalledWith({ input_ids: ["g-seiz-l", "g-seiz-t"], guidelines_unclear: true });
  });

  it("keeps a failed decision open with Retry", () => {
    const onRetry = vi.fn();
    renderCard(byId("g-hypo"), { outcome: { kind: "error", onRetry } });
    expect(screen.getByRole("alert").textContent).toContain("Could not save. Nothing changed.");
    expect(screen.getByRole("button", { name: "absent · Tom Reis" })).toBeTruthy();
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
    const props = renderCard(edited, { expanded: false, summary: "absent (Tom Reis)" });
    expect(screen.getByRole("button", { name: /Hypotonia ✓ absent \(Tom Reis\) · edited in editor/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change, Hypotonia" }));
    expect(props.onReopen).not.toHaveBeenCalled();
    expect(screen.getByText("Reopening drops your edit from the editor.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(props.onReopen).toHaveBeenCalled();
  });

  it("shows a text snippet of the passage below 700 px", () => {
    renderCard(byId("g-hypo"), { narrow: true, expanded: false });
    expect(screen.getByText("muscular hypotonia", { selector: "mark" })).toBeTruthy();
  });

  it("offers no actions when read-only", () => {
    renderCard({ ...byId("g-hypo"), state: "choose", annotation_ids: ["cons-1"], guidelines_unclear: true }, { readOnly: true });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByLabelText("Guidelines unclear here")).toBeNull();
    expect(screen.getByText("Flagged: guidelines unclear")).toBeTruthy();
  });
});

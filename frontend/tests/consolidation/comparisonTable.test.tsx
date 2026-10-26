import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConsolidationGroupView } from "../../src/api/client";
import type { ConsolidationPersonView } from "../../src/api/client";
import { choose, comparisonRows, resultLine, takeFinding, type Choices } from "../../src/consolidation/groupModel";
import { ComparisonTable } from "../../src/consolidation/ComparisonTable";
import { ResultLine } from "../../src/consolidation/ResultLine";
import { ANA, BEN, CHRIS, frequent, group, hypotoniaThree, LUC, member, MOD_TEXT, recurrent, seizure, severe, span, TEXT, THREE } from "./fixtures";

afterEach(cleanup);

function Harness({ group, people = THREE, text = TEXT, readOnly = false }: { group: ConsolidationGroupView; people?: ConsolidationPersonView[]; text?: string; readOnly?: boolean }) {
  const [choices, setChoices] = useState<Choices>({});
  return <>
    <ComparisonTable name="muscular hypotonia" group={group} people={people} rows={comparisonRows(group, people, text, choices)} readOnly={readOnly}
      onChoose={(row, value) => setChoices(current => choose(group, current, row, value))}
      onTake={member => setChoices(takeFinding(group, member))} />
    <ResultLine line={resultLine(group, people, text, choices)} />
  </>;
}

const result = () => document.querySelector(".cons-result")!.textContent;

describe("ComparisonTable", () => {
  it("a conflicting row has a check per person and takes the value", () => {
    render(<Harness group={hypotoniaThree()} />);
    expect(screen.getByRole("table", { name: "Comparison of muscular hypotonia" })).toBeTruthy();
    const take = screen.getByRole("button", { name: "Take Absent from Mia Berg for Assertion" });
    expect(take.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(take);
    expect(take.getAttribute("aria-pressed")).toBe("true");
    expect(result()).toContain("Absent, Patient, Current");
    expect(screen.getByRole("rowheader", { name: /Assertion/ }).textContent).toContain("Conflict");
  });

  it("agreed rows are one grey line", () => {
    render(<Harness group={hypotoniaThree()} />);
    const cells = screen.getAllByText("Patient (all agree)");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("colspan")).toBe("3");
    expect(screen.getByText("“muscular hypotonia” (overlapping, comes with the chosen finding)")).toBeTruthy();
  });

  it("rows to decide come first; two or more agreed rows fold into one Agreed line that opens on demand", () => {
    render(<Harness group={hypotoniaThree()} />);
    const headers = screen.getAllByRole("rowheader").map(header => header.textContent);
    expect(headers.slice(0, 2).every(header => header?.startsWith("Conflict"))).toBe(true);
    expect(screen.getByRole("rowheader", { name: "Agreed" })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Agreed/ }).textContent).toContain("Experiencer, Temporality");
    expect(screen.queryByRole("rowheader", { name: "Experiencer" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show values" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide values" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("rowheader", { name: "Experiencer" })).toBeTruthy();
    expect(headers.at(-1)).toBe("Whole finding");
  });

  it("a one-person group shows its values without '(all agree)' and without folding", () => {
    const lone = group("g-micro", ["partial"], [member("in-ml", LUC, "HP:0000252", "Microcephaly", [span("seizures")])]);
    const { container } = render(<Harness group={lone} people={[LUC]} />);
    expect(container.textContent).not.toContain("all agree");
    expect(screen.queryByRole("button", { name: "Show values" })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Term" })).toBeTruthy();
  });

  it("axis values use the fixed colour slots", () => {
    render(<Harness group={hypotoniaThree()} />);
    const present = within(screen.getByRole("row", { name: /Assertion/ })).getAllByText("Present");
    expect(present[0].classList.contains("axis-value--present")).toBe(true);
  });

  it("no pill buttons, no separators and no differs text", () => {
    const { container } = render(<Harness group={hypotoniaThree()} />);
    expect(screen.queryByText(/differs/)).toBeNull();
    expect(container.querySelector(".cons-chip")).toBeNull();
    expect(container.textContent).not.toContain("·");
    expect(container.textContent).not.toMatch(/both/i);
  });

  it("taking a whole finding presses every value of that person and updates the result", () => {
    render(<Harness group={hypotoniaThree()} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Ali's finding" }));
    expect(screen.getByRole("button", { name: "Take Ali's finding" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Take Axial hypotonia from Ali Kaya for Term" }).getAttribute("aria-pressed")).toBe("true");
    expect(result()).toContain("Axial hypotonia (HP:0008936), Present, Patient, Current");
    expect(result()).toContain("Not taken: Hypotonia (Tom, Mia)");
  });

  it("findings from a tool proposal carry the robot icon", () => {
    render(<Harness group={hypotoniaThree({}, { mia: { from_tool_proposal: true } })} />);
    const headers = screen.getAllByRole("columnheader");
    const mia = headers.find(header => header.textContent?.includes("Mia Berg"))!;
    const tom = headers.find(header => header.textContent?.includes("Tom Reis"))!;
    expect(within(mia).getByRole("img", { name: "From a tool proposal" }).getAttribute("title")).toBe("From a tool proposal");
    expect(within(tom).queryByRole("img", { name: "From a tool proposal" })).toBeNull();
  });
});

describe("ComparisonTable, Modifiers row", () => {
  const PEOPLE = [{ ...ANA, lane: 1 }, BEN, CHRIS];
  const s16 = () => seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [recurrent("wiederholt"), frequent()]], [CHRIS, [severe("schwere")]]]);
  const pressedOf = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

  it("one toggle per modifier per cell, named in words; identical modifiers press together", () => {
    render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} />);
    const ana = "Take Severe “schwere” from Ana Weber for Modifiers (2 of 3)";
    const chris = "Take Severe “schwere” from Chris Lee for Modifiers (2 of 3)";
    expect(within(screen.getByRole("list", { name: "Modifiers of Ben Roth" })).getAllByRole("button")).toHaveLength(2);
    expect(pressedOf(ana)).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: ana }));
    expect(pressedOf(ana)).toBe("true");
    expect(pressedOf(chris)).toBe("true");
    expect(result()).toContain("modifiers: Severe “schwere”");
    expect(screen.getByRole("rowheader", { name: /Modifiers/ }).textContent).toContain("Conflict");
  });

  it("majority and cohort term in words; no union, no Text of row, no separator", () => {
    const { container } = render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} />);
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).getByText("Severe “schwere” (2 of 3)")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Modifiers of Ben Roth" })).getByText("Cohort term")).toBeTruthy();
    expect(container.textContent).not.toMatch(/·|Text of|All:|union/);
  });

  it("a released variant reads other text chosen; No modifiers is a toggle too", () => {
    const value = seizure("g", ["modifiers_differ"], [[ANA, [severe("schwere")]], [BEN, [severe()]], [CHRIS, []]]);
    render(<Harness group={value} people={PEOPLE} text={MOD_TEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Severe (no text) from Ben Roth for Modifiers" }));
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).getByText("other text chosen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take No modifiers from Chris Lee for Modifiers" }));
    expect(pressedOf("Take Severe (no text) from Ben Roth for Modifiers")).toBe("false");
    expect(result()).toContain("no modifiers");
  });

  it("read-only shows the modifiers without toggles", () => {
    render(<Harness group={s16()} people={PEOPLE} text={MOD_TEXT} readOnly />);
    expect(within(screen.getByRole("list", { name: "Modifiers of Ana Weber" })).queryByRole("button")).toBeNull();
    expect(screen.getAllByText("Severe “schwere” (2 of 3)")).toHaveLength(2);
  });

  it("agreed modifiers are one grey line", () => {
    render(<Harness group={seizure("g", ["match"], [[ANA, [severe("schwere")]], [BEN, [severe("schwere")]]])} people={PEOPLE} text={MOD_TEXT} />);
    expect(screen.getByText("Severe “schwere” (all agree)").getAttribute("colspan")).toBe("2");
  });
});

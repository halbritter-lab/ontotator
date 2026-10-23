import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConsolidationGroupView } from "../../src/api/client";
import { comparisonRows, resultLine, takeFinding, type Choices } from "../../src/consolidation/groupModel";
import { ComparisonTable } from "../../src/consolidation/ComparisonTable";
import { ResultLine } from "../../src/consolidation/ResultLine";
import { hypotoniaThree, TEXT, THREE } from "./fixtures";

afterEach(cleanup);

function Harness({ group }: { group: ConsolidationGroupView }) {
  const [choices, setChoices] = useState<Choices>({});
  return <>
    <ComparisonTable name="muscular hypotonia" group={group} people={THREE} rows={comparisonRows(group, THREE, TEXT, choices)}
      onChoose={(row, value) => setChoices(current => ({ ...current, [row]: value }))}
      onTake={member => setChoices(takeFinding(group, member))} />
    <ResultLine line={resultLine(group, THREE, choices)} />
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

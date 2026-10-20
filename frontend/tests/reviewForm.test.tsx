import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewForm } from "../src/translation/ReviewForm";
import type { ReviewForm as ReviewFormValue } from "../src/translation/reviewRules";
import { clinicalChangeFacts, clinicalChangeHints, decisionDescriptions, issueMessages } from "../src/translation/labels";

afterEach(cleanup);

describe("ReviewForm", () => {
  it("leaves a missing decision unselected and makes no initial change", () => {
    const onChange = vi.fn();
    render(<ReviewForm value={{}} issues={[]} onChange={onChange} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    expect(radios.map((radio) => radio.getAttribute("aria-describedby") && document.getElementById(radio.getAttribute("aria-describedby")!)?.textContent))
      .toEqual(Object.values(decisionDescriptions));
    // Follow-up fields only appear once a decision makes them relevant.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("group", { name: "Clinical change categories" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Rationale" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chooses through chooseDecision: query implies a clinical change, accepted unchanged clears it", () => {
    const onChange = vi.fn();
    const view = render(<ReviewForm value={{ rationale: "r" }} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Query" }));
    expect(onChange).toHaveBeenLastCalledWith({ rationale: "r", decision: "query", clinical_change: true });
    const value = Object.freeze({ decision: "rejected" as const, clinical_change: true, categories: Object.freeze(["source" as const]), rationale: "Needs clarification" });
    view.rerender(<ReviewForm value={value} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Accepted unchanged" }));
    expect(onChange).toHaveBeenLastCalledWith({ decision: "accepted_unchanged", clinical_change: false, categories: [], rationale: "Needs clarification" });
    expect(value.decision).toBe("rejected");
    expect(value.categories).toEqual(["source"]);
  });

  it("reports a radio choice through onChooseDecision when given", () => {
    const onChange = vi.fn(), onChooseDecision = vi.fn();
    render(<ReviewForm value={{}} issues={[]} onChange={onChange} onChooseDecision={onChooseDecision} />);
    fireEvent.click(screen.getByRole("radio", { name: "Rejected" }));
    expect(onChooseDecision).toHaveBeenCalledWith("rejected");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hints the rationale for Accepted unchanged with failed checks", () => {
    const view = render(<ReviewForm value={{ decision: "accepted_unchanged", clinical_change: false }} failedCheckCount={1} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Optional. Say why the flagged difference is correct.")).toBeDefined();
    view.rerender(<ReviewForm value={{ decision: "accepted_unchanged", clinical_change: false }} failedCheckCount={0} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Optional.")).toBeDefined();
    view.rerender(<ReviewForm value={{ decision: "query", clinical_change: true }} failedCheckCount={1} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Required for a clinically relevant change.")).toBeDefined();
  });

  it("shows the short decision hints and a number key per option outside the accessible name", () => {
    const view = render(<ReviewForm value={{}} issues={[]} onChange={vi.fn()} />);
    expect([...view.container.querySelectorAll(".review-decision-hint")].map((hint) => hint.textContent)).toEqual([
      "Correct as it stands. No edits.", "Your corrected version is accepted.",
      "Meaning may differ clinically. Not accepted.", "Changes clinical meaning. Not accepted.",
    ]);
    expect([...view.container.querySelectorAll(".review-decision")].map((option) => option.querySelector("kbd")?.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(screen.getByRole("radio", { name: "Query" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Accepted unchanged" })).toBeDefined();
  });

  it("renders the auto note as a polite status under Accepted with corrections", () => {
    const note = "Selected because you edited the translation. You can choose another decision.";
    const view = render(<ReviewForm value={{ decision: "accepted_corrected", clinical_change: false }} autoNote={note} issues={[]} onChange={vi.fn()} />);
    const status = screen.getByText(note);
    expect(status.getAttribute("role")).toBe("status");
    const option = screen.getByRole("radio", { name: "Accepted with corrections" }).closest(".review-decision")!;
    expect(option.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const next = screen.getByRole("radio", { name: "Query" }).closest(".review-decision")!;
    expect(status.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<ReviewForm value={{ decision: "accepted_corrected", clinical_change: false }} autoNote={null} issues={[]} onChange={vi.fn()} />);
    expect(screen.queryByText(note)).toBeNull();
  });

  it("marks the Decision legend as a focus target", () => {
    const view = render(<ReviewForm value={{}} issues={[]} onChange={vi.fn()} />);
    const legend = view.container.querySelector("[data-decision-legend]");
    expect(legend?.textContent).toBe("Decision");
    expect(legend?.getAttribute("tabindex")).toBe("-1");
  });

  it("enables categories only with clinical change and clears them on explicit switch off", async () => {
    const changes = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<Partial<ReviewFormValue>>({ decision: "accepted_corrected", clinical_change: false, rationale: "Keep this" });
      return <ReviewForm value={value} issues={[]} onChange={(next) => { changes(next); setValue(next); }} />;
    }
    render(<Controlled />);
    const user = userEvent.setup();
    expect(screen.queryByRole("checkbox", { name: "Omission" })).toBeNull();
    expect(screen.getByText("Optional.")).toBeDefined();
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    expect(screen.getByText("Required for a clinically relevant change.")).toBeDefined();
    await user.click(screen.getByRole("checkbox", { name: "Omission" }));
    expect((screen.getByRole("checkbox", { name: "Omission" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    expect(changes).toHaveBeenLastCalledWith({ decision: "accepted_corrected", clinical_change: false, categories: [], rationale: "Keep this" });
    expect(screen.queryByRole("checkbox", { name: "Omission" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    expect(changes).toHaveBeenLastCalledWith({ decision: "accepted_corrected", clinical_change: true, categories: [], rationale: "Keep this" });
    expect((screen.getByRole("checkbox", { name: "Omission" }) as HTMLInputElement).checked).toBe(false);
  });

  it.each([
    [{}, false, null, false, false],
    [{ decision: "accepted_unchanged" as const }, false, null, false, true],
    [{ decision: "accepted_corrected" as const }, true, null, false, true],
    [{ decision: "query" as const }, false, "Clinically relevant change: yes, always for a query.", true, true],
    [{ decision: "rejected" as const }, false, "Clinically relevant change: yes, always for a rejection.", true, true],
    // Stored values a rule still judges stay visible, so a blocking value can always be cleared.
    [{ decision: "accepted_unchanged" as const, clinical_change: true }, true, null, true, true],
    [{ decision: "accepted_unchanged" as const, categories: ["value" as const] }, false, null, true, true],
  ])("shows follow-up fields by the A.4 table for %j", (value, clinical, fact, categories, rationale) => {
    const view = render(<ReviewForm value={value} issues={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "Clinically relevant change" }) !== null).toBe(clinical);
    expect(view.container.querySelector(".review-fact")?.textContent ?? null).toBe(fact);
    expect(screen.queryByRole("group", { name: "Clinical change categories" }) !== null).toBe(categories);
    expect(screen.queryByRole("textbox", { name: "Rationale" }) !== null).toBe(rationale);
  });

  it("enables categories at once for query and rejected without a checkbox", () => {
    const onChange = vi.fn();
    render(<ReviewForm value={{ decision: "query" }} issues={[]} onChange={onChange} />);
    expect(screen.queryByRole("checkbox", { name: "Clinically relevant change" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Number or unit" }));
    expect(onChange).toHaveBeenLastCalledWith({ decision: "query", categories: ["value"] });
    expect(screen.getByText("Required for a clinically relevant change.")).toBeDefined();
  });

  it("names the rule for a clinical change under each decision", () => {
    const view = render(<ReviewForm value={{ decision: "query" }} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByText(clinicalChangeFacts.query)).toBeDefined();
    view.rerender(<ReviewForm value={{ decision: "rejected" }} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByText(clinicalChangeFacts.rejected)).toBeDefined();
    view.rerender(<ReviewForm value={{ decision: "accepted_corrected" }} issues={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Clinically relevant change" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(clinicalChangeHints.accepted_corrected)).toBeDefined();
  });

  it("changes only the selected category and preserves other fields", () => {
    const value = { decision: "query" as const, clinical_change: true, categories: ["source" as const, "value" as const], rationale: "Why" };
    const onChange = vi.fn();
    const view = render(<ReviewForm value={value} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Number or unit" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, categories: ["source"] });
    view.rerender(<ReviewForm value={{ ...value, categories: ["source"] }} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Omission" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, categories: ["source", "omission"] });
    expect(value.categories).toEqual(["source", "value"]);
  });

  it("retains exact rationale input and other fields", () => {
    const value = { decision: "rejected" as const, clinical_change: true, categories: ["anatomy" as const], rationale: null };
    const onChange = vi.fn();
    render(<ReviewForm value={value} issues={[]} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Rationale" }), { target: { value: "  exact rationale\n" } });
    expect(onChange).toHaveBeenCalledWith({ ...value, rationale: "  exact rationale\n" });
  });

  it("lists supplied issues in their supplied order without inferring new issues", () => {
    const issues = Object.freeze(["RATIONALE_REQUIRED", "TEXT_EMPTY"] as const);
    render(<ReviewForm value={{}} issues={issues} onChange={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Review issues" });
    expect(list.getAttribute("aria-live")).toBeNull();
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([issueMessages.RATIONALE_REQUIRED, issueMessages.TEXT_EMPTY]);
    expect(issues).toEqual(["RATIONALE_REQUIRED", "TEXT_EMPTY"]);
  });

  it("disables every control and refuses even synthetic changes when read only", async () => {
    const onChange = vi.fn();
    render(<ReviewForm value={{ decision: "query", clinical_change: true, categories: ["source"], rationale: "Original" }} issues={[]} readOnly onChange={onChange} />);
    const controls = [...screen.getAllByRole("radio"), ...screen.getAllByRole("checkbox"), screen.getByRole("textbox")];
    expect(controls.every((control) => control.matches(":disabled"))).toBe(true);
    for (const control of controls) fireEvent.click(control);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Attempt" } });
    await userEvent.setup().tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps labels and radio groups independent across instances with keyboard operation", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<><ReviewForm value={{}} issues={[]} onChange={first} /><ReviewForm value={{}} issues={[]} onChange={second} /></>);
    const inputs = [...view.container.querySelectorAll("input, textarea")];
    expect(new Set(inputs.map((input) => input.id)).size).toBe(inputs.length);
    const radios = screen.getAllByRole("radio", { name: "Query" }) as HTMLInputElement[];
    expect(radios[0].name).not.toBe(radios[1].name);
    await userEvent.setup().click(radios[1].labels![0]);
    expect(second).toHaveBeenCalledWith({ decision: "query", clinical_change: true });
    expect(first).not.toHaveBeenCalled();
    radios[0].focus();
    await userEvent.setup().keyboard(" ");
    expect(first).toHaveBeenCalledWith({ decision: "query", clinical_change: true });
  });
  it("issue list is not a live region", () => {
    render(<ReviewForm value={{ decision: "query", clinical_change: true }} issues={["CATEGORY_REQUIRED", "RATIONALE_REQUIRED"]} onChange={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Review issues" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list.getAttribute("aria-live")).toBeNull();
    expect(list.closest("[aria-live]")).toBeNull();
  });
});

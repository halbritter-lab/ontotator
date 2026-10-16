import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewForm } from "../src/translation/ReviewForm";
import type { ReviewForm as ReviewFormValue } from "../src/translation/reviewRules";
import { issueMessages } from "../src/translation/labels";

afterEach(cleanup);

describe("ReviewForm", () => {
  it("leaves a missing decision unselected and makes no initial change", () => {
    const onChange = vi.fn();
    render(<ReviewForm value={{}} issues={[]} onChange={onChange} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    const categories = within(screen.getByRole("group", { name: "Clinical change categories" }));
    expect(categories.getAllByRole("checkbox")).toHaveLength(7);
    expect((screen.getByRole("textbox", { name: "Rationale" }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves clinical intent, rationale and the original value when changing decision", () => {
    const value = Object.freeze({ decision: "query" as const, clinical_change: true, categories: Object.freeze(["source" as const]), rationale: "Needs clarification" });
    const onChange = vi.fn();
    render(<ReviewForm value={value} issues={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Accepted unchanged" }));
    expect(onChange).toHaveBeenCalledWith({ ...value, decision: "accepted_unchanged" });
    expect(value.decision).toBe("query");
    expect(value.categories).toEqual(["source"]);
  });

  it("enables categories only with clinical change and clears them on explicit switch off", async () => {
    const changes = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<Partial<ReviewFormValue>>({ decision: "accepted_corrected", clinical_change: false, rationale: "Keep this" });
      return <ReviewForm value={value} issues={[]} onChange={(next) => { changes(next); setValue(next); }} />;
    }
    render(<Controlled />);
    const user = userEvent.setup();
    const category = screen.getByRole("checkbox", { name: "Omission" }) as HTMLInputElement;
    await user.click(category);
    expect(changes).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    await user.click(category);
    expect(category.checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    expect(changes).toHaveBeenLastCalledWith({ decision: "accepted_corrected", clinical_change: false, categories: [], rationale: "Keep this" });
    expect(category.checked).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: "Clinically relevant change" }));
    expect(changes).toHaveBeenLastCalledWith({ decision: "accepted_corrected", clinical_change: true, categories: [], rationale: "Keep this" });
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

  it("announces supplied issues in their supplied order without inferring new issues", () => {
    const issues = Object.freeze(["RATIONALE_REQUIRED", "TEXT_EMPTY"] as const);
    render(<ReviewForm value={{}} issues={issues} onChange={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Review issues" });
    expect(list.getAttribute("aria-live")).toBe("polite");
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
    expect(second).toHaveBeenCalledWith({ decision: "query" });
    expect(first).not.toHaveBeenCalled();
    radios[0].focus();
    await userEvent.setup().keyboard(" ");
    expect(first).toHaveBeenCalledWith({ decision: "query" });
  });
});

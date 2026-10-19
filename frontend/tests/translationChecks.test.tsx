import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChecksSummary } from "../src/translation/ReviewParts";

it("failed_check_block_has_heading_explanation_detail_location_guidance_and_code", () => {
  render(<ChecksSummary failed={[{ code: "units_added", passed: false, detail: "mg added" }]} all={null} />);
  const block = screen.getByRole("heading", { level: 3, name: "Units added in translation" }).closest("section")!;
  const text = block.textContent!;
  expect(text).toContain("The translation run's check found a unit of measurement in the translation that it did not find in the source.");
  expect(within(block).getByText("“mg added”")).toBeTruthy();
  expect(text).toContain("This check does not point to a text location. Compare the source and the translation yourself.");
  expect(text).toContain("Choose Accepted unchanged and say in the rationale why the difference is correct.");
  const term = within(block).getByText("Technical code");
  expect(term.tagName).toBe("DT");
  expect(term.nextElementSibling?.textContent).toBe("units_added");
});
it("unknown_code_uses_the_fallback_explanation", () => {
  render(<ChecksSummary failed={[{ code: "glossary_miss", passed: false }]} all={null} />);
  expect(screen.getByText(/Ontocurator has no description for it; ask the project lead what it checks\./)).toBeTruthy();
});
it("show_all_checks_lists_the_code_on_its_own_labelled_line", () => {
  const { container } = render(<ChecksSummary failed={[]} all={[{ code: "numbers_changed", passed: true }]} />);
  const item = container.querySelector(".translation-checks-all li")!;
  expect(item.textContent).toContain("Numbers changed in translation");
  expect(item.querySelector("dt")?.textContent).toBe("Technical code");
});
it("keeps_the_order_heading_meaning_detail_location_guidance_code_and_unique_ids", () => {
  render(<>
    <ChecksSummary failed={[{ code: "units_added", passed: false, detail: "mg added" }, { code: "numbers_changed", passed: false }]} all={null} />
    <ChecksSummary failed={[{ code: "units_added", passed: false }]} all={null} />
  </>);
  const headings = screen.getAllByRole("heading", { level: 3 });
  expect(headings).toHaveLength(3);
  expect(new Set(headings.map((heading) => heading.id)).size).toBe(3);
  const block = headings[0].closest("section")!;
  expect(block.getAttribute("aria-labelledby")).toBe(headings[0].id);
  const text = block.textContent!;
  const order = ["Units added in translation", "What it means", "From the translation run", "This check does not point", "If the translation is right anyway", "Technical code"].map((part) => text.indexOf(part));
  expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true);
  expect(within(headings[1].closest("section")!).queryByText("From the translation run")).toBeNull();
});

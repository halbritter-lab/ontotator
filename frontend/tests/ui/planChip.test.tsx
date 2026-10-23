import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanChip } from "../../src/ui/PlanChip";
afterEach(cleanup);
it("is a toggle button named with its row and shows the check icon only when pressed", () => {
  const onToggle = vi.fn();
  const { rerender } = render(<PlanChip kind="review" pressed={false} name="Review, case-0101 fr" onToggle={onToggle} />);
  const chip = screen.getByRole("button", { name: "Review, case-0101 fr" });
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  expect(chip.querySelector("svg")).toBeNull();
  fireEvent.click(chip); expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<PlanChip kind="review" pressed name="Review, case-0101 fr" onToggle={onToggle} />);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(chip.querySelector("svg")).not.toBeNull();
  expect(chip.textContent).toContain("Translation review");
});
it("keeps focus while busy, ignores clicks and renders no status region of its own", () => {
  const onToggle = vi.fn();
  render(<PlanChip kind="annotate" pressed name="Annotate, case-0101 de" busy onToggle={onToggle} />);
  const chip = screen.getByRole("button", { name: /Annotate, case-0101 de/ });
  expect(chip.getAttribute("aria-disabled")).toBe("true");
  expect(chip.hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("status")).toBeNull(); // "Saving…" goes to the page's shared polite region (L3)
  fireEvent.click(chip); expect(onToggle).not.toHaveBeenCalled();
});
it("labels the chip kind and exposes its size", () => {
  render(<PlanChip kind="annotate" pressed={false} name="Annotate, case-0101 en" size="card" onToggle={() => undefined} />);
  const chip = screen.getByRole("button", { name: "Annotate, case-0101 en" });
  expect(chip.textContent).toBe("Annotate");
  expect(chip.getAttribute("data-size")).toBe("card");
  expect(chip.className).toContain("ui-plan-chip");
});

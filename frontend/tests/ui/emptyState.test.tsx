import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { EmptyState } from "../../src/ui/EmptyState";

it("renders_title_body_and_action", () => {
  render(<EmptyState title="No assignments" action={<button>Create assignment</button>}>Assign a work package to begin.</EmptyState>);
  expect(screen.getByRole("heading", { name: "No assignments" })).toBeTruthy();
  expect(screen.getByText("Assign a work package to begin.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create assignment" })).toBeTruthy();
});

it("wraps_numeric_zero_body_and_action_and_omits_false_and_absent_content", () => {
  const { container, rerender } = render(<EmptyState title="Empty" action={0}>{0}</EmptyState>);
  expect(container.querySelector(".empty-state-body")?.textContent).toBe("0");
  expect(container.querySelector(".empty-state-action")?.textContent).toBe("0");
  rerender(<EmptyState title="Empty" action={false}>{false}</EmptyState>);
  expect(container.querySelector(".empty-state-body")).toBeNull();
  expect(container.querySelector(".empty-state-action")).toBeNull();
  rerender(<EmptyState title="Empty" />);
  expect(container.querySelector(".empty-state-body")).toBeNull();
  expect(container.querySelector(".empty-state-action")).toBeNull();
});

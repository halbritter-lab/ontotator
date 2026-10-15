import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { EmptyState } from "../../src/ui/EmptyState";

it("renders_title_body_and_action", () => {
  render(<EmptyState title="No assignments" action={<button>Create assignment</button>}>Assign a work package to begin.</EmptyState>);
  expect(screen.getByRole("heading", { name: "No assignments" })).toBeTruthy();
  expect(screen.getByText("Assign a work package to begin.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create assignment" })).toBeTruthy();
});

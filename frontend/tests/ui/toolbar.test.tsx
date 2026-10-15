import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Toolbar } from "../../src/ui/Toolbar";

it("toolbar_is_a_labelled_group", () => {
  render(<Toolbar label="Case actions" className="case-actions"><button>Next case</button></Toolbar>);
  const group = screen.getByRole("group", { name: "Case actions" });
  expect(group.contains(screen.getByRole("button", { name: "Next case" }))).toBe(true);
  expect(group.classList.contains("case-actions")).toBe(true);
});

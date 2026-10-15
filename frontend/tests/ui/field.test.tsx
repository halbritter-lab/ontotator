import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Field } from "../../src/ui";

it("label_is_associated_with_the_control", () => {
  const ref = createRef<HTMLInputElement>();
  render(<Field id="term" label="Term"><input id="old-id" ref={ref} name="term" /></Field>);
  expect(screen.getByRole("textbox", { name: "Term" })).toBe(ref.current);
  expect(ref.current?.id).toBe("term");
  expect(ref.current?.name).toBe("term");
});

it("hint_and_error_are_described_by", () => {
  render(<Field id="term" label="Term" hint="Use an ontology identifier." error="Unknown term."><input aria-describedby="external term-hint" /></Field>);
  const control = screen.getByRole("textbox");
  expect(control.getAttribute("aria-describedby")).toBe("external term-hint term-error");
  expect(document.getElementById("term-hint")?.textContent).toBe("Use an ontology identifier.");
  expect(document.getElementById("term-error")?.textContent).toBe("Unknown term.");
});

it("error_sets_aria_invalid_and_is_announced", () => {
  const { rerender } = render(<Field id="term" label="Term" error="Unknown term."><input /></Field>);
  expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").id).toBe("term-error");
  rerender(<Field id="term" label="Term"><input /></Field>);
  expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("false");
  expect(screen.getByRole("textbox").hasAttribute("aria-describedby")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("required_is_in_the_label_text", () => {
  render(<Field id="term" label="Term" required><input /></Field>);
  const control = screen.getByRole("textbox", { name: "Term (required)" }) as HTMLInputElement;
  expect(control.required).toBe(true);
});

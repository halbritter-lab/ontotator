import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Textarea } from "../../src/ui";

it("forwards_ref_and_change_events", async () => {
  const ref = createRef<HTMLTextAreaElement>();
  let value = "";
  render(<Textarea id="notes" label="Notes" ref={ref} name="notes" rows={4} required hint="Describe the evidence." error="Notes are required." className="notes-input" onChange={(event) => { value = event.currentTarget.value; }} />);
  const control = screen.getByRole("textbox", { name: "Notes (required)" });
  expect(ref.current).toBe(control);
  await userEvent.type(control, "First line{Enter}Second line");
  expect(value).toBe("First line\nSecond line");
  expect(ref.current?.rows).toBe(4);
  expect(ref.current?.name).toBe("notes");
  expect(ref.current?.required).toBe(true);
  expect(control.classList.contains("form-control")).toBe(true);
  expect(control.classList.contains("notes-input")).toBe(true);
  expect(control.getAttribute("aria-describedby")).toBe("notes-hint notes-error");
  expect(control.getAttribute("aria-invalid")).toBe("true");
});

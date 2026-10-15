import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { TextInput } from "../../src/ui";

it("forwards_ref_and_change_events", async () => {
  const ref = createRef<HTMLInputElement>();
  let value = "";
  render(<TextInput id="name" label="Name" ref={ref} name="name" type="email" autoComplete="email" required className="name-input" onChange={(event) => { value = event.currentTarget.value; }} />);
  const control = screen.getByRole("textbox", { name: "Name (required)" });
  expect(ref.current).toBe(control);
  await userEvent.type(control, "a@example.org");
  expect(value).toBe("a@example.org");
  expect(ref.current?.type).toBe("email");
  expect(ref.current?.name).toBe("name");
  expect(ref.current?.autocomplete).toBe("email");
  expect(control.classList.contains("form-control")).toBe(true);
  expect(control.classList.contains("name-input")).toBe(true);
});

it("connects_hints_and_errors_and_preserves_disabled", async () => {
  render(<TextInput id="name" label="Name" hint="Use your name." error="Name is required." disabled defaultValue="Saved" aria-describedby="policy" />);
  const control = screen.getByRole("textbox") as HTMLInputElement;
  await userEvent.type(control, "Ignored");
  expect(control.value).toBe("Saved");
  expect(control.getAttribute("aria-describedby")).toBe("policy name-hint name-error");
  expect(control.getAttribute("aria-invalid")).toBe("true");
});

import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Checkbox } from "../../src/ui";

it("clicking_the_label_toggles", async () => {
  const ref = createRef<HTMLInputElement>();
  let checked = false;
  render(<Checkbox id="include" label="Include reviewed cases" hint="Applies to the export." ref={ref} name="include" value="reviewed" aria-describedby="policy" onChange={(event) => { checked = event.currentTarget.checked; }} />);
  const control = screen.getByRole("checkbox", { name: "Include reviewed cases" }) as HTMLInputElement;
  expect(ref.current).toBe(control);
  await userEvent.click(screen.getByText("Include reviewed cases"));
  expect(control.checked).toBe(true);
  expect(checked).toBe(true);
  expect(control.name).toBe("include");
  expect(control.value).toBe("reviewed");
  expect(control.getAttribute("aria-describedby")).toBe("policy include-hint");
  expect(document.getElementById("include-hint")?.textContent).toBe("Applies to the export.");
  await userEvent.keyboard(" ");
  expect(control.checked).toBe(false);
});

it("disabled_checkbox_does_not_toggle_and_required_is_named", async () => {
  render(<Checkbox id="include" label="Include reviewed cases" required disabled defaultChecked />);
  const control = screen.getByRole("checkbox", { name: "Include reviewed cases (required)" }) as HTMLInputElement;
  await userEvent.click(screen.getByText("Include reviewed cases (required)"));
  expect(control.checked).toBe(true);
  expect(control.required).toBe(true);
});

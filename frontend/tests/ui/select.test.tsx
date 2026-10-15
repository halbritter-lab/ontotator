import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Select } from "../../src/ui";

it("forwards_ref_and_change_events", async () => {
  const ref = createRef<HTMLSelectElement>();
  let value = "";
  render(<Select id="ontology" label="Ontology" ref={ref} name="ontology" required hint="Choose an ontology." error="Choose a supported ontology." className="ontology-select" defaultValue="hpo" onChange={(event) => { value = event.currentTarget.value; }}><option value="hpo">HPO</option><option value="mondo">MONDO</option></Select>);
  const control = screen.getByRole("combobox", { name: "Ontology (required)" });
  expect(ref.current).toBe(control);
  await userEvent.selectOptions(control, "mondo");
  expect(value).toBe("mondo");
  expect(ref.current?.name).toBe("ontology");
  expect(ref.current?.required).toBe(true);
  expect(control.classList.contains("form-select")).toBe(true);
  expect(control.classList.contains("ontology-select")).toBe(true);
  expect(control.getAttribute("aria-describedby")).toBe("ontology-hint ontology-error");
  expect(control.getAttribute("aria-invalid")).toBe("true");
});

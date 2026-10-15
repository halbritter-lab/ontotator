import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Button } from "../../src/ui/Button";

it("renders_variant_and_size_classes", () => {
  render(<Button variant="primary" size="sm" className="export-action">Export</Button>);
  expect(screen.getByRole("button").className).toBe("btn btn-primary btn-sm export-action");
});

it("loading_disables_and_sets_aria_busy_keeping_the_label", async () => {
  let clicks = 0;
  render(<Button loading onClick={() => clicks++}>Export</Button>);
  const button = screen.getByRole("button", { name: "Export" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(button);
  expect(clicks).toBe(0);
});

it("defaults_to_type_button", async () => {
  let submits = 0;
  render(<form onSubmit={(event) => { event.preventDefault(); submits++; }}><Button>Cancel</Button></form>);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(submits).toBe(0);
  expect(screen.getByRole("button").getAttribute("type")).toBe("button");
});

it("forwards_submit_attributes_and_ref", async () => {
  let submits = 0;
  const ref = createRef<HTMLButtonElement>();
  render(<form onSubmit={(event) => { event.preventDefault(); submits++; }}><Button ref={ref} type="submit" name="action" value="save">Save</Button></form>);
  ref.current?.focus();
  expect(document.activeElement).toBe(screen.getByRole("button"));
  await userEvent.keyboard("{Enter}");
  expect(submits).toBe(1);
  expect(ref.current?.name).toBe("action");
  expect(ref.current?.value).toBe("save");
});

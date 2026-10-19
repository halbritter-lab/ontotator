import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "../../src/ui/Button";

it("renders_variant_and_size_classes", () => {
  render(<Button variant="primary" size="sm" className="export-action">Export</Button>);
  expect(screen.getByRole("button").className).toBe("btn btn-primary btn-sm export-action");
});

it("loading_marks_aria_disabled_and_aria_busy_keeping_the_label", async () => {
  let clicks = 0;
  render(<Button loading onClick={() => clicks++}>Export</Button>);
  const button = screen.getByRole("button", { name: "Export" });
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-disabled")).toBe("true");
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

it("loading_uses_aria_disabled_keeps_focus_and_swallows_activation", async () => {
  const click = vi.fn();
  const { rerender } = render(<Button onClick={click}>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  button.focus();
  rerender(<Button onClick={click} loading>Save</Button>);
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
  button.click();
  expect(click).not.toHaveBeenCalled();
});

it("loading_submit_button_does_not_submit", async () => {
  let submits = 0;
  render(<form onSubmit={(event) => { event.preventDefault(); submits++; }}><Button type="submit" loading>Save</Button></form>);
  screen.getByRole("button", { name: "Save" }).click();
  expect(submits).toBe(0);
});

it("aria_disabled_without_loading_still_activates_so_callers_can_explain", () => {
  const click = vi.fn();
  render(<Button aria-disabled="true" onClick={click}>Keep</Button>);
  screen.getByRole("button", { name: "Keep" }).click();
  expect(click).toHaveBeenCalledOnce();
});

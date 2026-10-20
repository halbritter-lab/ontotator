import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { nextTriState, TriStateButton } from "../../src/ui/TriStateButton";
afterEach(cleanup);
it("cycles keep, on, off, keep", () => {
  expect([nextTriState("keep"), nextTriState("on"), nextTriState("off")]).toEqual(["on", "off", "keep"]);
});
it("names the cell with its state and shows mixed instead of keep", () => {
  const onChange = vi.fn();
  render(<TriStateButton value="keep" mixed="12 on, 8 off" label="Review, fr" onChange={onChange} />);
  const cell = screen.getByRole("button", { name: "Review, fr, mixed" });
  expect(cell.getAttribute("title")).toBe("12 on, 8 off");
  expect(cell.textContent).toContain("mixed");
  fireEvent.click(cell); expect(onChange).toHaveBeenCalledWith("on");
  expect(cell.getAttribute("aria-describedby")).toContain("tristate-hint");
  expect(document.getElementById(cell.getAttribute("aria-describedby")!.split(" ")[0])?.textContent).toBe("Click to change: keep, on, off.");
});
it("shows on and off as text with an icon, appends describedBy and ignores clicks when disabled", () => {
  const onChange = vi.fn();
  const { rerender } = render(<TriStateButton value="on" label="Annotate, de" describedBy="will-change" onChange={onChange} />);
  const cell = screen.getByRole("button", { name: "Annotate, de, on" });
  expect(cell.textContent).toContain("on"); expect(cell.querySelector("svg")).not.toBeNull();
  expect(cell.getAttribute("aria-describedby")?.split(" ")).toContain("will-change");
  fireEvent.click(cell); expect(onChange).toHaveBeenCalledWith("off");
  rerender(<TriStateButton value="off" label="Annotate, de" disabled onChange={onChange} />);
  const off = screen.getByRole("button", { name: "Annotate, de, off" });
  expect(off.getAttribute("aria-disabled")).toBe("true"); expect(off.hasAttribute("disabled")).toBe(false);
  fireEvent.click(off); expect(onChange).toHaveBeenCalledTimes(1);
});

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StagePath, type PathSegment } from "../../src/ui/StagePath";

afterEach(cleanup);
const SEGMENTS: PathSegment[] = [
  { id: "translation", title: "Translation", state: "Done", tone: "done" },
  { id: "annotation", title: "Annotation", state: "1 of 2 submitted", tone: "now" },
  { id: "finalization", title: "Finalization", state: "Not started", tone: "later" },
];

it("renders three segments with title and state", () => {
  render(<StagePath segments={SEGMENTS} />);
  const nav = screen.getByRole("navigation", { name: "Text path" });
  const items = nav.querySelectorAll("li");
  expect(items).toHaveLength(3);
  expect(items[1].querySelector(".stage-path-title")?.textContent).toBe("Annotation");
  expect(items[1].querySelector(".stage-path-state")?.textContent).toBe("1 of 2 submitted");
  expect(items[0].querySelector(".stage-path-seg--done")).not.toBeNull();
  // A state cut after two lines keeps its full text on hover.
  expect(items[1].querySelector(".stage-path-state")?.getAttribute("title")).toBe("1 of 2 submitted");
});

it("marks the current segment with aria-current=step", () => {
  render(<StagePath segments={SEGMENTS} current="annotation" onSelect={() => {}} />);
  const current = screen.getByRole("button", { name: /Annotation/ });
  expect(current.getAttribute("aria-current")).toBe("step");
  expect(current.classList.contains("stage-path-seg--current")).toBe(true);
  expect(screen.getByRole("button", { name: /Translation/ }).hasAttribute("aria-current")).toBe(false);
});

it("announces the tone in words", () => {
  render(<StagePath segments={[...SEGMENTS, { id: "x", title: "Extra", state: "", tone: "optional" }]} onSelect={() => {}} />);
  expect(screen.getByRole("button", { name: /Translation.*, done$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Annotation.*, needs work now$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Finalization.*, later$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Extra.*, optional$/ })).toBeTruthy();
});

it("calls onSelect with the id", async () => {
  const onSelect = vi.fn();
  render(<StagePath segments={SEGMENTS} onSelect={onSelect} label="Path of case-1 de" />);
  expect(screen.getByRole("navigation", { name: "Path of case-1 de" })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: /Finalization/ }));
  expect(onSelect).toHaveBeenCalledWith("finalization");
});

it("renders no buttons without onSelect", () => {
  render(<StagePath segments={SEGMENTS} current="annotation" />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(document.querySelector(".stage-path-seg--current")).not.toBeNull();
});

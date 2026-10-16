import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DiffView } from "../src/translation/DiffView";
import { paragraphStarts } from "../src/variants/paragraphs";
afterEach(cleanup);

it("renders raw React word parts losslessly without interpreting HTML", () => {
  const before = "<b>old</b> 😀\r\n", after = "<b>new</b> 😀\n ";
  const { container } = render(<DiffView before={before} after={after} />);
  const pieces = Array.from(container.querySelectorAll<HTMLElement>("[data-diff-op]"));
  expect(pieces.filter(n => n.dataset.diffOp !== "insert").map(n => n.textContent).join("")).toBe(before);
  expect(pieces.filter(n => n.dataset.diffOp !== "delete").map(n => n.textContent).join("")).toBe(after);
  expect(container.querySelector("b")).toBeNull();
  expect(container.querySelector("ins")).not.toBeNull();
  expect(container.querySelector("del")).not.toBeNull();
});
it("places codepoint paragraph markers in proposed coordinates without counting deletions", () => {
  const after = "😀first\n\nsecond\n\nthird";
  const { container } = render(<DiffView before={"deleted old paragraph\n\n" + after} after={after} />);
  const markers = Array.from(container.querySelectorAll<HTMLElement>("[data-paragraph]"));
  expect(markers.map(n => Number(n.dataset.paragraphOffset))).toEqual(paragraphStarts(after));
  expect(markers.map(n => n.dataset.paragraph)).toEqual(["0", "1", "2"]);
  expect(markers.every(n => n.textContent === "")).toBe(true);
});
it("keeps a real zero marker for an empty proposed text", () => {
  const { container } = render(<DiffView before="Deleted" after="" />);
  expect(container.querySelectorAll("[data-paragraph]")).toHaveLength(1);
  expect(container.querySelector<HTMLElement>("[data-paragraph]")?.dataset.paragraphOffset).toBe("0");
});

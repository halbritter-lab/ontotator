// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paragraphAt, paragraphStarts } from "../src/variants/paragraphs";

describe("paragraphStarts", () => {
  it.each([
    ["first\n\nsecond", [0, 7]],
    ["first\nsecond\n\nthird\nfourth", [0, 14]],
    ["first\n\n\nsecond", [0, 8]],
    ["first\n \t\nsecond", [0, 9]],
    ["first\n \t\n\t\n  second", [0, 11]],
    ["first\nsecond\nthird", [0, 6, 13]],
    ["😀 first\n\nsecond", [0, 9]],
    ["😀\nsecond", [0, 2]],
    ["", [0]],
    ["one paragraph", [0]],
    ["first\n", [0]],
    ["first\nsecond\n", [0, 6]],
    ["first\n\n", [0]],
    ["first\nsecond\n\n", [0]],
    ["first\n \t\n", [0]],
    ["\n\nfirst", [0, 2]],
    ["\nfirst", [0, 1]],
    ["\n\n", [0]],
    ["\n", [0]],
    ["first\n\n \t", [0, 7]],
    ["first\rsecond", [0]],
    ["a\r\nb", [0, 3]],
    ["a\r\n\r\nb", [0, 3, 5]],
    ["e\u0301\n\nlast", [0, 4]],
  ] as const)("preserves exact codepoint structure for %j", (text, expected) => {
    expect(paragraphStarts(text)).toEqual(expected);
  });

  it("switches from line mode to paragraph mode when the first blank line is typed", () => {
    expect(paragraphStarts("a\nb\nc")).toEqual([0, 2, 4]);
    expect(paragraphStarts("a\n\nb\nc")).toEqual([0, 3]);
  });

  it("does not trim indentation or normalize the original text", () => {
    const text = "😀\r\n\n  next";
    const starts = paragraphStarts(text);
    expect(starts).toEqual([0, 4]);
    expect(Array.from(text).slice(starts[1]).join("")).toBe("  next");
    expect(text).toBe("😀\r\n\n  next");
  });
});

describe("paragraphAt", () => {
  const starts = Object.freeze([0, 7, 20, 45]);
  it.each([[-10, 0], [0, 0], [6, 0], [7, 1], [19, 1], [20, 2], [44, 2], [45, 3], [1000, 3]])(
    "finds/clamps offset %i to paragraph %i without changing starts",
    (offset, expected) => {
      expect(paragraphAt(starts, offset)).toBe(expected);
      expect(starts).toEqual([0, 7, 20, 45]);
    },
  );

  it("keeps empty-text and single-paragraph offsets at zero", () => {
    expect(paragraphAt(paragraphStarts(""), 0)).toBe(0);
    expect(paragraphAt([0], 1000)).toBe(0);
    expect(paragraphAt([0], -1000)).toBe(0);
  });
});

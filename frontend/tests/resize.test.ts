import { describe, expect, it } from "vitest";
import { resizeSegment, stepOffset, wordBoundary } from "../src/spans/resize";

//            0         1         2
//            0123456789012345678901234
const TEXT = "severe muscular hypotonia";

describe("resizeSegment", () => {
  it("moves the start edge outwards and inwards", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 0)).toEqual([{ start: 0, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 0, end: 15 }], 0, "start", 7)).toEqual([{ start: 7, end: 15 }]);
  });

  it("moves the end edge outwards and inwards", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 25)).toEqual([{ start: 7, end: 25 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 25 }], 0, "end", 15)).toEqual([{ start: 7, end: 15 }]);
  });

  it("returns null when nothing changes", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 15)).toBeNull();
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 7)).toBeNull();
  });

  it("keeps at least one character: an edge cannot cross the other edge", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", 22)).toEqual([{ start: 14, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 2)).toEqual([{ start: 7, end: 8 }]);
  });

  it("trims whitespace at the moved edge", () => {
    // Dropping the end on the space after "muscular" keeps the end at "muscular".
    expect(resizeSegment(TEXT, [{ start: 7, end: 25 }], 0, "end", 16)).toEqual([{ start: 7, end: 15 }]);
    // Dropping the start on the space before "muscular" snaps to "muscular".
    expect(resizeSegment(TEXT, [{ start: 0, end: 15 }], 0, "start", 6)).toEqual([{ start: 7, end: 15 }]);
  });

  it("clamps to the text", () => {
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "start", -5)).toEqual([{ start: 0, end: 15 }]);
    expect(resizeSegment(TEXT, [{ start: 7, end: 15 }], 0, "end", 999)).toEqual([{ start: 7, end: 25 }]);
  });

  it("merges with a neighbouring segment of the same mention when they touch or overlap", () => {
    const segments = [{ start: 0, end: 6 }, { start: 16, end: 25 }];
    expect(resizeSegment(TEXT, segments, 0, "end", 18)).toEqual([{ start: 0, end: 25 }]);
    expect(resizeSegment(TEXT, segments, 1, "start", 3)).toEqual([{ start: 0, end: 25 }]);
    // Separated by whitespace only: the space is trimmed, so they do not touch and both stay.
    expect(resizeSegment(TEXT, segments, 1, "start", 6)).toEqual([{ start: 0, end: 6 }, { start: 7, end: 25 }]);
    // Not touching: both segments stay.
    expect(resizeSegment(TEXT, segments, 0, "end", 15)).toEqual([{ start: 0, end: 15 }, { start: 16, end: 25 }]);
  });

  it("never places an edge inside a surrogate pair", () => {
    const text = "A😀B"; // UTF-16: A=0, 😀=1..3, B=3
    expect(resizeSegment(text, [{ start: 0, end: 1 }], 0, "end", 2)).toBeNull();
    expect(resizeSegment(text, [{ start: 0, end: 1 }], 0, "end", 3)).toEqual([{ start: 0, end: 3 }]);
    // Minimum length is one codepoint, not one UTF-16 unit.
    expect(resizeSegment(text, [{ start: 1, end: 4 }], 0, "end", 0)).toEqual([{ start: 1, end: 3 }]);
  });
});

describe("stepOffset", () => {
  it("steps by one codepoint and stops at the text bounds", () => {
    const text = "A😀B";
    expect(stepOffset(text, 1, 1)).toBe(3);
    expect(stepOffset(text, 3, -1)).toBe(1);
    expect(stepOffset(text, 0, -1)).toBe(0);
    expect(stepOffset(text, 4, 1)).toBe(4);
  });
});

describe("wordBoundary", () => {
  it("finds the next change between word and non-word characters", () => {
    expect(wordBoundary(TEXT, 7, 1)).toBe(15); // end of "muscular"
    expect(wordBoundary(TEXT, 15, 1)).toBe(16); // across the space
    expect(wordBoundary(TEXT, 15, -1)).toBe(7); // start of "muscular"
    expect(wordBoundary(TEXT, 7, -1)).toBe(6);
    expect(wordBoundary(TEXT, 0, -1)).toBe(0);
    expect(wordBoundary(TEXT, 25, 1)).toBe(25);
  });

  it("treats letters with diacritics and digits as word characters", () => {
    expect(wordBoundary("Muskelschwäche2 links", 0, 1)).toBe(15);
  });
});

describe("visible characters", () => {
  const ACCENT = "cafe\u0301 au lait"; // "e" + combining acute = one visible character (3..5)
  const FAMILY = "a\u{1F468}\u200D\u{1F469}\u200D\u{1F467}b"; // one joined emoji between a and b

  it("steps over a base letter and its combining mark as one character", () => {
    expect(stepOffset(ACCENT, 3, 1)).toBe(5);
    expect(stepOffset(ACCENT, 5, -1)).toBe(3);
    expect(wordBoundary(ACCENT, 0, 1)).toBe(5);
  });

  it("never leaves an edge between a letter and its accent", () => {
    expect(resizeSegment(ACCENT, [{ start: 0, end: 3 }], 0, "end", 4)).toBeNull();
    expect(resizeSegment(ACCENT, [{ start: 0, end: 5 }], 0, "end", 4)).toEqual([{ start: 0, end: 3 }]);
    expect(resizeSegment(ACCENT, [{ start: 0, end: 5 }], 0, "start", 4)).toEqual([{ start: 3, end: 5 }]);
  });

  it("treats a joined emoji as one character", () => {
    const end = FAMILY.length - 1;
    expect(stepOffset(FAMILY, 1, 1)).toBe(end);
    expect(stepOffset(FAMILY, end, -1)).toBe(1);
    expect(resizeSegment(FAMILY, [{ start: 0, end: 1 }], 0, "end", 4)).toBeNull();
  });

  it("handles a Windows line break inside the text", () => {
    const text = "ab\r\ncd";
    expect(resizeSegment(text, [{ start: 0, end: 2 }], 0, "end", 4)).toBeNull(); // only the line break: trimmed
    expect(resizeSegment(text, [{ start: 0, end: 2 }], 0, "end", 5)).toEqual([{ start: 0, end: 5 }]);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  sliceByCodepoints,
  toCodepoint,
  toUtf16,
  validateCodepointRange,
} from "../src/spans/offsets";

describe("Unicode codepoint offset conversions", () => {
  it("converts ASCII text 1-to-1", () => {
    const text = "Hello world";
    for (let i = 0; i <= text.length; i++) {
      expect(toUtf16(text, i)).toBe(i);
      expect(toCodepoint(text, i)).toBe(i);
    }
  });

  it("converts text with surrogate pairs and combining characters accurately", () => {
    // Exact spec test string:
    // A (0)
    // 😀 (1, utf-16 len 2: indices 1, 2)
    // e (2, utf-16 index 3)
    // \u0301 (3, utf-16 index 4)
    // \r (4, utf-16 index 5)
    // \n (5, utf-16 index 6)
    // B (6, utf-16 index 7)
    const text = "A😀e\u0301\r\nB";
    expect(Array.from(text).length).toBe(7);
    expect(text.length).toBe(8);

    expect(toUtf16(text, 0)).toBe(0);
    expect(toUtf16(text, 1)).toBe(1);
    expect(toUtf16(text, 2)).toBe(3);
    expect(toUtf16(text, 3)).toBe(4);
    expect(toUtf16(text, 4)).toBe(5);
    expect(toUtf16(text, 5)).toBe(6);
    expect(toUtf16(text, 6)).toBe(7);
    expect(toUtf16(text, 7)).toBe(8);

    expect(toCodepoint(text, 0)).toBe(0);
    expect(toCodepoint(text, 1)).toBe(1);
    expect(toCodepoint(text, 3)).toBe(2);
    expect(toCodepoint(text, 4)).toBe(3);
    expect(toCodepoint(text, 5)).toBe(4);
    expect(toCodepoint(text, 6)).toBe(5);
    expect(toCodepoint(text, 7)).toBe(6);
    expect(toCodepoint(text, 8)).toBe(7);
  });

  it("rejects an index that bisects a UTF-16 surrogate pair", () => {
    const text = "A😀e\u0301\r\nB";
    // Index 2 is between the high surrogate and low surrogate of 😀
    expect(() => toCodepoint(text, 2)).toThrow(/surrogate/i);
  });

  it("rejects out of bounds codepoint and UTF-16 indices", () => {
    const text = "A😀B"; // 3 codepoints, 4 UTF-16 units
    expect(() => toUtf16(text, -1)).toThrow(/out of bounds/i);
    expect(() => toUtf16(text, 4)).toThrow(/out of bounds/i);

    expect(() => toCodepoint(text, -1)).toThrow(/out of bounds/i);
    expect(() => toCodepoint(text, 5)).toThrow(/out of bounds/i);
  });

  it("slices strings by codepoints correctly", () => {
    const text = "A😀e\u0301\r\nB";
    expect(sliceByCodepoints(text, 0, 1)).toBe("A");
    expect(sliceByCodepoints(text, 1, 2)).toBe("😀");
    expect(sliceByCodepoints(text, 2, 4)).toBe("e\u0301");
    expect(sliceByCodepoints(text, 6, 7)).toBe("B");
  });

  it("validates codepoint ranges against text", () => {
    const text = "A😀B";
    expect(() => validateCodepointRange(text, 0, 2)).not.toThrow();
    expect(() => validateCodepointRange(text, 2, 1)).toThrow(/start.*end/i);
    expect(() => validateCodepointRange(text, 0, 5)).toThrow(/out of bounds/i);
  });
});

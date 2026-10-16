import { describe, expect, it } from "vitest";
import { diffText } from "../src/translation/textDiff";

const reconstructed = (parts: ReturnType<typeof diffText>, side: "before" | "after") =>
  parts.filter(part => part.op !== (side === "before" ? "insert" : "delete")).map(part => part.text).join("");

describe("review word diff", () => {
  it("marks inserted and deleted words without changing surrounding text", () => {
    expect(diffText("no fever present", "mild fever present")).toEqual([
      { op: "delete", text: "no" }, { op: "insert", text: "mild" },
      { op: "equal", text: " fever present" },
    ]);
  });

  it.each(["", "unchanged", "  😀e\u0301\r\n\ufeff "])("returns one equal part for identical input %j", text => {
    expect(diffText(text, text)).toEqual([{ op: "equal", text }]);
  });

  it.each([
    ["", "inserted\n"], ["removed\t", ""],
    ["one  two\tthree\n", "one two three\r\n"],
    ["\ufeffsame", "same"], ["e\u0301", "é"],
    ["line\r\nnext", "line\nnext"],
    ["😀 high", "😷 low"], ["👩‍⚕️ text", "👨‍⚕️  text"],
    ["alpha beta alpha", "beta alpha beta"],
    ["x\u0000y", "x\u0000 z"], ["word, punctuation!", "word; punctuation?"],
  ])("reconstructs exact raw input %j → %j", (before, after) => {
    const parts = diffText(before, after);
    expect(reconstructed(parts, "before")).toBe(before);
    expect(reconstructed(parts, "after")).toBe(after);
    expect(parts.some(part => part.op === "delete" || part.op === "insert")).toBe(true);
    expect(parts.every(part => part.text.length > 0)).toBe(true);
    for (let index = 1; index < parts.length; index++) {
      expect(parts[index].op).not.toBe(parts[index - 1].op);
    }
  });

  it("keeps changed astral symbols whole in every rendered part", () => {
    const parts = diffText("😀", "😃");
    expect(reconstructed(parts, "before")).toBe("😀");
    expect(reconstructed(parts, "after")).toBe("😃");
    for (const part of parts) {
      for (const point of part.text) {
        const codepoint = point.codePointAt(0)!;
        expect(codepoint < 0xd800 || codepoint > 0xdfff).toBe(true);
      }
    }
    expect(parts).toEqual([{ op: "delete", text: "😀" }, { op: "insert", text: "😃" }]);
  });

  it("keeps whitespace-only changes visible", () => {
    const parts = diffText(" \t\n", "  \r\n");
    expect(parts.filter(part => part.op === "delete").map(part => part.text).join("")).toContain("\t");
    expect(parts.filter(part => part.op === "insert").map(part => part.text).join("")).toContain("\r\n");
    expect(reconstructed(parts, "before")).toBe(" \t\n");
    expect(reconstructed(parts, "after")).toBe("  \r\n");
  });
});

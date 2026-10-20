import { expect, it } from "vitest";
import { parseCaseIds } from "../../src/documents/caseIds";

it("splits on newline, comma, semicolon, space and tab, trims, applies NFKC and drops duplicates", () => {
  expect(parseCaseIds("case-0101\ncase-0102,case-0103;case-0104 case-0105\tcase-0106\r\n")).toEqual(
    ["case-0101", "case-0102", "case-0103", "case-0104", "case-0105", "case-0106"]);
  expect(parseCaseIds("  case-0101 ,, ;\n\n case-0101\ncase-0102  ")).toEqual(["case-0101", "case-0102"]);
  // Full-width letters, digits and separators (NFKC) match the plain IDs.
  expect(parseCaseIds("ｃａｓｅ－０１０１，case-0102　case-0101")).toEqual(["case-0101", "case-0102"]);
  expect(parseCaseIds(" \n\t ")).toEqual([]);
});

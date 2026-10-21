import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { MAX_SELECTION_CASES, useTextSelection } from "../../src/documents/useTextSelection";

// Rows in list order: case c1 (en, de), c2 (en, de, fr), c3 (de).
const order = ["c1:en", "c1:de", "c2:en", "c2:de", "c2:fr", "c3:de"];
const keys = (result: { current: ReturnType<typeof useTextSelection> }) => [...result.current.keys];

it("selects texts, range over rows in list order, case toggle selects all texts", () => {
  const { result } = renderHook(() => useTextSelection());
  act(() => { result.current.select("c1:de", "toggle", order); });
  expect(keys(result)).toEqual(["c1:de"]);
  expect(result.current.anchor).toBe("c1:de");
  expect(result.current.cases.size).toBe(1);
  // Shift-click: every row between the anchor and the row, across cases.
  act(() => { result.current.select("c2:de", "range", order); });
  expect(keys(result).sort()).toEqual(["c1:de", "c2:de", "c2:en"]);
  expect(result.current.anchor).toBe("c1:de");
  expect(result.current.rows).toEqual([{ case_id: "c1", language: "de" }, { case_id: "c2", language: "en" }, { case_id: "c2", language: "de" }]);
  // Toggle off one text.
  act(() => { result.current.select("c2:en", "toggle", order); });
  expect(keys(result).sort()).toEqual(["c1:de", "c2:de"]);
  // Case checkbox: partly selected → selects every text of the case; fully selected → clears them.
  act(() => { result.current.selectCase(["c2:en", "c2:de", "c2:fr"], "toggle", order); });
  expect(keys(result).sort()).toEqual(["c1:de", "c2:de", "c2:en", "c2:fr"]);
  expect(result.current.caseState(["c2:en", "c2:de", "c2:fr"])).toBe("all");
  expect(result.current.caseState(["c1:en", "c1:de"])).toBe("some");
  expect(result.current.caseState(["c3:de"])).toBe("none");
  act(() => { result.current.selectCase(["c2:en", "c2:de", "c2:fr"], "toggle", order); });
  expect(keys(result)).toEqual(["c1:de"]);
  // Shift+Arrow ("select") adds without toggling.
  act(() => { result.current.select("c3:de", "select", order); });
  act(() => { result.current.select("c3:de", "select", order); });
  expect(keys(result).sort()).toEqual(["c1:de", "c3:de"]);
  expect(result.current.anchor).toBe("c3:de");
  // Case keys with a colon keep their language.
  act(() => { result.current.replace(["a:b:de"]); });
  expect(result.current.rows).toEqual([{ case_id: "a:b", language: "de" }]);
  act(() => { result.current.clear(); });
  expect(result.current.keys.size).toBe(0);
  expect(result.current.anchor).toBeNull();
});

it("toggle-keep-anchor keeps the range anchor; replace, add and remove", () => {
  const { result } = renderHook(() => useTextSelection());
  act(() => { result.current.select("c1:en", "toggle", order); });
  act(() => { result.current.select("c2:en", "toggle-keep-anchor", order); });
  expect(result.current.anchor).toBe("c1:en");
  act(() => { result.current.replace(["c3:de", "c3:de", "c1:en"]); });
  expect(keys(result)).toEqual(["c3:de", "c1:en"]);
  act(() => { result.current.add(["c2:fr"]); });
  act(() => { result.current.remove(["c3:de"]); });
  expect(keys(result)).toEqual(["c1:en", "c2:fr"]);
});

it("caps at 2000 cases", () => {
  expect(MAX_SELECTION_CASES).toBe(2000);
  // Two texts per case: 2500 cases, 5000 texts.
  const many = Array.from({ length: 2500 }, (_, index) => [`case-${index}:en`, `case-${index}:de`]).flat();
  const { result } = renderHook(() => useTextSelection());
  act(() => { expect(result.current.replace(many)).toEqual({ truncated: true }); });
  expect(result.current.cases.size).toBe(2000);
  expect(result.current.keys.size).toBe(4000);
  expect(keys(result).at(-1)).toBe("case-1999:de");
  // Another text of a selected case still fits; a new case does not.
  act(() => { result.current.remove(["case-0:de"]); });
  act(() => { expect(result.current.select("case-0:de", "toggle", many)).toEqual({ truncated: false }); });
  act(() => { expect(result.current.select("extra:de", "toggle", ["extra:de"])).toEqual({ truncated: true }); });
  expect(result.current.keys.has("extra:de")).toBe(false);
});

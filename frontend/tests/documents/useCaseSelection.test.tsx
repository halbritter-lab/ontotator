import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { MAX_SELECTION, useCaseSelection } from "../../src/documents/useCaseSelection";

const order = ["c1", "c2", "c3", "c4", "c5", "c6"];
const ids = (result: { current: ReturnType<typeof useCaseSelection> }) => [...result.current.ids];

it("toggle adds and removes one case and sets the anchor", () => {
  const { result } = renderHook(() => useCaseSelection());
  act(() => { result.current.select("c2", "toggle", order); });
  expect(ids(result)).toEqual(["c2"]);
  expect(result.current.anchor).toBe("c2");
  act(() => { result.current.select("c4", "toggle", order); });
  expect(ids(result)).toEqual(["c2", "c4"]);
  expect(result.current.anchor).toBe("c4");
  act(() => { result.current.select("c2", "toggle", order); });
  expect(ids(result)).toEqual(["c4"]);
  expect(result.current.anchor).toBe("c2");
});

it("range selects from the anchor to the case in list order within the page", () => {
  const { result } = renderHook(() => useCaseSelection());
  act(() => { result.current.select("c2", "toggle", order); });
  act(() => { result.current.select("c5", "range", order); });
  expect(ids(result).sort()).toEqual(["c2", "c3", "c4", "c5"]);
  expect(result.current.anchor).toBe("c2");
  // Backwards from the same anchor; nothing is deselected.
  act(() => { result.current.select("c1", "range", order); });
  expect(ids(result).sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  // Without an anchor on this page (another page's anchor), the case alone is selected and becomes the anchor.
  const { result: other } = renderHook(() => useCaseSelection());
  act(() => { other.current.select("x9", "toggle", ["x9"]); });
  act(() => { other.current.select("c3", "range", order); });
  expect(ids(other)).toEqual(["x9", "c3"]);
  expect(other.current.anchor).toBe("c3");
});

it("toggle-keep-anchor keeps the range anchor", () => {
  const { result } = renderHook(() => useCaseSelection());
  act(() => { result.current.select("c1", "toggle", order); });
  act(() => { result.current.select("c4", "range", order); });
  act(() => { result.current.select("c3", "toggle-keep-anchor", order); });
  expect(ids(result).sort()).toEqual(["c1", "c2", "c4"]);
  expect(result.current.anchor).toBe("c1");
  act(() => { result.current.select("c6", "range", order); });
  expect(ids(result).sort()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
});

it("select adds without toggling", () => {
  const { result } = renderHook(() => useCaseSelection());
  act(() => { result.current.select("c1", "select", order); });
  act(() => { result.current.select("c1", "select", order); });
  act(() => { result.current.select("c2", "select", order); });
  expect(ids(result)).toEqual(["c1", "c2"]);
  expect(result.current.anchor).toBe("c2");
});

it("survives page and filter changes", () => {
  const { result, rerender } = renderHook((props: { page: number }) => { void props.page; return useCaseSelection(); }, { initialProps: { page: 1 } });
  act(() => { result.current.select("c1", "toggle", order); });
  rerender({ page: 2 });
  act(() => { result.current.select("d1", "toggle", ["d1", "d2"]); });
  rerender({ page: 1 });
  expect(ids(result)).toEqual(["c1", "d1"]);
});

it("replace and add for pasted lists", () => {
  const { result } = renderHook(() => useCaseSelection());
  act(() => { result.current.select("c1", "toggle", order); });
  act(() => { expect(result.current.replace(["p1", "p2", "p1"])).toEqual({ truncated: false }); });
  expect(ids(result)).toEqual(["p1", "p2"]);
  expect(result.current.anchor).toBeNull();
  act(() => { expect(result.current.add(["p2", "p3"])).toEqual({ truncated: false }); });
  expect(ids(result)).toEqual(["p1", "p2", "p3"]);
  act(() => { result.current.remove(["p1"]); });
  expect(ids(result)).toEqual(["p2", "p3"]);
  act(() => { result.current.clear(); });
  expect(result.current.ids.size).toBe(0);
});

it("never holds more than 2000 cases and reports truncation", () => {
  expect(MAX_SELECTION).toBe(2000);
  const many = Array.from({ length: 2500 }, (_, index) => `case-${index}`);
  const { result } = renderHook(() => useCaseSelection());
  act(() => { expect(result.current.replace(many)).toEqual({ truncated: true }); });
  expect(result.current.ids.size).toBe(2000);
  expect(ids(result).at(-1)).toBe("case-1999");
  act(() => { expect(result.current.add(["extra"])).toEqual({ truncated: true }); });
  act(() => { expect(result.current.select("extra", "toggle", ["extra"])).toEqual({ truncated: true }); });
  expect(result.current.ids.has("extra")).toBe(false);
  act(() => { result.current.replace(many.slice(0, 1998)); });
  act(() => { expect(result.current.add(["a", "b", "c"])).toEqual({ truncated: true }); });
  expect(ids(result).slice(-2)).toEqual(["a", "b"]);
});

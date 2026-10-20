import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCoalescedAxisChange } from "../src/editor/useCoalescedAxisChange";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("sends one mutation 300 ms after the last change within an axis and shows the local value at once", () => {
  const send = vi.fn();
  const { result } = renderHook(() => useCoalescedAxisChange({ assertion: "present", experiencer: "patient" }, send));
  act(() => { result.current.change("assertion", "absent"); });
  act(() => { result.current.change("assertion", "uncertain"); });
  expect(result.current.values.assertion).toBe("uncertain");
  act(() => { vi.advanceTimersByTime(299); });
  expect(send).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ assertion: "uncertain", experiencer: "patient" });
});

it("flushes the pending axis when another axis changes and on flush()", () => {
  const send = vi.fn();
  const { result } = renderHook(() => useCoalescedAxisChange({ assertion: "present", experiencer: "patient" }, send));
  act(() => { result.current.change("assertion", "absent"); result.current.change("experiencer", "other"); });
  expect(send).toHaveBeenCalledWith({ assertion: "absent", experiencer: "patient" });
  act(() => { result.current.flush(); });
  expect(send).toHaveBeenLastCalledWith({ assertion: "absent", experiencer: "other" });
});

it("keeps a sent value until the base changes and sends a pending change on unmount", () => {
  const send = vi.fn();
  let base: Record<string, string | null> = { assertion: "present" };
  const { result, rerender, unmount } = renderHook(() => useCoalescedAxisChange(base, send));
  act(() => { result.current.change("assertion", "absent"); result.current.flush(); });
  expect(result.current.values.assertion).toBe("absent");
  base = { assertion: "uncertain" };
  rerender();
  expect(result.current.values.assertion).toBe("uncertain");
  act(() => { result.current.change("assertion", "present"); });
  unmount();
  expect(send).toHaveBeenLastCalledWith({ assertion: "present" });
  expect(send).toHaveBeenCalledTimes(2);
});

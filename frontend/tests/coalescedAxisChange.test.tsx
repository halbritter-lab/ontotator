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

it("drops sent values when the base changes and sends the pending change against the new base at unmount", () => {
  const send = vi.fn();
  let base: Record<string, string | null> = { assertion: "present", experiencer: "patient" };
  const { result, rerender, unmount } = renderHook(() => useCoalescedAxisChange(base, send));
  act(() => { result.current.change("assertion", "absent"); result.current.flush(); });
  expect(send).toHaveBeenLastCalledWith({ assertion: "absent", experiencer: "patient" });
  // The saved values changed elsewhere: the earlier sent value no longer applies.
  base = { assertion: "uncertain", experiencer: "patient" };
  rerender();
  act(() => { result.current.change("experiencer", "other"); });
  expect(result.current.values).toEqual({ assertion: "uncertain", experiencer: "other" });
  unmount();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({ assertion: "uncertain", experiencer: "other" });
});

it("shows the saved value again when the coalesced save fails", async () => {
  let reject!: (error: unknown) => void;
  const send = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const { result } = renderHook(() => useCoalescedAxisChange({ assertion: "present" }, send));
  act(() => { result.current.change("assertion", "absent"); result.current.flush(); });
  expect(result.current.values.assertion).toBe("absent");
  await act(async () => { reject(new Error("refused")); await Promise.resolve(); });
  expect(result.current.values.assertion).toBe("present");
});

it("does not send a change back to the saved value when nothing was sent", () => {
  const send = vi.fn();
  const { result } = renderHook(() => useCoalescedAxisChange({ assertion: "present" }, send));
  act(() => { result.current.change("assertion", "absent"); result.current.change("assertion", "present"); });
  act(() => { vi.advanceTimersByTime(300); });
  expect(send).not.toHaveBeenCalled();
  expect(result.current.values.assertion).toBe("present");
});

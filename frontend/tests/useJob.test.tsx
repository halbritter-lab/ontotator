import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, NetworkError } from "../src/api/client";
import { useJob } from "../src/admin/useJob";

const job = (id: number, status = "running") => ({ id, kind: "upload_preview", status, result: null, error: null, created_at: "2026-10-16T10:00:00Z", finished_at: null });
describe("useJob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  it("polls until terminal and then stops", async () => {
    const get = vi.spyOn(api, "getJob").mockResolvedValueOnce(job(1) as never).mockResolvedValueOnce(job(1, "succeeded") as never);
    const { result } = renderHook(() => useJob(1));
    await act(async () => {});
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.job).toMatchObject({ status: "succeeded" });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("does not overlap requests and ignores replies from an old ID or unmount", async () => {
    let resolve!: (value: never) => void;
    const get = vi.spyOn(api, "getJob").mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(job(2, "failed") as never);
    const { result, rerender, unmount } = renderHook(({ id }) => useJob(id), { initialProps: { id: 1 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(get).toHaveBeenCalledTimes(1);
    rerender({ id: 2 });
    await act(async () => {});
    await act(async () => { resolve(job(1, "succeeded") as never); });
    expect(result.current.job).toMatchObject({ id: 2, status: "failed" });
    expect(result.current.error).toBeUndefined();
    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("backs off after thirty seconds and enforces a minimum one second interval", async () => {
    const get = vi.spyOn(api, "getJob").mockResolvedValue(job(1) as never);
    renderHook(() => useJob(1, { intervalMs: 10 }));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(get).toHaveBeenCalledTimes(31);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(get).toHaveBeenCalledTimes(31);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(get).toHaveBeenCalledTimes(32);
  });
  it("separates request errors from failed job data and stops on request errors", async () => {
    const error = new Error("Offline");
    const get = vi.spyOn(api, "getJob").mockRejectedValue(error);
    const { result } = renderHook(() => useJob(1));
    await act(async () => {});
    expect(result.current.error).toBe(error);
    expect(result.current.job).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("keeps polling through a lost connection or a server error", async () => {
    const get = vi.spyOn(api, "getJob")
      .mockResolvedValueOnce(job(1) as never)
      .mockRejectedValueOnce(new NetworkError(new TypeError("offline")))
      .mockRejectedValueOnce(new ApiError(502, "Bad gateway"))
      .mockResolvedValueOnce(job(1, "succeeded") as never);
    const { result } = renderHook(() => useJob(1));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.error).toBeUndefined();
    expect(result.current.job).toMatchObject({ status: "running" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(get).toHaveBeenCalledTimes(4);
    expect(result.current.job).toMatchObject({ status: "succeeded" });
  });
  it("stops on a 4xx answer", async () => {
    const error = new ApiError(404, "Not found");
    const get = vi.spyOn(api, "getJob").mockRejectedValue(error);
    const { result } = renderHook(() => useJob(1));
    await act(async () => {});
    expect(result.current.error).toBe(error);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

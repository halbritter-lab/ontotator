import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, notifySessionRestored } from "../../src/api/client";
import { DOCUMENTS_CHANGED, notifyDocumentsChanged } from "../../src/documents/documentsEvents";
import { DOCUMENTS_SUMMARY_REFRESH_MS, useDocumentsSummary } from "../../src/documents/useDocumentsSummary";

beforeEach(() => { vi.spyOn(api, "documentsSummary").mockResolvedValue({ needs_decision: 3 }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("documents events", () => {
  it("fires documents-changed on window", () => {
    const listener = vi.fn();
    window.addEventListener(DOCUMENTS_CHANGED, listener);
    notifyDocumentsChanged();
    window.removeEventListener(DOCUMENTS_CHANGED, listener);
    expect(DOCUMENTS_CHANGED).toBe("documents-changed");
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("useDocumentsSummary", () => {
  it("loads needs_decision of the project once", async () => {
    const { result } = renderHook(() => useDocumentsSummary("p1", true));
    await waitFor(() => expect(result.current).toBe(3));
    expect(api.documentsSummary).toHaveBeenCalledOnce();
    expect(api.documentsSummary).toHaveBeenCalledWith("p1");
  });

  it("loads nothing when disabled or without a project", () => {
    const { result, rerender } = renderHook(({ key, enabled }: { key: string | undefined; enabled: boolean }) => useDocumentsSummary(key, enabled),
      { initialProps: { key: "p1" as string | undefined, enabled: false } });
    rerender({ key: undefined, enabled: true });
    expect(result.current).toBeNull();
    expect(api.documentsSummary).not.toHaveBeenCalled();
  });

  it("reloads on focus, a restored session, documents-changed and every 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDocumentsSummary("p1", true));
    await waitFor(() => expect(result.current).toBe(3));
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 2 });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current).toBe(2));
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 1 });
    act(() => { notifyDocumentsChanged(); });
    await waitFor(() => expect(result.current).toBe(1));
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 5 });
    act(() => { notifySessionRestored(); });
    await waitFor(() => expect(result.current).toBe(5));
    vi.mocked(api.documentsSummary).mockResolvedValue({ needs_decision: 0 });
    expect(DOCUMENTS_SUMMARY_REFRESH_MS).toBe(60_000);
    await act(async () => { vi.advanceTimersByTime(DOCUMENTS_SUMMARY_REFRESH_MS); });
    await waitFor(() => expect(result.current).toBe(0));
    expect(api.documentsSummary).toHaveBeenCalledTimes(5);
  });

  it("drops the count of another project and keeps the last value on a failed reload", async () => {
    const { result, rerender } = renderHook(({ key }: { key: string }) => useDocumentsSummary(key, true), { initialProps: { key: "p1" } });
    await waitFor(() => expect(result.current).toBe(3));
    vi.mocked(api.documentsSummary).mockRejectedValueOnce(new Error("offline"));
    act(() => { notifyDocumentsChanged(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(3);
    vi.mocked(api.documentsSummary).mockReturnValue(new Promise(() => {}));
    rerender({ key: "p2" });
    expect(result.current).toBeNull();
  });

  it("ignores a stale response after a newer request", async () => {
    let resolveFirst: (value: { needs_decision: number }) => void = () => {};
    vi.mocked(api.documentsSummary).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useDocumentsSummary("p1", true));
    vi.mocked(api.documentsSummary).mockResolvedValueOnce({ needs_decision: 7 });
    act(() => { notifyDocumentsChanged(); });
    await waitFor(() => expect(result.current).toBe(7));
    await act(async () => { resolveFirst({ needs_decision: 9 }); });
    expect(result.current).toBe(7);
  });
});

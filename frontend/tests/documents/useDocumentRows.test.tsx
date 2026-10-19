import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type DocumentRowsPage, type DocumentRowsQuery, type RowSubmissions } from "../../src/api/client";
import { useDocumentRows } from "../../src/documents/useDocumentRows";
import { useRowSubmissions } from "../../src/documents/useRowSubmissions";
import { page, rowKey, scenarioS0, scenarioS1, submissions } from "./fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.spyOn(api, "listDocumentRows"); vi.spyOn(api, "getRowSubmissions"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("discards a response that resolves after a newer request", async () => {
  const first = deferred<DocumentRowsPage>();
  const second = deferred<DocumentRowsPage>();
  vi.mocked(api.listDocumentRows).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const older = page([scenarioS1().group]);
  const newer = page([scenarioS0().group]);
  const { result, rerender } = renderHook(({ query }: { query: DocumentRowsQuery }) => useDocumentRows("p", query), { initialProps: { query: { q: "a" } } });
  rerender({ query: { q: "ab" } });
  await act(async () => { second.resolve(newer); });
  await act(async () => { first.resolve(older); });
  expect(result.current.page).toBe(newer);
  expect(result.current.loading).toBe(false);
  expect(vi.mocked(api.listDocumentRows).mock.calls.map(call => call[1])).toEqual([{ q: "a" }, { q: "ab" }]);
});

it("refetches on window focus", async () => {
  vi.mocked(api.listDocumentRows).mockResolvedValue(page([]));
  const { result } = renderHook(() => useDocumentRows("p", {}));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(api.listDocumentRows).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});

it("refetches every 60 seconds", async () => {
  vi.useFakeTimers();
  vi.mocked(api.listDocumentRows).mockResolvedValue(page([]));
  renderHook(() => useDocumentRows("p", {}));
  expect(api.listDocumentRows).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});

it("refetches on reload and keeps the shown page while loading", async () => {
  const shown = page([scenarioS0().group]);
  const next = deferred<DocumentRowsPage>();
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(shown).mockReturnValueOnce(next.promise);
  const { result } = renderHook(() => useDocumentRows("p", {}));
  await waitFor(() => expect(result.current.page).toBe(shown));
  act(() => { result.current.reload(); });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
  expect(result.current.loading).toBe(true);
  expect(result.current.page).toBe(shown);
  const fresh = page([scenarioS1().group]);
  await act(async () => { next.resolve(fresh); });
  expect(result.current.page).toBe(fresh);
});

it("exposes an error without rows and retries", async () => {
  const failure = new Error("offline");
  vi.mocked(api.listDocumentRows).mockRejectedValueOnce(failure).mockResolvedValueOnce(page([]));
  const { result } = renderHook(() => useDocumentRows("p", {}));
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.page).toBeNull();
  expect(result.current.loading).toBe(false);
  await act(async () => { result.current.retry(); });
  await waitFor(() => expect(result.current.page).not.toBeNull());
  expect(result.current.error).toBeNull();
  expect(api.listDocumentRows).toHaveBeenCalledTimes(2);
});

it("sends retain on every refetch and keeps the page while only retained keys change", async () => {
  const shown = page([scenarioS0().group]);
  const next = deferred<DocumentRowsPage>();
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(shown).mockResolvedValueOnce(shown).mockReturnValueOnce(next.promise);
  const retain = [rowKey("synthetic-accepted", "de")];
  const { result, rerender } = renderHook(({ query }: { query: DocumentRowsQuery }) => useDocumentRows("p", query), { initialProps: { query: { decision: "all", retain } } });
  await waitFor(() => expect(result.current.page).toBe(shown));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(vi.mocked(api.listDocumentRows).mock.calls[1][1]).toEqual({ decision: "all", retain });
  const wider = [...retain, rowKey("case-0042", "en")];
  rerender({ query: { decision: "all", retain: wider } });
  expect(vi.mocked(api.listDocumentRows).mock.calls[2][1]).toEqual({ decision: "all", retain: wider });
  expect(result.current.loading).toBe(true);
  expect(result.current.page).toBe(shown);
});

it("keeps the previous page marked stale while another filter or page loads", async () => {
  const shown = page([scenarioS0().group]);
  const next = deferred<DocumentRowsPage>();
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(shown).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderHook(({ query }: { query: DocumentRowsQuery }) => useDocumentRows("p", query), { initialProps: { query: { decision: "all" } } });
  await waitFor(() => expect(result.current.page).toBe(shown));
  expect(result.current.stale).toBe(false);
  rerender({ query: { decision: "translation" } });
  expect(result.current.loading).toBe(true);
  expect(result.current.page).toBe(shown);
  expect(result.current.stale).toBe(true);
  const fresh = page([scenarioS1().group]);
  await act(async () => { next.resolve(fresh); });
  expect(result.current.page).toBe(fresh);
  expect(result.current.stale).toBe(false);
});

it("keeps the shown page and sets the error when a background refetch fails", async () => {
  const shown = page([scenarioS0().group]);
  const failure = new Error("offline");
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(shown).mockRejectedValueOnce(failure).mockResolvedValueOnce(shown);
  const { result } = renderHook(() => useDocumentRows("p", {}));
  await waitFor(() => expect(result.current.page).toBe(shown));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.page).toBe(shown);
  expect(result.current.loading).toBe(false);
  await act(async () => { result.current.retry(); });
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(result.current.page).toBe(shown);
});

it("drops the previous page when the first load of another filter fails", async () => {
  const shown = page([scenarioS0().group]);
  const failure = new Error("offline");
  vi.mocked(api.listDocumentRows).mockResolvedValueOnce(shown).mockRejectedValueOnce(failure);
  const { result, rerender } = renderHook(({ query }: { query: DocumentRowsQuery }) => useDocumentRows("p", query), { initialProps: { query: { decision: "all" } } });
  await waitFor(() => expect(result.current.page).toBe(shown));
  rerender({ query: { decision: "translation" } });
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.page).toBeNull();
  expect(result.current.stale).toBe(false);
});

it("does not refetch when an equal query object is passed again", async () => {
  vi.mocked(api.listDocumentRows).mockResolvedValue(page([]));
  const { result, rerender } = renderHook(({ query }: { query: DocumentRowsQuery }) => useDocumentRows("p", query), { initialProps: { query: { language: "de" } } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender({ query: { language: "de" } });
  expect(api.listDocumentRows).toHaveBeenCalledTimes(1);
});

it("loads row submissions only when enabled, discards stale responses and reloads", async () => {
  const s0 = scenarioS0();
  const de = s0.submissions[rowKey("synthetic-accepted", "de")];
  const en = s0.submissions[rowKey("synthetic-accepted", "en")];
  const stale = deferred<RowSubmissions>();
  vi.mocked(api.getRowSubmissions).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(en).mockResolvedValueOnce(en);
  const { result, rerender } = renderHook(
    ({ language, enabled }: { language: string; enabled: boolean }) => useRowSubmissions("p", "synthetic-accepted", language, enabled),
    { initialProps: { language: "de", enabled: false } },
  );
  expect(api.getRowSubmissions).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBeNull();
  rerender({ language: "de", enabled: true });
  expect(result.current.loading).toBe(true);
  rerender({ language: "en", enabled: true });
  await waitFor(() => expect(result.current.data).toBe(en));
  await act(async () => { stale.resolve(de); });
  expect(result.current.data).toBe(en);
  await act(async () => { result.current.reload(); });
  expect(api.getRowSubmissions).toHaveBeenCalledTimes(3);
  expect(vi.mocked(api.getRowSubmissions).mock.calls[2]).toEqual(["p", "synthetic-accepted", "en"]);
});

it("exposes a submissions error and retries", async () => {
  const failure = new Error("boom");
  const loaded = submissions("c", "de");
  vi.mocked(api.getRowSubmissions).mockRejectedValueOnce(failure).mockResolvedValueOnce(loaded);
  const { result } = renderHook(() => useRowSubmissions("p", "c", "de", true));
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.data).toBeNull();
  await act(async () => { result.current.retry(); });
  await waitFor(() => expect(result.current.data).toBe(loaded));
  expect(result.current.error).toBeNull();
});

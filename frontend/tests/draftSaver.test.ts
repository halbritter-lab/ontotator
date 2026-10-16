import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftSaver } from "../src/translation/draftSaver";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("translation review draft saver", () => {
  it.each(["synchronous", "microtask"])("drains a %s completion observer update before concurrent flush callers settle", async mode => {
    const save = vi.fn(async (_draft: string, revision: number) => revision + 1);
    let updated = false;
    const saver = createDraftSaver<string>({
      save,
      onStateChange(state) {
        if (state !== "saved" || updated) return;
        updated = true;
        if (mode === "microtask") queueMicrotask(() => saver.update("second"));
        else saver.update("second");
      },
    });
    saver.update("first");
    const observed: unknown[] = [];
    await Promise.all([
      saver.flush().then(() => observed.push([save.mock.calls.slice(), saver.hasUnsavedChanges])),
      saver.flush().then(() => observed.push([save.mock.calls.slice(), saver.hasUnsavedChanges])),
    ]);
    expect(observed).toEqual([
      [[["first", 0], ["second", 1]], false],
      [[["first", 0], ["second", 1]], false],
    ]);
    expect([saver.state, saver.revision, saver.hasUnsavedChanges, vi.getTimerCount()]).toEqual(["saved", 2, false, 0]);
  });

  it("never starts a write after disposal from the saving observer", async () => {
    const save = vi.fn(async () => 1);
    const notices: string[] = [];
    const saver = createDraftSaver<string>({
      save,
      onStateChange(state) {
        notices.push(state);
        if (state === "saving") saver.dispose();
      },
    });
    saver.update("draft");
    await expect(saver.flush()).rejects.toThrow("disposed");
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    expect(notices).toEqual(["dirty", "saving"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies observers with consistent unsaved state and confirmed revision", async () => {
    const observed: unknown[] = [];
    const saver = createDraftSaver<string>({
      save: async () => 3,
      onStateChange(state) { observed.push([state, saver.revision, saver.hasUnsavedChanges]); },
    });
    saver.update("draft");
    await saver.flush();
    expect(observed).toEqual([["dirty", 0, true], ["saving", 0, true], ["saved", 3, false]]);
  });
  it("starts saved and debounces the latest immutable nested snapshot for 800ms", async () => {
    const save = vi.fn(async () => 1);
    const saver = createDraftSaver({ save });
    expect([saver.state, saver.revision, saver.error, saver.hasUnsavedChanges]).toEqual(["saved", 0, undefined, false]);
    const draft = { text: "first", form: { categories: ["source"] } };
    saver.update(draft);
    await vi.advanceTimersByTimeAsync(500);
    draft.text = "latest";
    saver.update(draft);
    draft.text = "caller changed"; draft.form.categories.push("value");
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    expect(saver.hasUnsavedChanges).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: "latest", form: { categories: ["source"] } }, 0);
    expect([saver.state, saver.revision, saver.hasUnsavedChanges]).toEqual(["saved", 1, false]);
  });

  it("flushes without waiting for debounce and uses the supplied confirmed revision", async () => {
    const save = vi.fn(async (_draft: string, revision: number) => revision + 1);
    const saver = createDraftSaver({ save, initialRevision: 12, delayMs: 50 });
    saver.update("draft");
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("draft", 12);
    expect(saver.revision).toBe(13);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never overlaps saves and honors the latest update's debounce during a request", async () => {
    const first = deferred<number>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(8);
    const saver = createDraftSaver<string>({ save, initialRevision: 3, delayMs: 100 });
    saver.update("first");
    await vi.advanceTimersByTimeAsync(100);
    saver.update("discarded"); saver.update("latest");
    first.resolve(7);
    await vi.advanceTimersByTimeAsync(99);
    expect(save).toHaveBeenCalledTimes(1);
    expect([saver.state, saver.revision, saver.hasUnsavedChanges]).toEqual(["dirty", 7, true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(save.mock.calls).toEqual([["first", 3], ["latest", 7]]);
    expect([saver.state, saver.revision]).toEqual(["saved", 8]);
  });

  it("drains updates arriving during active flush and shares completion across flush callers", async () => {
    const first = deferred<number>(), second = deferred<number>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const saver = createDraftSaver<string>({ save });
    saver.update("first");
    const a = vi.fn(), b = vi.fn();
    const flushA = saver.flush().then(a), flushB = saver.flush().then(b);
    await vi.advanceTimersByTimeAsync(0);
    saver.update("next"); saver.update("last");
    first.resolve(4);
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls).toEqual([["first", 0], ["last", 4]]);
    expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled();
    expect(saver.state).toBe("saving");
    second.resolve(9);
    await Promise.all([flushA, flushB]);
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce();
    expect([saver.revision, saver.hasUnsavedChanges]).toEqual([9, false]);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("joins an automatic in-flight save and drains a newer draft on flush", async () => {
    const first = deferred<number>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(2);
    const saver = createDraftSaver<string>({ save });
    saver.update("one");
    await vi.advanceTimersByTimeAsync(800);
    saver.update("two");
    const flushed = saver.flush();
    first.resolve(1);
    await flushed;
    expect(save.mock.calls).toEqual([["one", 0], ["two", 1]]);
    expect(saver.hasUnsavedChanges).toBe(false);
  });

  it("retains a failed draft and only retries explicitly with the last confirmed revision", async () => {
    const error = new Error("offline");
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(11);
    const saver = createDraftSaver<string>({ save, initialRevision: 10 });
    saver.update("unsaved");
    await expect(saver.flush()).rejects.toBe(error);
    expect([saver.state, saver.error, saver.revision, saver.hasUnsavedChanges]).toEqual(["error", error, 10, true]);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    await saver.flush();
    expect(save.mock.calls).toEqual([["unsaved", 10], ["unsaved", 10]]);
    expect([saver.state, saver.error, saver.revision, saver.hasUnsavedChanges]).toEqual(["saved", undefined, 11, false]);
  });

  it("preserves newer work after a request fails, without automatic retry on updates", async () => {
    const request = deferred<number>();
    const save = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce(5);
    const saver = createDraftSaver<string>({ save, initialRevision: 4 });
    saver.update("old");
    const failure = new Error("network");
    const failed = expect(saver.flush()).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(0);
    saver.update("new");
    request.reject(failure);
    await failed;
    saver.update("newest");
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.hasUnsavedChanges).toBe(true);
    await saver.flush();
    expect(save.mock.calls).toEqual([["old", 4], ["newest", 4]]);
  });

  it.each([401, 403, 422, 500])("retains HTTP %s errors as explicitly retryable work", async status => {
    const error = Object.assign(new Error("request failed"), { status });
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(1);
    const saver = createDraftSaver<string>({ save });
    saver.update("draft");
    await expect(saver.flush()).rejects.toBe(error);
    expect(saver.state).toBe("error");
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("halts permanently on actual HTTP status 409 while retaining unsaved edits", async () => {
    const conflict = Object.assign(new Error("revision conflict"), { status: 409, code: "REVISION_CONFLICT" });
    const save = vi.fn().mockRejectedValue(conflict);
    const saver = createDraftSaver<string>({ save });
    saver.update("first");
    const a = expect(saver.flush()).rejects.toBe(conflict);
    const b = expect(saver.flush()).rejects.toBe(conflict);
    await Promise.all([a, b]);
    saver.update("keep me");
    await vi.runAllTimersAsync();
    await expect(saver.flush()).rejects.toBe(conflict);
    expect(save).toHaveBeenCalledTimes(1);
    expect([saver.state, saver.error, saver.revision, saver.hasUnsavedChanges]).toEqual(["conflict", conflict, 0, true]);
  });

  it("handles automatic rejection without unhandled promises or retry loops", async () => {
    const failure = new Error("offline");
    const save = vi.fn().mockRejectedValue(failure);
    const onStateChange = vi.fn();
    const saver = createDraftSaver<string>({ save, onStateChange });
    saver.update("draft");
    await vi.runAllTimersAsync();
    expect(onStateChange.mock.calls.map(([state]) => state)).toEqual(["dirty", "saving", "error"]);
    expect([saver.error, saver.hasUnsavedChanges]).toEqual([failure, true]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("disposes pending timers and ignores later updates and notifications", async () => {
    const save = vi.fn(async () => 1), onStateChange = vi.fn();
    const saver = createDraftSaver<string>({ save, onStateChange });
    saver.update("pending"); saver.dispose(); saver.dispose();
    const notices = onStateChange.mock.calls.length;
    saver.update("later");
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledTimes(notices);
    await expect(saver.flush()).rejects.toThrow("disposed");
    expect(saver.hasUnsavedChanges).toBe(true);
  });

  it.each([false, true])("does not reschedule or notify after disposal during an in-flight save (failure=%s)", async fails => {
    const request = deferred<number>(), onStateChange = vi.fn();
    const save = vi.fn().mockReturnValue(request.promise);
    const saver = createDraftSaver<string>({ save, onStateChange });
    saver.update("in flight");
    const flushed = expect(saver.flush()).rejects.toThrow("disposed");
    await vi.advanceTimersByTimeAsync(0);
    saver.update("queued"); saver.dispose();
    const notices = onStateChange.mock.calls.length;
    if (fails) request.reject(new Error("late error")); else request.resolve(1);
    await flushed;
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledTimes(notices);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, ConflictError, ValidationError } from "../src/api/client";
import { createMutationQueue, UnsavedChangesError, type QueueState } from "../src/editor/autosave";

describe("createMutationQueue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("processes mutations sequentially and updates revision on success", async () => {
    const states: QueueState[] = [];
    let currentServerRevision = 0;

    const queue = createMutationQueue({
      initialRevision: currentServerRevision,
      onState: (s) => states.push(s),
    });

    const mockMutation1 = vi.fn().mockImplementation(async (rev: number) => {
      expect(rev).toBe(0);
      currentServerRevision = 1;
      return { revision: 1 };
    });

    const mockMutation2 = vi.fn().mockImplementation(async (rev: number) => {
      expect(rev).toBe(1);
      currentServerRevision = 2;
      return { revision: 2 };
    });

    const p1 = queue.enqueue(mockMutation1);
    const p2 = queue.enqueue(mockMutation2);

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1).toEqual({ revision: 1 });
    expect(res2).toEqual({ revision: 2 });
    expect(queue.getRevision()).toBe(2);
    expect(queue.getState()).toBe("saved");
  });

  it("retains pending mutations and reports error on server 500 without falsely claiming saved", async () => {
    const states: QueueState[] = [];

    const queue = createMutationQueue({
      initialRevision: 1,
      onState: (s) => states.push(s),
    });

    const mockMutationFail = vi.fn().mockRejectedValue(new Error("Server 500 Internal Error"));
    const mockMutation2 = vi.fn().mockResolvedValue({ revision: 2 });

    const p1 = queue.enqueue(mockMutationFail);
    const p2 = queue.enqueue(mockMutation2);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Queue must be in error state, definitely NOT 'saved'!
    expect(queue.getState()).toBe("error");
    expect(queue.getRevision()).toBe(1);
    expect(mockMutation2).not.toHaveBeenCalled();

    // Now if flushed / retried successfully:
    mockMutationFail.mockResolvedValueOnce({ revision: 2 });
    await queue.retry();
    await expect(p1).resolves.toEqual({ revision: 2 });
    const res2 = await p2;
    expect(res2).toEqual({ revision: 2 });
    expect(queue.getState()).toBe("saved");
  });

  it("halts execution and enters conflict state upon 409 ConflictError without blind retry", async () => {
    const states: QueueState[] = [];

    const queue = createMutationQueue({
      initialRevision: 2,
      onState: (s) => states.push(s),
    });

    const conflictError = new ConflictError(
      "Expected revision 2, actual is 3",
      "REVISION_CONFLICT"
    );
    const mockMutationConflict = vi.fn().mockRejectedValue(conflictError);
    const mockMutationFollowup = vi.fn();

    const p1 = queue.enqueue(mockMutationConflict);
    const p2 = queue.enqueue(mockMutationFollowup);

    await expect(p1).rejects.toThrow(ConflictError);

    expect(queue.getState()).toBe("conflict");
    // Followup mutation must NOT have been called blindly
    expect(mockMutationFollowup).not.toHaveBeenCalled();
    expect(queue.getRevision()).toBe(2);
    expect(p2).toBeDefined();
  });

  it.each(["ROUND_INPUT_RESOLUTION_STALE", "ROUND_INPUT_CARRIED_FINDING_PRESENT"])("treats a refused carried-review command (%s) as rejected, not as a stale draft", async (code) => {
    const queue = createMutationQueue({ initialRevision: 2 });
    const refused = queue.enqueue(vi.fn().mockRejectedValue(new ConflictError("Refused", code)));
    await expect(refused).rejects.toThrow(ConflictError);
    expect(queue.getState()).not.toBe("conflict");
    const followup = vi.fn().mockResolvedValue({ revision: 3 });
    await queue.enqueue(followup);
    expect(followup).toHaveBeenCalledOnce();
  });

  it("allows setting confirmed revision externally when resetting or synchronizing", () => {
    const queue = createMutationQueue({
      initialRevision: 5,
      onState: vi.fn(),
    });

    expect(queue.getRevision()).toBe(5);
    queue.setRevision(10);
    expect(queue.getRevision()).toBe(10);
  });

  it("adopts the revision of an in-flight request that succeeds after discardPending", async () => {
    const queue = createMutationQueue({ initialRevision: 4 });
    let release!: (value: { revision: number }) => void;
    const inFlight = queue.enqueue(
      (rev) => new Promise<{ revision: number }>((resolve) => {
        expect(rev).toBe(4);
        release = resolve;
      }),
    );
    inFlight.catch(() => undefined);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(queue.discardPending()).toBe(1);
    await expect(inFlight).rejects.toThrow(/discarded/i);
    // The server applied the discarded mutation anyway.
    release({ revision: 5 });
    const seen: number[] = [];
    await queue.enqueue(async (rev) => { seen.push(rev); return { revision: rev + 1 }; });
    expect(seen).toEqual([5]);
    expect(queue.getRevision()).toBe(6);
  });

  it("never moves the revision backwards for a late discarded response", async () => {
    const queue = createMutationQueue({ initialRevision: 1 });
    let release!: (value: { revision: number }) => void;
    const inFlight = queue.enqueue(
      () => new Promise<{ revision: number }>((resolve) => { release = resolve; }),
    );
    inFlight.catch(() => undefined);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    queue.discardPending(9); // reload already fetched a newer server revision
    release({ revision: 2 });
    await queue.flush();
    expect(queue.getRevision()).toBe(9);
  });

  it("counts the operations the server rejected, so a caller can tell that a flush lost edits", async () => {
    const queue = createMutationQueue({ initialRevision: 0 });
    expect(queue.rejectedCount()).toBe(0);
    await queue.enqueue(async () => ({ revision: 1 }));
    const refused = queue.enqueue(async () => { throw new ValidationError("invalid term"); });
    refused.catch(() => undefined);
    await queue.flush();
    expect(queue.rejectedCount()).toBe(1);
  });

  it.each([
    ["an ended session (401)", () => new AuthError("Log in to continue.", undefined, "NOT_AUTHENTICATED", 401)],
    ["a stale CSRF token (403 CSRF_FAILED)", () => new AuthError("The page is out of date; reload it.", undefined, "CSRF_FAILED")],
  ])("keeps the operation and every later one on %s until a retry", async (_name, refusal) => {
    const queue = createMutationQueue({ initialRevision: 0 });
    const first = vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValue({ revision: 1 });
    const second = vi.fn().mockResolvedValue({ revision: 2 });
    const done1 = queue.enqueue(first);
    const done2 = queue.enqueue(second);
    await vi.waitFor(() => expect(queue.getState()).toBe("error"));
    expect(queue.pendingCount()).toBe(2);
    expect(queue.rejectedCount()).toBe(0);
    expect(second).not.toHaveBeenCalled();
    const flushed = await queue.flush().catch((e) => e);
    expect(flushed).toBeInstanceOf(UnsavedChangesError);
    expect(flushed.message).toMatch(/session has ended; your changes are kept/);

    await queue.retry();
    await expect(done1).resolves.toEqual({ revision: 1 });
    await expect(done2).resolves.toEqual({ revision: 2 });
    expect(queue.getState()).toBe("saved");
    expect(queue.rejectedCount()).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../src/api/client";
import { createMutationQueue, type QueueState } from "../src/editor/autosave";

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
});

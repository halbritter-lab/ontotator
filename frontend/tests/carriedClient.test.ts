import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, type MutationEnvelope } from "../src/api/client";

describe("ApiClient carried review methods", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the clear-resolution envelope to the workspace endpoint with CSRF", async () => {
    const draft = { workspace_id: "ws", revision: 4 };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => draft });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient();
    client.setCsrfToken("csrf-clear");
    const envelope = { client_mutation_id: "m-1", expected_revision: 3, payload: { input_id: "in-1" } } as unknown as MutationEnvelope;
    expect(await client.clearRoundInputResolution("ws", envelope)).toEqual(draft);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/workspaces/ws/round-input-resolutions/clear");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(envelope);
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-clear");
  });

  it("lists own submissions of an assignment", async () => {
    const submissions = [{ submission_id: "s-1", round_ordinal: 1 }];
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => submissions });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient();
    expect(await client.listAssignmentSubmissions(7)).toEqual(submissions);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/assignments/7/submissions");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

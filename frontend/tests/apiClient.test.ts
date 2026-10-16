import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  AuthError,
  ConflictError,
  ValidationError,
  onSessionExpired,
} from "../src/api/client";

describe("ApiClient and session management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("lists tasks and opens assignments through documented endpoints with CSRF on writes", async () => {
    const tasks = [{ assignment_id: 7 }];
    const workspace = { workspace_id: "ws-7", view: {}, assignment: { id: 7 }, read_only: true };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => tasks })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => workspace });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient();
    client.setCsrfToken("csrf-test");
    expect(await client.listMyTasks()).toEqual(tasks);
    expect(await client.openAssignment(7)).toEqual(workspace);
    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/api/v1/me/tasks", "GET", undefined],
      ["/api/v1/assignments/7/open", "POST", undefined],
    ]);
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).has("X-CSRF-Token")).toBe(false);
    expect(new Headers(fetchSpy.mock.calls[1][1].headers).get("X-CSRF-Token")).toBe("csrf-test");
    expect(fetchSpy.mock.calls.every(([, init]) => init.credentials === "same-origin")).toBe(true);
  });

  it.each(["list", "open"])("preserves existing session-expiry signaling for task %s requests", async (method) => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "NOT_AUTHENTICATED", details: "Please log in" }) });
    const listener = vi.fn();
    const stop = onSessionExpired(listener);
    const client = new ApiClient();
    try {
      await expect(method === "list" ? client.listMyTasks() : client.openAssignment(7)).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it("posts an explicit review round only when requested for the owned assignment", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workspace_id: "ws" }) });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient();
    client.setCsrfToken("csrf-round");
    await client.openAssignment(17, { review_round_target_set_id: "round-b" });
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/assignments/17/open");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ review_round_target_set_id: "round-b" });
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("X-CSRF-Token")).toBe("csrf-round");
  });

  it("posts tree requests to the tree endpoints", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    globalThis.fetch = fetchSpy;
    const client = new ApiClient();
    const workspace_key = {
      project_key: "pkg",
      document_id: "doc",
      annotator_id: "dr-a",
      mode: "independent" as const,
      scope_id: "scope-default",
      target_set_id: "empty",
    };

    await client.openTree({ workspace_key, annotation_id: "a", layer_id: "l", term_id: "HP:1" });
    await client.loadTreeNode({ workspace_key, annotation_id: "a", layer_id: "l", browse_id: "w", term_id: "HP:2", expand: true });

    expect(fetchSpy.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/terms/tree/open", "POST"],
      ["/api/v1/terms/tree/node", "POST"],
    ]);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ workspace_key, annotation_id: "a", layer_id: "l", term_id: "HP:1" });
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toMatchObject({ browse_id: "w", term_id: "HP:2", expand: true });
  });

  it("maps 409 Conflict to ConflictError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        code: "REVISION_CONFLICT",
        details: "Expected revision 2, current is 3",
      }),
    });

    const client = new ApiClient();
    await expect(
      client.applyCommand("ws-1", {
        mutation_id: "m-1",
        expected_revision: 2,
        payload: { type: "delete_draft_annotation", annotation_id: "a-1" },
      })
    ).rejects.toThrow(ConflictError);
  });

  it("maps 422 DomainError to ValidationError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        code: "INCOMPLETE_REVIEW",
        details: "Missing decision for target X",
      }),
    });

    const client = new ApiClient();
    await expect(
      client.submitWorkspace("ws-1", {
        mutation_id: "m-2",
        expected_revision: 3,
        payload: { type: "submit_workspace", document_checked: true },
      })
    ).rejects.toThrow(ValidationError);
  });

  it("maps 403 Forbidden to AuthError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        detail: "Forbidden: Missing Bearer authorization token",
      }),
    });

    const client = new ApiClient();
    await expect(client.listProjects()).rejects.toThrow(AuthError);
  });
});

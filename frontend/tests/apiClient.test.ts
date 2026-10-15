import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClient,
  AuthError,
  ConflictError,
  ValidationError,
} from "../src/api/client";

describe("ApiClient and session management", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.location.hash = "";
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

import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
import { proposal } from "./assignmentFixtures";
afterEach(() => { vi.unstubAllGlobals(); });
it("uses exact assignment endpoints, flags, context and shared CSRF transport", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }); vi.stubGlobal("fetch", fetch); const client = new ApiClient(); client.setCsrfToken("token");
  await client.listAssignments("p/key"); const body = { rows: [{ document_id: "z/doc", username: "alice" }], task: "annotate" as const, seed: 123, context: proposal.context, confirm_language: true };
  await client.createAssignments("p/key", body); await client.proposeDistribution("p/key", { document_ids: ["z/doc"], task: "annotate", per_document: 2 }); await client.reassign(3, { username: "bob", confirm_started: true, confirm_language: false }); await client.reopenAssignment(3, "Correction"); await client.revokeAssignment(3);
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([["/api/v1/projects/p%2Fkey/assignments", "GET"], ["/api/v1/projects/p%2Fkey/assignments", "POST"], ["/api/v1/projects/p%2Fkey/assignments/proposal", "POST"], ["/api/v1/assignments/3/reassign", "POST"], ["/api/v1/assignments/3/reopen", "POST"], ["/api/v1/assignments/3/revoke", "POST"]]);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body); expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ username: "bob", confirm_started: true, confirm_language: false }); expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ reason: "Correction" }); expect(JSON.parse(fetch.mock.calls[5][1].body)).toEqual({});
  for (const [, init] of fetch.mock.calls) { expect(init.credentials).toBe("same-origin"); expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(init.method === "GET" ? null : "token"); }
});

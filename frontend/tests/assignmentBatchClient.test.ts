import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, type BatchAssignBody, type BatchAssignRequest } from "../src/api/client";

afterEach(() => { vi.unstubAllGlobals(); });

it("posts batch preview, commit and selection summary to the project paths", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient();
  client.setCsrfToken("token");
  const request: BatchAssignRequest = { task: "translation_review", language: "de", case_ids: ["case-0102", "case-0101"], sort: "import", filters: { plan: "review" }, mode: "split", usernames: ["ana", "ben"] };
  const body: BatchAssignBody = { ...request, expected_preview_digest: "abc", confirm_language: true };
  await client.previewAssignmentBatch("p/key", request);
  await client.commitAssignmentBatch("p/key", body);
  await client.selectionSummary("p/key", ["case-0101"]);
  await client.selectionSummary("p/key", ["case-0101"], { language: "de" });
  expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ["/api/v1/projects/p%2Fkey/assignments/batch/preview", "POST"],
    ["/api/v1/projects/p%2Fkey/assignments/batch", "POST"],
    ["/api/v1/projects/p%2Fkey/document-rows/selection-summary", "POST"],
    ["/api/v1/projects/p%2Fkey/document-rows/selection-summary", "POST"],
  ]);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(request);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(body);
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ case_ids: ["case-0101"] });
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ case_ids: ["case-0101"], filters: { language: "de" } });
  for (const [, init] of fetch.mock.calls) expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("token");
});

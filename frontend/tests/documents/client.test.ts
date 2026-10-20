import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/client";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(body: unknown) {
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = fetchSpy;
  return fetchSpy;
}

it("serialises document-row filters, omits empty ones and repeats retain", async () => {
  const fetchSpy = stubFetch({ groups: [], page: 1, page_count: 1, group_count: 0, bar: {}, case_found: true, adjudicator_not_annotator: false });
  const client = new ApiClient();
  await client.listDocumentRows("p 1", { decision: "confirm-final", language: "de", page: 2, q: undefined });
  const first = String(fetchSpy.mock.calls[0][0]);
  expect(first).toContain("/api/v1/projects/p%201/document-rows?");
  expect(first).toContain("decision=confirm-final");
  expect(first).toContain("language=de");
  expect(first).toContain("page=2");
  expect(first).not.toContain("q=");
  expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
  await client.listDocumentRows("p", { decision: "all", retain: ["c:1:de", "c2:en"] });
  expect(String(fetchSpy.mock.calls[1][0])).toContain("retain=c%3A1%3Ade&retain=c2%3Aen");
  await client.listDocumentRows("p");
  expect(String(fetchSpy.mock.calls[2][0])).toBe("/api/v1/projects/p/document-rows");
});

it("encodes the case path of a row's submissions", async () => {
  const fetchSpy = stubFetch({ case_id: "case/1 #é", language: "de", adjudicator_not_annotator: false, submissions: [], rounds: [], open_translation_reviews: [] });
  await new ApiClient().getRowSubmissions("p", "case/1 #é", "de");
  expect(String(fetchSpy.mock.calls[0][0])).toBe(`/api/v1/projects/p/document-rows/${encodeURIComponent("case/1 #é")}/de/submissions`);
});

it("serialises segment, plan, sort and owner filters", async () => {
  const fetchSpy = stubFetch({ groups: [], page: 1, page_count: 1, group_count: 0, bar: {}, case_found: true, adjudicator_not_annotator: false });
  await new ApiClient().listDocumentRows("p", { segment: "assign", plan: "not_in_plan", sort: "activity", owner: "me", step: "choose_final", stage: "final", final: "none" });
  const url = String(fetchSpy.mock.calls[0][0]);
  for (const part of ["segment=assign", "plan=not_in_plan", "sort=activity", "owner=me", "step=choose_final", "stage=final", "final=none"]) expect(url).toContain(part);
});

it("requests filtered case ids", async () => {
  const body = { case_ids: ["c1", "c2"], total: 2, truncated: false };
  const fetchSpy = stubFetch(body);
  const result = await new ApiClient().listDocumentCaseIds("p 1", { segment: "decision", language: "de", q: undefined });
  const url = String(fetchSpy.mock.calls[0][0]);
  expect(url).toContain("/api/v1/projects/p%201/document-rows/case-ids?");
  expect(url).toContain("segment=decision");
  expect(url).toContain("language=de");
  expect(url).not.toContain("q=");
  expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
  expect(result).toEqual(body);
  await new ApiClient().listDocumentCaseIds("p");
  expect(String(fetchSpy.mock.calls[1][0])).toBe("/api/v1/projects/p/document-rows/case-ids");
});

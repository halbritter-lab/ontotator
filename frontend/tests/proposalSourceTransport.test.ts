import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";
afterEach(() => vi.unstubAllGlobals());

it("GETs the exact project-scoped set endpoint with credentials and cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => ({id: 7})});
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient();
  const controller = new AbortController();
  expect(await client.getProposalSet("project /β", 7, controller.signal)).toEqual({id: 7});
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/v1/projects/project%20%2F%CE%B2/proposal-sets/7");
  expect(options.method).toBe("GET");
  expect(options.credentials).toBe("same-origin");
  expect(options.signal).toBe(controller.signal);
});

it("preserves metadata 404 as an ApiError for the workspace loader", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, status: 404, json: async () => ({code: "PROPOSAL_SET_NOT_FOUND"})}));
  await expect(new ApiClient().getProposalSet("p", 99)).rejects.toMatchObject({status: 404, code: "PROPOSAL_SET_NOT_FOUND"});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";

function transport(value: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient({ baseUrl: "https://same.example" });
  return { client, fetch };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("problem report read endpoints", () => {
  it("gets one report with an encoded id", async () => {
    const { client, fetch } = transport({});
    await client.getProblemReport("r/1");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://same.example/api/v1/problem-reports/r%2F1");
    expect(init?.method).toBe("GET");
  });

  it("lists the reports of one task", async () => {
    const { client, fetch } = transport([]);
    await client.listTaskProblemReports("p/key", 4);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://same.example/api/v1/projects/p%2Fkey/problem-reports?assignment_id=4");
    expect(init?.method).toBe("GET");
  });

  it("lists pause candidates of a report", async () => {
    const { client, fetch } = transport([]);
    await client.listPauseCandidates("r 1");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://same.example/api/v1/problem-reports/r%201/pause-candidates");
    expect(init?.method).toBe("GET");
  });
});

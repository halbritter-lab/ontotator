// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/api/client";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ok = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });

describe("guideline client", () => {
  it("lists, reads, withdraws and records reads", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(ok({ current: null, latest_version: null, versions: [], my_latest_seen: null }))
      .mockResolvedValueOnce(ok({ version: 2, body: "# Rules" }))
      .mockResolvedValueOnce(ok({ version: 2, withdrawn: { reason: "Wrong" } }))
      .mockResolvedValueOnce(ok(undefined, 204));
    vi.stubGlobal("fetch", fetch);
    const client = new ApiClient(); client.setCsrfToken("token");
    expect((await client.listGuidelines("p/key")).versions).toEqual([]);
    expect((await client.getGuideline("p/key", 2)).body).toBe("# Rules");
    await client.withdrawGuideline("p/key", 2, { reason: "Wrong", expected_latest_version: 2 });
    expect(await client.recordGuidelineRead("p/key", 2, "opened")).toBeUndefined();
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/projects/p%2Fkey/guidelines", "GET"],
      ["/api/v1/projects/p%2Fkey/guidelines/2", "GET"],
      ["/api/v1/projects/p%2Fkey/guidelines/2/withdraw", "POST"],
      ["/api/v1/projects/p%2Fkey/guidelines/2/reads", "POST"],
    ]);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ reason: "Wrong", expected_latest_version: 2 });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ event: "opened" });
    for (const [, init] of fetch.mock.calls) expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(init.method === "GET" ? null : "token");
  });

  it("publishes as multipart with an empty expected version for the first upload", async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ version: 1 }, 201));
    vi.stubGlobal("fetch", fetch);
    const client = new ApiClient(); client.setCsrfToken("token");
    const file = new File(["# Rules"], "rules.md", { type: "text/markdown" });
    await client.publishGuideline("p/key", { file, changeNote: "", expectedLatestVersion: null });
    await client.publishGuideline("p/key", { file, changeNote: "Clearer", expectedLatestVersion: 3 });
    const [[url, first], [, second]] = fetch.mock.calls;
    expect(url).toBe("/api/v1/projects/p%2Fkey/guidelines");
    expect(first.method).toBe("POST");
    expect(first.body).toBeInstanceOf(FormData);
    expect(new Headers(first.headers).has("Content-Type")).toBe(false);
    expect((first.body as FormData).get("file")).toBeInstanceOf(File);
    expect(((first.body as FormData).get("file") as File).name).toBe("rules.md");
    expect((first.body as FormData).get("expected_latest_version")).toBe("");
    expect((first.body as FormData).get("change_note")).toBe("");
    expect((second.body as FormData).get("expected_latest_version")).toBe("3");
    expect((second.body as FormData).get("change_note")).toBe("Clearer");
  });
});

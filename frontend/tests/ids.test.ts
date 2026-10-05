import { afterEach, describe, expect, it, vi } from "vitest";
import { newEvidenceId, randomId } from "../src/editor/ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("client ids", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("evidence ids are unique even within the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const ids = new Set(Array.from({ length: 200 }, () => newEvidenceId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^ev-/);
    vi.restoreAllMocks();
  });

  it("falls back to a v4 uuid when crypto.randomUUID is unavailable", () => {
    const getRandomValues = (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 11) & 0xff;
      return arr;
    };
    vi.stubGlobal("crypto", { getRandomValues });
    expect(randomId()).toMatch(UUID);
    vi.stubGlobal("crypto", undefined);
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});

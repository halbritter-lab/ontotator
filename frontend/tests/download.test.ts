import { afterEach, expect, it, vi } from "vitest";
import { attachmentFilename, saveDownload } from "../src/api/download";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it.each([
  ["attachment; filename=\"fallback.zip\"; filename*=UTF-8''r%C3%A9sultats.zip", "résultats.zip"],
  ["attachment; filename=\"quoted name.jsonl\"", "quoted name.jsonl"],
  ["attachment; filename*=UTF-8''broken%ZZ; filename=\"safe.zip\"", "safe.zip"],
  ["attachment; filename=\"../../secret\r\n.zip\"", "secret.zip"],
  ["attachment; filename=\"C:\\folder\\report.zip\"", "report.zip"],
  ["attachment; filename=\"..\"", null], [null, null],
])("parses and sanitizes attachment filename %s", (header, expected) => expect(attachmentFilename(header)).toBe(expected));
it.each([false, true])("saves actual blob and always removes/revokes the object URL (click throws: %s)", (fails) => {
  const create = vi.fn(() => "blob:owned"); const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("fallback.jsonl"); expect(this.href).toBe("blob:owned"); expect(this.isConnected).toBe(true);
    if (fails) throw new Error("Download interrupted");
  });
  const blob = new Blob(["{}\n"], { type: "application/x-ndjson" });
  const save = () => saveDownload({ blob, filename: null }, "../fallback.jsonl");
  if (fails) expect(save).toThrow("Download interrupted"); else save();
  expect(click).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledWith(blob); expect(revoke).toHaveBeenCalledWith("blob:owned");
  expect(document.querySelector("a")).toBeNull();
});

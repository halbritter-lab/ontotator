import { afterEach, describe, expect, it, vi } from "vitest";
import { mountSpanEditor } from "../src/spans/adapter";

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  document.body.innerHTML = "";
});

describe("scrollToEvidence", () => {
  it("centres the mark of the evidence and ignores unknown ids", () => {
    const calls: Array<{ element: Element; options: unknown }> = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true, writable: true,
      value: function (this: Element, options: unknown) { calls.push({ element: this, options }); },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = mountSpanEditor(container, "Patient had a seizure and fever.", [
      { evidence_id: "ev-seizure", segments: [{ start: 14, end: 21 }] },
      { evidence_id: "ev-fever", segments: [{ start: 26, end: 31 }] },
    ], vi.fn(), vi.fn());

    handle.scrollToEvidence("ev-fever");
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toEqual({ block: "center" });
    expect(calls[0].element.textContent).toBe("fever");

    handle.scrollToEvidence("unknown");
    expect(calls).toHaveLength(1);
    handle.destroy();
  });
});

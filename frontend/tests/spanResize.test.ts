import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSpanEditor, type MentionDisplay } from "../src/spans/adapter";

const TEXT = "severe muscular hypotonia";
const MENTIONS: MentionDisplay[] = [
  { evidence_id: "ev-a", segments: [{ start: 7, end: 15 }], kind: "own" },
  { evidence_id: "ev-b", segments: [{ start: 0, end: 6 }, { start: 16, end: 25 }], kind: "own" },
];

describe("span editor resize handles", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  const mount = (onResize = vi.fn(), onSelection = vi.fn()) =>
    ({ handle: mountSpanEditor(container, TEXT, MENTIONS, onSelection, vi.fn(), undefined, onResize), onResize, onSelection });

  const handles = () => Array.from(container.querySelectorAll<HTMLElement>(".resize-handle"));
  const describeHandle = (el: HTMLElement) =>
    `${el.dataset.mention}:${el.dataset.segment}:${el.dataset.edge}@${el.dataset.offset}`;

  it("renders no handles until mentions are made resizable", () => {
    const { handle } = mount();
    expect(handles()).toEqual([]);
    handle.setResizable(["ev-a"]);
    expect(handles().map(describeHandle)).toEqual(["ev-a:0:start@7", "ev-a:0:end@15"]);
    handle.setResizable([]);
    expect(handles()).toEqual([]);
  });

  it("renders a pair of handles per segment of a discontinuous mention", () => {
    const { handle } = mount();
    handle.setResizable(["ev-b"]);
    expect(handles().map(describeHandle)).toEqual([
      "ev-b:0:start@0", "ev-b:0:end@6", "ev-b:1:start@16", "ev-b:1:end@25",
    ]);
  });

  it("keeps the text content and the handles' accessibility attributes intact", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    expect(container.textContent).toBe(TEXT);
    const [start, end] = handles();
    expect(start.getAttribute("role")).toBe("separator");
    expect(start.getAttribute("aria-label")).toBe("Start of mention");
    expect(end.getAttribute("aria-label")).toBe("End of mention");
    expect(start.tabIndex).toBe(0);
  });

  it("keeps handles after the mentions are updated", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 0, end: 15 }], kind: "own" }]);
    expect(handles().map(describeHandle)).toEqual(["ev-a:0:start@0", "ev-a:0:end@15"]);
  });

  it("reports the same selection offsets with handles present", () => {
    const { handle, onSelection } = mount();
    handle.setResizable(["ev-a"]);
    // Select "muscular" (7..15): it starts and ends right next to the handles.
    const run = Array.from(container.querySelectorAll<HTMLElement>(".run")).find((r) => r.textContent === "muscular")!;
    const range = document.createRange();
    range.setStart(run.firstChild!, 0);
    range.setEnd(run.firstChild!, 8);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ segments: [{ start: 7, end: 15 }] }));
  });

  it("resolves a selection boundary that lands on a handle to the handle's offset", () => {
    const { handle, onSelection } = mount();
    handle.setResizable(["ev-a"]);
    const [start, end] = handles();
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, 0);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ segments: [{ start: 7, end: 15 }] }));
  });
});

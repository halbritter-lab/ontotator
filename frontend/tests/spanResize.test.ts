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
    // The value names the segment the handle edges (#48 N-24).
    expect(start.getAttribute("aria-valuetext")).toBe("“muscular”");
    expect(start.classList.contains("resize-handle--short")).toBe(false);
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

  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const focused = () => document.activeElement as HTMLElement;

  it("setResizable labels name the handles", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a", "ev-b"], { "ev-a": { start: "Start of marked text", end: "End of marked text" } });
    const named = handles().map((el) => `${el.dataset.mention}:${el.getAttribute("aria-label")}`);
    expect(named).toEqual([
      "ev-b:Start of mention",
      "ev-b:End of mention",
      "ev-a:Start of marked text",
      "ev-a:End of marked text",
      "ev-b:Start of mention",
      "ev-b:End of mention",
    ]);
    // Tooltips follow the label.
    const titles = handles().map((el) => `${el.dataset.mention}:${el.title}`);
    expect(titles[2]).toBe("ev-a:Drag to move the start of the marked text (or focus it and use the arrow keys)");
    expect(titles[3]).toBe("ev-a:Drag to move the end of the marked text (or focus it and use the arrow keys)");
    expect(titles[0]).toBe("ev-b:Drag to move the start of this mention (or focus it and use the arrow keys)");
    // Labels apply only while given.
    handle.setResizable(["ev-a"]);
    expect(handles().map((el) => el.getAttribute("aria-label"))).toEqual(["Start of mention", "End of mention"]);
  });

  it("flushResize reports a waiting keyboard step at once", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus(); // end of "muscular" at 15
    press(focused(), "ArrowLeft");
    expect(onResize).not.toHaveBeenCalled();
    handle.flushResize();
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
    vi.advanceTimersByTime(1000);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("moves the focused edge with the arrow keys and reports once after a pause", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus(); // end of "muscular" at 15

    press(focused(), "ArrowLeft");
    press(focused(), "ArrowLeft");
    expect(describeHandle(focused())).toBe("ev-a:0:end@13");
    expect(onResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(onResize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 13 }]);
  });

  it("jumps to the next word boundary with Ctrl", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[0].focus(); // start of "muscular" at 7
    // The boundary at 6 is only the space before "muscular": skip it and take in "severe".
    press(focused(), "ArrowLeft", { ctrlKey: true });
    expect(describeHandle(focused())).toBe("ev-a:0:start@0");
    press(focused(), "ArrowLeft", { ctrlKey: true }); // already at the start of the text
    expect(describeHandle(focused())).toBe("ev-a:0:start@0");
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenLastCalledWith("ev-a", [{ start: 0, end: 15 }]);

    handles()[1].focus();
    press(focused(), "ArrowRight", { ctrlKey: true }); // across the space to the end of "hypotonia"
    expect(describeHandle(focused())).toBe("ev-a:0:end@25");
    press(focused(), "ArrowLeft", { ctrlKey: true }); // back to the end of "muscular"
    expect(describeHandle(focused())).toBe("ev-a:0:end@15");
    press(focused(), "ArrowLeft", { ctrlKey: true }); // drops "muscular": the mention is "severe" (0..6)
    expect(describeHandle(focused())).toBe("ev-a:0:end@6");
    press(focused(), "ArrowLeft", { ctrlKey: true }); // the next word step would cross the start: nothing happens
    expect(describeHandle(focused())).toBe("ev-a:0:end@6");
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenLastCalledWith("ev-a", [{ start: 0, end: 6 }]);
  });

  it("crosses whitespace with a plain arrow key instead of getting stuck on it", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[0].focus(); // start of "muscular" at 7, a space before it
    press(focused(), "ArrowLeft");
    expect(describeHandle(focused())).toBe("ev-a:0:start@5"); // "e muscular"
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenLastCalledWith("ev-a", [{ start: 5, end: 15 }]);
  });

  it("reports immediately when focus leaves the handle", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft");
    focused().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("does not let arrow keys on a handle reach global shortcuts", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      handles()[1].focus();
      press(focused(), "ArrowLeft");
      expect(seen).not.toHaveBeenCalled();
      press(focused(), "a");
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", seen);
    }
  });

  const pointer = (type: string, target: EventTarget, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...init });
    Object.defineProperty(event, "pointerId", { value: 1 });
    target.dispatchEvent(event);
    return event;
  };
  /** Make the editor resolve every pointer position to `offset`. */
  const pointAt = (offset: number | null) => {
    (document as any).caretPositionFromPoint = () => {
      if (offset === null) return null;
      const runs = Array.from(container.querySelectorAll<HTMLElement>(".run"));
      const run = runs.find((r) => Number(r.dataset.start) <= offset
        && offset <= Number(r.dataset.start) + r.textContent!.length)!;
      return { offsetNode: run.firstChild, offset: offset - Number(run.dataset.start) };
    };
  };
  const markedText = () => Array.from(container.querySelectorAll(".run--marked")).map((r) => r.textContent).join("|");

  it("previews a drag and reports it on release", () => {
    const { handle, onResize, onSelection } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();

    const down = pointer("pointerdown", handles()[1]);
    expect(down.defaultPrevented).toBe(true);
    expect(container.classList.contains("resizing")).toBe(true);

    pointAt(25);
    pointer("pointermove", container);
    expect(markedText()).toBe("muscular hypotonia");
    expect(onResize).not.toHaveBeenCalled();

    pointAt(null); // pointer outside the text: keep the last valid edge
    pointer("pointermove", container);
    expect(markedText()).toBe("muscular hypotonia");

    pointer("pointerup", container);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 25 }]);
    expect(container.classList.contains("resizing")).toBe(false);
    expect(markedText()).toBe("muscular hypotonia");
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("restores the original span on Escape and reports nothing", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      pointer("pointerdown", handles()[0]);
      pointAt(0);
      pointer("pointermove", container);
      expect(markedText()).toBe("severe muscular");
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(markedText()).toBe("muscular");
      expect(outer).not.toHaveBeenCalled();
      pointer("pointerup", container);
      expect(onResize).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("reports nothing when the edge ends where it started", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    pointAt(15);
    pointer("pointermove", container);
    pointer("pointerup", container);
    expect(onResize).not.toHaveBeenCalled();
    expect(markedText()).toBe("muscular");
  });

  it("cancels a drag when the mentions are replaced from outside", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 0, end: 6 }], kind: "own" }]);
    expect(markedText()).toBe("severe");
    pointer("pointerup", container);
    expect(onResize).not.toHaveBeenCalled();
  });


  it("does not pick the mention under the pointer with the click that ends a drag", () => {
    const onPick = vi.fn();
    const handle = mountSpanEditor(container, TEXT, [MENTIONS[0]], vi.fn(), onPick, undefined, vi.fn());
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    pointer("pointerup", container);
    const run = container.querySelector<HTMLElement>(".run--marked")!;
    run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
    // An ordinary click afterwards picks as before.
    run.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });



  it("reports a pending keyboard change before any other key on the handle reaches global shortcuts", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft");
    const order: string[] = [];
    onResize.mockImplementation(() => { order.push("resize"); });
    const shortcut = () => { order.push("shortcut"); };
    window.addEventListener("keydown", shortcut);
    try {
      press(focused(), "Control"); // a modifier on its way to Ctrl+Arrow is not "another key"
      expect(order).toEqual(["shortcut"]);
      press(focused(), "j");
      expect(order).toEqual(["shortcut", "resize", "shortcut"]);
      expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
    } finally {
      window.removeEventListener("keydown", shortcut);
    }
  });



  it("keeps keyboard focus on a handle when the text is redrawn from outside", () => {
    const { handle } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    // The saved state comes back from the server: same edge, new element.
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 7, end: 13 }], kind: "own" }]);
    expect(describeHandle(focused())).toBe("ev-a:0:end@13");
    handle.setSelected("ev-a");
    handle.setResizable(["ev-a"]);
    expect(describeHandle(focused())).toBe("ev-a:0:end@13");
    // The handles go away: focus is not moved to anything else in the text.
    handle.setResizable([]);
    expect(container.contains(document.activeElement)).toBe(false);
  });

  it("frames a highlighted segment once, even when an overlapping mention splits its runs", () => {
    const { handle } = mount();
    handle.setMentions([
      { evidence_id: "ev-long", segments: [{ start: 0, end: 15 }], kind: "own" },
      { evidence_id: "ev-inner", segments: [{ start: 7, end: 25 }], kind: "own" },
    ]);
    handle.setSelected("ev-long");
    const hot = Array.from(container.querySelectorAll<HTMLElement>(".run--hot"));
    expect(hot.map((r) => r.textContent)).toEqual(["severe ", "muscular"]);
    expect(hot.map((r) => [r.classList.contains("run--hot-start"), r.classList.contains("run--hot-end")]))
      .toEqual([[true, false], [false, true]]);
    handle.setSelected(null);
    expect(container.querySelectorAll(".run--hot, .run--hot-start, .run--hot-end").length).toBe(0);
  });

  it("leaves keyboard focus on the dropped edge after a drag", () => {
    const { handle } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    pointer("pointerup", container);
    expect(describeHandle(focused())).toBe("ev-a:0:end@25");
  });

  it("keeps a keyboard step that is still pending when an earlier save comes back", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft"); // 7..14, not reported yet
    // The save of an earlier step returns with the previously saved span.
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 7, end: 15 }], kind: "own" }]);
    expect(markedText()).toBe("muscula");
    expect(describeHandle(focused())).toBe("ev-a:0:end@14");
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
  });

  it("stops a keyboard step at a neighbouring segment instead of merging into it", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[1]]); // "severe" 0..6 and "hypotonia" 16..25
    handle.setResizable(["ev-b"]);
    handles()[1].focus(); // end of "severe"
    for (let i = 0; i < 12; i += 1) press(focused(), "ArrowRight");
    // "severe muscular" (0..15); the next step would cross the space into "hypotonia".
    expect(describeHandle(focused())).toBe("ev-b:0:end@15");
    expect(handles().length).toBe(4);
    press(focused(), "ArrowRight", { ctrlKey: true });
    expect(describeHandle(focused())).toBe("ev-b:0:end@15");
    vi.advanceTimersByTime(400);
    expect(onResize).toHaveBeenLastCalledWith("ev-b", [{ start: 0, end: 15 }, { start: 16, end: 25 }]);
  });

  it("takes back an unsaved keyboard change on Escape and keeps Escape to itself", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      handles()[1].focus();
      press(focused(), "ArrowLeft");
      press(focused(), "ArrowLeft");
      expect(markedText()).toBe("muscul");
      press(focused(), "Escape");
      expect(markedText()).toBe("muscular");
      expect(describeHandle(focused())).toBe("ev-a:0:end@15");
      expect(outer).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(onResize).not.toHaveBeenCalled();
      // With nothing pending, Escape is the application's again.
      press(focused(), "Escape");
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("drops a pending keyboard step when the save before it moved the annotation to copied evidence", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]); // "ev-a" 7..15, shared with another annotation
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft");
    vi.advanceTimersByTime(400); // first step reported: 7..14
    expect(onResize).toHaveBeenCalledTimes(1);
    press(focused(), "ArrowLeft"); // second step pending: 7..13
    // The save copied the evidence: the selected annotation now owns "ev-a-cow-1"
    // (7..14); "ev-a" still belongs to the other annotation, unchanged at 7..15.
    handle.setMentions([
      { evidence_id: "ev-a", segments: [{ start: 7, end: 15 }], kind: "own" },
      { evidence_id: "ev-a-cow-1", segments: [{ start: 7, end: 14 }], kind: "own" },
    ]);
    handle.setResizable(["ev-a-cow-1"]);
    vi.advanceTimersByTime(400);
    // The second step is not reported against the other annotation's mention ...
    expect(onResize).toHaveBeenCalledTimes(1);
    // ... and that mention is shown as saved.
    expect(handles().map(describeHandle)).toEqual(["ev-a-cow-1:0:start@7", "ev-a-cow-1:0:end@14"]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".run--marked")).map((r) => r.textContent).join(""))
      .toBe("muscular");
  });

  it("reports a pending keyboard change at once when the selection moves on", () => {
    vi.useFakeTimers();
    const { handle, onResize } = mount();
    handle.setResizable(["ev-a"]);
    handles()[1].focus();
    press(focused(), "ArrowLeft");
    handle.setResizable(["ev-b"]);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 14 }]);
  });

  it("lets a drag survive the echo of an earlier save but not a real outside change", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    handle.setMentions([{ evidence_id: "ev-a", segments: [{ start: 7, end: 15 }], kind: "own" }]);
    expect(markedText()).toBe("muscular hypotonia");
    pointer("pointerup", container);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 25 }]);
  });

  it("ignores other pointers while a drag is running", () => {
    const { handle, onResize } = mount();
    handle.setMentions([MENTIONS[0]]);
    handle.setResizable(["ev-a"]);
    container.setPointerCapture = vi.fn();
    container.releasePointerCapture = vi.fn();
    const other = (type: string, target: EventTarget) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerId", { value: 2 });
      target.dispatchEvent(event);
    };
    pointer("pointerdown", handles()[1]);
    pointAt(25);
    pointer("pointermove", container);
    pointAt(20);
    other("pointermove", container);
    other("pointerup", container);
    expect(onResize).not.toHaveBeenCalled();
    expect(markedText()).toBe("muscular hypotonia");
    pointer("pointerup", container);
    expect(onResize).toHaveBeenCalledWith("ev-a", [{ start: 7, end: 25 }]);
  });

  it("splits the grab area only where an end handle and a start handle crowd each other", () => {
    const { handle } = mount();
    handle.setMentions([
      { evidence_id: "ev-x", segments: [{ start: 0, end: 6 }, { start: 7, end: 15 }], kind: "own" },
    ]);
    handle.setResizable(["ev-x"]);
    expect(handles().map((el) => `${el.dataset.edge}@${el.dataset.offset}:${el.classList.contains("resize-handle--crowded")}`))
      .toEqual(["start@0:false", "end@6:true", "start@7:true", "end@15:false"]);
    expect(handles()[0].title).toMatch(/Drag to move the start/);
  });
});

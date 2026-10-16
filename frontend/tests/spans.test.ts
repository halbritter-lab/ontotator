import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountSpanEditor,
  type MentionDisplay,
  type SelectionPayload,
} from "../src/spans/adapter";

describe("SpanEditor Unicode adapter", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("keeps render-owned paragraph cuts through marks, handles and redraws without changing Unicode selection", () => {
    const text = "A\u{1f600}e\u0301\n\nB\u{1f600}tail";
    const mentions: MentionDisplay[] = [{ evidence_id: "cross", segments: [{ start: 1, end: 9 }] }];
    const select = vi.fn();
    const handle = mountSpanEditor(container, text, mentions, select, vi.fn(), undefined, undefined, [0, 6]);
    const verify = () => {
      expect(container.textContent).toBe(text);
      const markers = [...container.querySelectorAll<HTMLElement>("[data-paragraph]")];
      expect(markers.map(node => node.dataset.paragraph)).toEqual(["0", "1"]);
      expect(markers.map(node => node.nextElementSibling?.getAttribute("data-start"))).toEqual(["0", "7"]);
      for (const node of markers) {
        expect(node.textContent).toBe("");
        expect(node.getAttribute("aria-hidden")).toBe("true");
        expect(node.hasAttribute("tabindex")).toBe(false);
      }
      expect(container.querySelector('.run[data-start="7"]')?.getAttribute("data-mentions")).toBe("cross");
    };
    verify();
    handle.setResizable(["cross"]); handle.setSelected("cross");
    const edge = container.querySelector<HTMLElement>('.resize-handle[data-edge="start"]')!;
    edge.focus(); handle.setMentions(mentions);
    expect(document.activeElement?.getAttribute("data-edge")).toBe("start");
    verify();
    const first = container.querySelector('.run[data-start="1"]')!.firstChild!;
    const last = container.querySelector('.run[data-start="7"]')!.firstChild!;
    const range = document.createRange(); range.setStart(first, 0); range.setEnd(last, 3);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ segments: [{ start: 1, end: 8 }] }));
    selection.addRange(range);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    container.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(expect.objectContaining({ segments: [{ start: 1, end: 8 }] }));
    handle.destroy();
  });

  it.each(["", "one\n\n"])("renders exactly one zero-text marker for empty/trailing-separator text %j", text => {
    const handle = mountSpanEditor(container, text, [], vi.fn(), vi.fn(), undefined, undefined, [0]);
    expect(container.querySelectorAll("[data-paragraph]")).toHaveLength(1);
    expect(container.querySelector("[data-paragraph]")?.textContent).toBe("");
    expect(container.textContent).toBe(text || "\u00a0");
    handle.setMentions([]); handle.setResizable([]);
    expect(container.querySelectorAll("[data-paragraph]")).toHaveLength(1);
    handle.destroy();
  });

  it("renders text and maps codepoints to DOM runs accurately", () => {
    const text = "A😀e\u0301\r\nB";
    const mentions: MentionDisplay[] = [
      {
        evidence_id: "ev-1",
        label: "Emoji span",
        segments: [{ start: 1, end: 2 }], // "😀"
      },
    ];

    const onSelection = vi.fn();
    const onPick = vi.fn();

    const handle = mountSpanEditor(
      container,
      text,
      mentions,
      onSelection,
      onPick,
    );

    const runs = container.querySelectorAll(".run");
    expect(runs.length).toBeGreaterThanOrEqual(1);

    // Find the marked run for ev-1
    const markedRun = container.querySelector('.run[data-mentions*="ev-1"]');
    expect(markedRun).not.toBeNull();
    expect(markedRun?.textContent).toBe("😀");

    handle.destroy();
  });

  it("handles overlapping mentions across codepoint boundaries", () => {
    const text = "severe hypotonia and areflexia";
    const mentions: MentionDisplay[] = [
      {
        evidence_id: "ev-1",
        label: "Hypotonia",
        segments: [
          { start: 0, end: 6 }, // severe
          { start: 7, end: 16 }, // hypotonia
        ],
      },
      {
        evidence_id: "ev-2",
        label: "Areflexia",
        segments: [
          { start: 0, end: 6 }, // severe
          { start: 21, end: 30 }, // areflexia
        ],
      },
    ];

    const handle = mountSpanEditor(
      container,
      text,
      mentions,
      vi.fn(),
      vi.fn(),
    );

    // Check shared modifier run "severe"
    const sharedRun = container.querySelector(
      '.run[data-mentions="ev-1,ev-2"], .run[data-mentions="ev-2,ev-1"]',
    );
    expect(sharedRun).not.toBeNull();
    expect(sharedRun?.textContent).toBe("severe");

    handle.destroy();
  });

  it("a_negated_mention_marks_its_runs", () => {
    const text = "no hearing loss, mild hypotonia";
    const mentions: MentionDisplay[] = [
      { evidence_id: "ev-neg", segments: [{ start: 3, end: 15 }], kind: "own", negated: true },
      { evidence_id: "ev-pos", segments: [{ start: 11, end: 31 }], kind: "own" },
    ];

    const handle = mountSpanEditor(container, text, mentions, vi.fn(), vi.fn());
    const runFor = (ids: string) => container.querySelector(`.run[data-mentions="${ids}"]`);

    // Only the negated mention's runs: alone ("hearing ") and overlapping ("loss").
    expect(runFor("ev-neg")?.textContent).toBe("hearing ");
    expect(runFor("ev-neg")?.classList.contains("run--negated")).toBe(true);
    expect(runFor("ev-neg,ev-pos")?.textContent).toBe("loss");
    expect(runFor("ev-neg,ev-pos")?.classList.contains("run--negated")).toBe(true);
    expect(runFor("ev-pos")?.classList.contains("run--negated")).toBe(false);
    expect(container.querySelectorAll(".run--negated")).toHaveLength(2);

    // Clearing the flag removes the class on the next render.
    handle.setMentions(mentions.map((m) => ({ ...m, negated: false })));
    expect(container.querySelectorAll(".run--negated")).toHaveLength(0);

    handle.destroy();
  });

  it("delivers selection in Unicode codepoints and respects selection intent", () => {
    const text = "A😀e\u0301\r\nB";
    let capturedPayload: SelectionPayload | null = null;
    const onSelection = (payload: SelectionPayload) => {
      capturedPayload = payload;
    };
    const onPick = vi.fn();

    const handle = mountSpanEditor(
      container,
      text,
      [],
      onSelection,
      onPick,
    );

    // Initial default intent is new_mention
    // Select the emoji "😀"
    // In DOM, the single text node is inside .run
    const runNode = container.querySelector(".run");
    expect(runNode).not.toBeNull();
    const textNode = runNode?.firstChild as Text;
    expect(textNode).not.toBeNull();

    // UTF-16 index of 😀 is 1..3
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 3);

    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Trigger mouseup
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(capturedPayload).not.toBeNull();
    const payload1 = capturedPayload as unknown as SelectionPayload;
    expect(payload1.intent).toBe("new_mention");
    expect(payload1.segments).toEqual([{ start: 1, end: 2 }]);

    // Now switch intent to extend_mention
    handle.setSelectionIntent("extend_mention", "ev-existing-1");

    // Select "B" (UTF-16 index 7..8, codepoint index 6..7)
    const range2 = document.createRange();
    range2.setStart(textNode, 7);
    range2.setEnd(textNode, 8);
    sel?.removeAllRanges();
    sel?.addRange(range2);

    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const payload2 = capturedPayload as unknown as SelectionPayload;
    expect(payload2.intent).toBe("extend_mention");
    expect(payload2.evidenceId).toBe("ev-existing-1");
    expect(payload2.segments).toEqual([{ start: 6, end: 7 }]);

    handle.destroy();
  });

  it("handles pick event when clicking an existing mention run", () => {
    const text = "mild tremors observed";
    const mentions: MentionDisplay[] = [
      {
        evidence_id: "ev-tremor",
        label: "Tremor",
        segments: [{ start: 5, end: 12 }],
      },
    ];

    const onPick = vi.fn();
    const handle = mountSpanEditor(
      container,
      text,
      mentions,
      vi.fn(),
      onPick,
    );

    const markedRun = container.querySelector(
      '.run[data-mentions="ev-tremor"]',
    ) as HTMLElement;
    expect(markedRun).not.toBeNull();

    // Simulate click
    markedRun.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPick).toHaveBeenCalledWith("ev-tremor");

    handle.destroy();
  });

  it("skips and reports invalid codepoint bounds instead of throwing (no blank screen)", () => {
    const text = "short";
    const mentions: MentionDisplay[] = [
      {
        evidence_id: "ev-err",
        label: "Err",
        segments: [{ start: 0, end: 20 }], // out of bounds
      },
      { evidence_id: "ev-ok", segments: [{ start: 0, end: 5 }] },
    ];
    const onInvalid = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      mountSpanEditor(container, text, mentions, vi.fn(), vi.fn(), onInvalid),
    ).not.toThrow();
    expect(onInvalid).toHaveBeenCalledWith(["ev-err"]);
    expect(container.querySelector('[data-mentions*="ev-ok"]')).not.toBeNull();
    warn.mockRestore();
  });
});

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPane } from "../src/editor/TextPane";

afterEach(cleanup);
const base = { mentions: [], selectedEvidenceId: null, selectionIntent: "new_mention" as const,
  onSelection: vi.fn(), onPick: vi.fn(), onChangeIntent: vi.fn() };

it("exposes the actual scrollport and keeps render-owned paragraph markers through text and mention changes", () => {
  const element = vi.fn();
  const mounted = render(<TextPane {...base} text={"A\u{1f600}\n\nB"} onTextElement={element} />);
  const scrollport = mounted.container.querySelector<HTMLDivElement>(".text-container")!;
  expect(element).toHaveBeenLastCalledWith(scrollport);
  expect(scrollport.querySelectorAll("[data-paragraph]")).toHaveLength(2);
  expect(scrollport.querySelector('[data-paragraph="1"]')?.nextElementSibling?.getAttribute("data-start")).toBe("5");
  mounted.rerender(<TextPane {...base} text={"A\u{1f600}\n\nB"} mentions={[{ evidence_id: "ev", segments: [{ start: 1, end: 5 }] }]} resizableEvidenceIds={["ev"]} onTextElement={element} />);
  expect(scrollport.querySelectorAll("[data-paragraph]")).toHaveLength(2);
  expect(scrollport.textContent).toBe("A\u{1f600}\n\nB");
  mounted.rerender(<TextPane {...base} text="replacement" onTextElement={element} />);
  expect(scrollport.querySelectorAll("[data-paragraph]")).toHaveLength(1);
  expect(element).toHaveBeenLastCalledWith(scrollport);
  mounted.unmount(); expect(element).toHaveBeenLastCalledWith(null);
});

it("hands the same scrollport to a replacement callback and releases the previous callback", () => {
  const before = vi.fn(), after = vi.fn();
  const mounted = render(<TextPane {...base} text="text" onTextElement={before} />);
  const scrollport = mounted.container.querySelector(".text-container");
  mounted.rerender(<TextPane {...base} text="text" onTextElement={after} />);
  expect(before).toHaveBeenLastCalledWith(null);
  expect(after).toHaveBeenLastCalledWith(scrollport);
});

it("keeps an invalid-mention warning before the text without polluting its codepoint content", () => {
  const text = "A\u{1f600}e\u0301\n\nB";
  const mounted = render(<TextPane {...base} text={text}
    header={<nav aria-label="Case versions">Version controls</nav>}
    mentions={[{ evidence_id: "invalid", segments: [{ start: 0, end: 99 }] }]} />);
  const warning = mounted.getByRole("alert");
  const scrollport = mounted.container.querySelector<HTMLDivElement>(".text-container")!;
  expect(warning.textContent).toContain("1 mention has offsets outside this text");
  expect(warning.compareDocumentPosition(scrollport) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(scrollport.contains(warning)).toBe(false);
  expect(Array.from(scrollport.textContent ?? "")).toEqual(Array.from(text));
});

it("Escape inside an open drawer or dialog closes that, not the pending mention attach", () => {
  const cancel = vi.fn();
  const mounted = render(<>
    <TextPane {...base} text="Some text" isAttachingMention onCancelAttach={cancel} />
    <aside className="ui-drawer"><button>Inside drawer</button></aside>
    <div role="dialog"><button>Inside dialog</button></div>
  </>);
  const press = (target: Element) => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  press(mounted.getByRole("button", { name: "Inside drawer" }));
  press(mounted.getByRole("button", { name: "Inside dialog" }));
  expect(cancel).not.toHaveBeenCalled();
  press(mounted.container.querySelector(".text-container")!);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("resizableLabels reach the handles", () => {
  const mentions = [{ evidence_id: "ev", segments: [{ start: 0, end: 4 }] }];
  const mounted = render(<TextPane {...base} text="Some text" mentions={mentions} resizableEvidenceIds={["ev"]}
    resizableLabels={{ ev: { start: "Start of marked text", end: "End of marked text" } }} />);
  const labels = () => Array.from(mounted.container.querySelectorAll(".resize-handle")).map((h) => h.getAttribute("aria-label"));
  expect(labels()).toEqual(["Start of marked text", "End of marked text"]);
  mounted.rerender(<TextPane {...base} text="Some text" mentions={mentions} resizableEvidenceIds={["ev"]} />);
  expect(labels()).toEqual(["Start of mention", "End of mention"]);
});

it("flushResizeRef flushes the editor", () => {
  vi.useFakeTimers();
  try {
    const onResize = vi.fn();
    const flush: { current: (() => void) | null } = { current: null };
    const mentions = [{ evidence_id: "ev", segments: [{ start: 0, end: 4 }] }];
    const mounted = render(<TextPane {...base} text="Some text" mentions={mentions} resizableEvidenceIds={["ev"]}
      onResizeMention={onResize} flushResizeRef={flush} />);
    expect(flush.current).toBeTypeOf("function");
    const end = mounted.container.querySelector<HTMLElement>('.resize-handle[data-edge="end"]')!;
    end.focus();
    end.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(onResize).not.toHaveBeenCalled();
    flush.current!();
    expect(onResize).toHaveBeenCalledWith("ev", [{ start: 0, end: 3 }]);
    mounted.unmount();
    expect(flush.current).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

describe("modifier marks", () => {
  const text = "schwere Krampfanfälle";
  const finding = { evidence_id: "ev-1", segments: [{ start: 0, end: 21 }], kind: "own" as const, colorIndex: 2 };
  const modifier = { evidence_id: "mod:ann-1:HP:0012828", segments: [{ start: 0, end: 7 }], kind: "modifier" as const,
    colorIndex: 2, label: "Severe, modifier of Seizure" };
  const runs = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".run"));

  it("renders runs with run--modifier in the finding's slot, titled, not focusable, without handles", () => {
    const mounted = render(<TextPane {...base} text={text} mentions={[{ ...modifier, segments: [{ start: 0, end: 7 }] }]}
      resizableEvidenceIds={[modifier.evidence_id]} />);
    const [run] = runs(mounted.container);
    expect(run.classList.contains("run--modifier")).toBe(true);
    expect(run.classList.contains("run--color-2")).toBe(true);
    expect(run.title).toBe("Severe, modifier of Seizure");
    expect(run.hasAttribute("tabindex")).toBe(false);
    expect(mounted.container.querySelectorAll(".resize-handle")).toHaveLength(0);
  });

  it("framedIds frames exactly the runs of those ids and follows changes", () => {
    const mounted = render(<TextPane {...base} text={text} mentions={[finding, modifier]} framedIds={[modifier.evidence_id]} />);
    const framed = () => runs(mounted.container).filter((r) => r.classList.contains("run--framed")).map((r) => r.textContent);
    expect(framed()).toEqual(["schwere"]);
    mounted.rerender(<TextPane {...base} text={text} mentions={[finding, modifier]} framedIds={["ev-1"]} />);
    expect(framed()).toEqual(["schwere", " Krampfanfälle"]);
    mounted.rerender(<TextPane {...base} text={text} mentions={[finding, modifier]} framedIds={[]} />);
    expect(framed()).toEqual([]);
  });

  it("reports hovered mention ids and [] on leave", () => {
    const hover = vi.fn();
    const mounted = render(<TextPane {...base} text={text} mentions={[finding, modifier]} onHoverMentions={hover} />);
    const [both] = runs(mounted.container);
    fireEvent.mouseOver(both);
    expect(hover).toHaveBeenLastCalledWith(["ev-1", modifier.evidence_id]);
    fireEvent.mouseOut(both);
    expect(hover).toHaveBeenLastCalledWith([]);
  });

  it("a click on a pure modifier run picks the modifier; on a shared run the finding wins", () => {
    const onPick = vi.fn();
    const solo = render(<TextPane {...base} onPick={onPick} text={text} mentions={[modifier]} />);
    fireEvent.click(runs(solo.container)[0]);
    expect(onPick).toHaveBeenLastCalledWith(modifier.evidence_id);
    solo.unmount();
    const shared = render(<TextPane {...base} onPick={onPick} text={text} mentions={[modifier, finding]} />);
    fireEvent.click(runs(shared.container)[0]);
    expect(onPick).toHaveBeenLastCalledWith("ev-1");
  });
});

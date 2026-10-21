import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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

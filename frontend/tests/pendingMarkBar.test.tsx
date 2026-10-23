import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PendingMarkBar } from "../src/editor/PendingMarkBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rect = (top: number, left: number, height = 20, width = 100): DOMRect =>
  ({ top, left, bottom: top + height, right: left + width, height, width, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/**
 * A positioned host (the bar's offsetParent) with a text pane inside; the pane
 * holds a run of the pending mark whose client rects are `markRects`.
 */
function setup(markRects: DOMRect[], { pane = rect(0, 0, 400, 600), barHeight = 30, barWidth = 200 } = {}) {
  const host = document.createElement("div");
  const text = document.createElement("div");
  text.className = "text-container";
  const run = document.createElement("span");
  run.className = "run";
  run.dataset.mentions = "other,ev-pending";
  run.textContent = "marked";
  const unrelated = document.createElement("span");
  unrelated.className = "run";
  unrelated.dataset.mentions = "other";
  text.append(unrelated, run);
  host.append(text);
  document.body.append(host);
  vi.spyOn(text, "getBoundingClientRect").mockReturnValue(pane);
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 600));
  vi.spyOn(run, "getClientRects").mockReturnValue(markRects as unknown as DOMRectList);
  vi.spyOn(unrelated, "getClientRects").mockReturnValue([rect(300, 0)] as unknown as DOMRectList);
  // jsdom has no layout: give the bar a size and the host as offsetParent.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(host);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(barHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(barWidth);
  return { host, text };
}

function renderBar(text: HTMLElement, host: HTMLElement, onDiscard = vi.fn()) {
  render(<PendingMarkBar textElement={text} evidenceId="ev-pending" segmentsKey="[0,6]" onDiscard={onDiscard} />, {
    container: host,
  });
  return { onDiscard, bar: screen.getByRole("group", { name: "Marked text" }) };
}

it("is a group named Marked text with the adjust hint and a Discard button with Esc", () => {
  const { host, text } = setup([rect(40, 50)]);
  const { bar } = renderBar(text, host);
  expect(bar.textContent).toContain("Drag the edges to adjust");
  const discard = screen.getByRole("button", { name: "Discard" });
  expect(discard.getAttribute("aria-keyshortcuts")).toBe("Escape");
  const kbd = discard.querySelector("kbd")!;
  expect(kbd.textContent).toBe("Esc");
  expect(kbd.closest("[aria-hidden='true']")).not.toBeNull();
});

it("sits below the last line of the mark", () => {
  const { host, text } = setup([rect(40, 300), rect(60, 20)]);
  const { bar } = renderBar(text, host);
  expect(bar.classList.contains("is-hidden")).toBe(false);
  expect(bar.style.top).toBe("84px"); // last bottom 80 + gap 4
  expect(bar.style.left).toBe("20px");
});

it("flips above the mark near the bottom of the pane", () => {
  const { host, text } = setup([rect(360, 50), rect(375, 50)]);
  const { bar } = renderBar(text, host);
  expect(bar.style.top).toBe(`${360 - 4 - 30}px`);
});

it("is hidden while the mark is outside the pane", () => {
  const { host, text } = setup([rect(500, 50)]);
  const { bar } = renderBar(text, host);
  expect(bar.classList.contains("is-hidden")).toBe(true);
});

it("Discard calls onDiscard", () => {
  const { host, text } = setup([rect(40, 50)]);
  const { onDiscard } = renderBar(text, host);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
});

it("places itself once the mark is drawn after the bar mounted", async () => {
  const { host, text } = setup([rect(40, 50)]);
  const run = text.querySelector<HTMLElement>('.run[data-mentions="other,ev-pending"]')!;
  run.dataset.mentions = "other";
  const { bar } = renderBar(text, host);
  expect(bar.classList.contains("is-hidden")).toBe(true);
  // The span editor redraws its runs with the pending mark.
  await act(async () => { run.dataset.mentions = "other,ev-pending"; });
  expect(bar.classList.contains("is-hidden")).toBe(false);
  expect(bar.style.top).toBe("64px");
});

it("follows the mark when the text pane is resized without a change inside it", () => {
  // jsdom has no ResizeObserver: a stub that lets the test fire it.
  let fire = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { fire = callback; }
    observe() {}
    disconnect() {}
  });
  try {
    const { host, text } = setup([rect(40, 50)]);
    const { bar } = renderBar(text, host);
    expect(bar.style.top).toBe("64px");
    // A line appears above the pane: the text moves down, nothing inside the pane changes.
    const run = text.querySelector<HTMLElement>('.run[data-mentions="other,ev-pending"]')!;
    vi.spyOn(run, "getClientRects").mockReturnValue([rect(78, 50)] as unknown as DOMRectList);
    act(() => fire());
    expect(bar.style.top).toBe("102px");
  } finally {
    vi.unstubAllGlobals();
  }
});

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoupledScroll } from "../src/variants/useCoupledScroll";

const starts = Object.freeze([0, 40, 120]);
let width: number;
let changes: Set<EventListenerOrEventListenerObject>;
const created: HTMLElement[] = [];

function viewport(next: number) {
  act(() => {
    width = next;
    for (const listener of changes) {
      const event = new Event("change");
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  });
}

function pane(top: number, offsets: number[], border = 2) {
  const element = document.createElement("div");
  document.body.appendChild(element); created.push(element);
  Object.defineProperty(element, "clientTop", { value: border });
  element.getBoundingClientRect = () => ({ top } as DOMRect);
  const markers = (positions: number[]) => {
    element.replaceChildren(...positions.map((offset, index) => {
      const marker = document.createElement("span"); marker.dataset.paragraph = String(index);
      marker.getBoundingClientRect = () => ({ top: top + border + offset - element.scrollTop } as DOMRect);
      return marker;
    }));
  };
  markers(offsets);
  return { element, markers };
}

function scroll(element: HTMLElement, offset: number) {
  act(() => { element.scrollTop = offset; fireEvent.scroll(element); });
}

beforeEach(() => {
  vi.useFakeTimers(); width = 1280; changes = new Set();
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, get matches() { return width >= 1100; },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => changes.add(listener),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => changes.delete(listener),
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); created.splice(0).forEach(element => element.remove()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("paragraph-coupled scroll", () => {
  it("uses current scrollport-relative geometry and aligns both directions", () => {
    const left = pane(140, [24, 140, 410], 3), right = pane(700, [30, 230, 650], 5);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 180);
    expect(right.element.scrollTop).toBe(230);
    act(() => vi.advanceTimersByTime(150));
    scroll(right.element, 670);
    expect(left.element.scrollTop).toBe(410);
  });

  it("falls back to the first paragraph when padding precedes the first marker", () => {
    const left = pane(100, [40, 200, 400]), right = pane(900, [50, 300, 600]);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 10);
    expect(right.element.scrollTop).toBe(50);
  });

  it("maps differing counts proportionally instead of using scroll percentages", () => {
    const left = pane(100, [0, 70, 150]), right = pane(400, [0, 12, 900, 920, 1700]);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: [0, 1, 2, 3, 4], enabled: true }));
    scroll(left.element, 80);
    expect(right.element.scrollTop).toBe(900);
    scroll(left.element, 160);
    expect(right.element.scrollTop).toBe(1700);
  });

  it.each([[1, 1], [1, 3], [3, 1], [0, 3], [3, 0], [0, 0]])("handles %i / %i paragraphs without invalid scroll values", (n, m) => {
    const left = pane(100, Array.from({ length: n }, (_, i) => i * 100));
    const right = pane(400, Array.from({ length: m }, (_, i) => 20 + i * 200));
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: Array.from({ length: n }, (_, i) => i), rightStarts: Array.from({ length: m }, (_, i) => i), enabled: true }));
    scroll(left.element, 120);
    expect(right.element.scrollTop).toBe(n && m ? 20 : 0);
  });

  it("suppresses only the programmatic target echo for 150ms", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 125);
    expect(right.element.scrollTop).toBe(300);
    fireEvent.scroll(right.element);
    expect(left.element.scrollTop).toBe(125);
    act(() => vi.advanceTimersByTime(149));
    fireEvent.scroll(right.element);
    expect(left.element.scrollTop).toBe(125);
    act(() => vi.advanceTimersByTime(1));
    fireEvent.scroll(right.element);
    expect(left.element.scrollTop).toBe(100);
  });

  it("resets the target echo timer on a newer source scroll", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 125); act(() => vi.advanceTimersByTime(100));
    scroll(left.element, 225); act(() => vi.advanceTimersByTime(50));
    fireEvent.scroll(right.element); expect(left.element.scrollTop).toBe(225);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.scroll(right.element); expect(left.element.scrollTop).toBe(200);
  });

  it("cleans listeners/timers when disabled and can be enabled again", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    const foreign = vi.fn(); right.element.addEventListener("scroll", foreign);
    const mounted = renderHook(({ enabled }) => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled }), { initialProps: { enabled: true } });
    scroll(left.element, 125); mounted.rerender({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
    scroll(right.element, 650); expect(left.element.scrollTop).toBe(125);
    expect(foreign).toHaveBeenCalledTimes(1);
    mounted.rerender({ enabled: true }); scroll(right.element, 650);
    expect(left.element.scrollTop).toBe(200);
    mounted.unmount(); expect(vi.getTimerCount()).toBe(0); expect(changes.size).toBe(0);
  });

  it("is off below 1100px and reacts to breakpoint changes", () => {
    width = 1099;
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 125); expect(right.element.scrollTop).toBe(0);
    viewport(1100); scroll(left.element, 125); expect(right.element.scrollTop).toBe(300);
    viewport(800); expect(vi.getTimerCount()).toBe(0);
    scroll(right.element, 650); expect(left.element.scrollTop).toBe(125);
  });

  it("attaches after asynchronous elements arrive and detaches replaced elements", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]), replacement = pane(800, [0, 400, 900]);
    const mounted = renderHook(({ a, b }: { a: HTMLElement | null; b: HTMLElement | null }) => useCoupledScroll(a, b, { leftStarts: starts, rightStarts: starts, enabled: true }), { initialProps: { a: null as HTMLElement | null, b: null as HTMLElement | null } });
    mounted.rerender({ a: left.element, b: right.element }); scroll(left.element, 125);
    expect(right.element.scrollTop).toBe(300);
    mounted.rerender({ a: left.element, b: replacement.element }); expect(vi.getTimerCount()).toBe(0);
    scroll(right.element, 650); expect(left.element.scrollTop).toBe(125);
    scroll(replacement.element, 950); expect(left.element.scrollTop).toBe(200);
  });

  it("reads replacement marker nodes and clears echo state on text/start replacement", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    const mounted = renderHook(({ values }) => useCoupledScroll(left.element, right.element, { leftStarts: values, rightStarts: starts, enabled: true }), { initialProps: { values: starts } });
    scroll(left.element, 125); right.markers([0, 450, 900]);
    scroll(left.element, 125); expect(right.element.scrollTop).toBe(450);
    mounted.rerender({ values: [...starts] }); expect(vi.getTimerCount()).toBe(0);
    scroll(right.element, 950); expect(left.element.scrollTop).toBe(200);
  });

  it("ignores missing target markers and never queries another pane", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0]); pane(900, [0, 50, 80]);
    const query = vi.spyOn(document, "querySelectorAll");
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 125); expect(right.element.scrollTop).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("retains the scrollport's native bottom clamping", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    let position = 0;
    Object.defineProperty(right.element, "scrollTop", {
      get: () => position,
      set: (value: number) => { position = Math.max(0, Math.min(250, value)); },
    });
    renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }));
    scroll(left.element, 225);
    expect(right.element.scrollTop).toBe(250);
    fireEvent.scroll(right.element);
    expect(left.element.scrollTop).toBe(225);
  });

  it("owns passive listeners without duplication under StrictMode", () => {
    const left = pane(100, [0, 100, 200]), right = pane(400, [0, 300, 600]);
    const add = vi.spyOn(left.element, "addEventListener"), remove = vi.spyOn(left.element, "removeEventListener");
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const mounted = renderHook(() => useCoupledScroll(left.element, right.element, { leftStarts: starts, rightStarts: starts, enabled: true }), { wrapper });
    expect(add.mock.calls.filter(([type]) => type === "scroll").every(([, , options]) => (options as AddEventListenerOptions).passive)).toBe(true);
    scroll(left.element, 125); expect(right.element.scrollTop).toBe(300);
    mounted.unmount(); expect(vi.getTimerCount()).toBe(0); expect(changes.size).toBe(0);
    expect(add.mock.calls.filter(([type]) => type === "scroll").length).toBe(remove.mock.calls.filter(([type]) => type === "scroll").length);
  });
});

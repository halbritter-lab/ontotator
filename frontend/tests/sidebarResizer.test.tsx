import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampSidebarWidth, readStoredWidth, sidebarLimits, storageKey, useSidebarWidth } from "../src/editor/sidebarWidth";
import { SidebarResizer } from "../src/editor/SidebarResizer";

const editorCss = readFileSync(resolve(__dirname, "../src/styles/screens/editor.css"), "utf8");

// jsdom has no PointerEvent; without it clientX and pointerId would be dropped.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

it("limits_three_and_two_columns", () => {
  expect(sidebarLimits({ viewport: 1600, inspector: 380 })).toEqual({ min: 220, max: 480, fallback: 260 });
  expect(sidebarLimits({ viewport: 1100, inspector: 380 })).toEqual({ min: 220, max: 300, fallback: 260 });
  expect(sidebarLimits({ viewport: 900, inspector: 0 })).toEqual({ min: 220, max: 315, fallback: 220 });
});

it("clamps_and_ignores_invalid_stored_values", () => {
  const limits = { min: 220, max: 480, fallback: 260 };
  expect(clampSidebarWidth(900, limits)).toBe(480);
  expect(clampSidebarWidth(100, limits)).toBe(220);
  localStorage.setItem(storageKey("anna"), "abc"); expect(readStoredWidth("anna")).toBeNull();
  localStorage.setItem(storageKey("anna"), "-5"); expect(readStoredWidth("anna")).toBeNull();
  localStorage.setItem(storageKey("anna"), "320"); expect(readStoredWidth("anna")).toBe(320);
  expect(storageKey("anna")).toBe("ontotator.editor.sidebarWidth.v1:anna");
});

it("keyboard_changes_width_and_reports_aria_values", () => {
  const onChange = vi.fn();
  render(<SidebarResizer width={260} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={onChange} onReset={vi.fn()} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator", { name: "Resize findings column" });
  expect(sep.getAttribute("aria-valuenow")).toBe("260");
  expect(sep.getAttribute("aria-valuemin")).toBe("220");
  expect(sep.getAttribute("aria-valuemax")).toBe("480");
  expect(sep.getAttribute("aria-orientation")).toBe("vertical");
  expect(sep.getAttribute("aria-controls")).toBe("sidebar");
  expect(sep.getAttribute("aria-valuetext")).toBe("260 pixels (default 260)");
  fireEvent.keyDown(sep, { key: "ArrowRight" }); expect(onChange).toHaveBeenLastCalledWith(276);
  fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true }); expect(onChange).toHaveBeenLastCalledWith(220);
  fireEvent.keyDown(sep, { key: "End" }); expect(onChange).toHaveBeenLastCalledWith(480);
  fireEvent.keyDown(sep, { key: "Home" }); expect(onChange).toHaveBeenLastCalledWith(220);
});

it("enter_and_double_click_reset", () => {
  const onReset = vi.fn();
  render(<SidebarResizer width={300} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={vi.fn()} onReset={onReset} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator");
  fireEvent.keyDown(sep, { key: "Enter" }); fireEvent.doubleClick(sep);
  expect(onReset).toHaveBeenCalledTimes(2);
});

it("escape_during_drag_restores_the_start_width", () => {
  const onChange = vi.fn();
  render(<SidebarResizer width={260} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={onChange} onReset={vi.fn()} onCommit={vi.fn()} />);
  const sep = screen.getByRole("separator");
  fireEvent.pointerDown(sep, { clientX: 260, pointerId: 1 });
  fireEvent.pointerMove(sep, { clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(sep, { clientX: 320, pointerId: 1 });
  fireEvent.keyDown(sep, { key: "Escape" });
  expect(onChange).toHaveBeenLastCalledWith(260);
});

it("drag_end_commits_the_dragged_width", () => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(<SidebarResizer width={260} limits={{ min: 220, max: 480, fallback: 260 }} controls="sidebar" onChange={onChange} onReset={vi.fn()} onCommit={onCommit} />);
  const sep = screen.getByRole("separator");
  fireEvent.pointerDown(sep, { clientX: 260, pointerId: 1 });
  fireEvent.pointerMove(sep, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(sep, { clientX: 300, pointerId: 1 });
  expect(onChange).toHaveBeenLastCalledWith(300);
  expect(onCommit.mock.calls).toEqual([["drag-start"], ["drag"]]);
});

function Harness({ username }: { username: string }) {
  const { width, limits, setWidth, commit, reset } = useSidebarWidth(username);
  return <SidebarResizer width={width} limits={limits} controls="sidebar" onChange={setWidth} onReset={reset} onCommit={commit} />;
}

describe("useSidebarWidth", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  });

  it("starts_from_the_clamped_stored_width_and_debounces_the_write", () => {
    vi.useFakeTimers();
    localStorage.setItem(storageKey("anna"), "900");
    const { result } = renderHook(() => useSidebarWidth("anna"));
    expect(result.current.width).toBe(480);
    act(() => result.current.setWidth(330));
    act(() => result.current.commit("key"));
    expect(localStorage.getItem(storageKey("anna"))).toBe("900");
    act(() => { vi.advanceTimersByTime(300); });
    expect(localStorage.getItem(storageKey("anna"))).toBe("330");
  });

  it("unmount_flushes_a_pending_key_write", () => {
    vi.useFakeTimers();
    localStorage.setItem(storageKey("anna"), "300");
    const { result, unmount } = renderHook(() => useSidebarWidth("anna"));
    act(() => result.current.setWidth(340));
    act(() => result.current.commit("key"));
    expect(localStorage.getItem(storageKey("anna"))).toBe("300");
    unmount();
    expect(localStorage.getItem(storageKey("anna"))).toBe("340");
  });

  it("drag_cancel_after_a_pending_key_change_leaves_storage_at_the_pre_drag_state", () => {
    vi.useFakeTimers();
    localStorage.setItem(storageKey("anna"), "300");
    render(<Harness username="anna" />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep.getAttribute("aria-valuenow")).toBe("316");
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerDown(sep, { clientX: 316, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(500); });
    expect(sep.getAttribute("aria-valuenow")).toBe("400");
    expect(localStorage.getItem(storageKey("anna"))).toBe("300");
    fireEvent.keyDown(sep, { key: "Escape" });
    expect(sep.getAttribute("aria-valuenow")).toBe("316");
    expect(localStorage.getItem(storageKey("anna"))).toBe("316");
    act(() => { vi.advanceTimersByTime(500); });
    expect(localStorage.getItem(storageKey("anna"))).toBe("316");
  });

  it("enter_during_a_drag_ends_the_drag_before_resetting", () => {
    vi.useFakeTimers();
    localStorage.setItem(storageKey("anna"), "300");
    render(<Harness username="anna" />);
    const sep = screen.getByRole("separator");
    fireEvent.pointerDown(sep, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 360, pointerId: 1 });
    fireEvent.keyDown(sep, { key: "Enter" });
    act(() => { vi.advanceTimersByTime(50); });
    expect(sep.getAttribute("aria-valuenow")).toBe("260");
    expect(localStorage.getItem(storageKey("anna"))).toBeNull();
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 400, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(50); });
    expect(sep.getAttribute("aria-valuenow")).toBe("260");
    expect(localStorage.getItem(storageKey("anna"))).toBeNull();
  });

  it("reset_removes_the_key_and_returns_to_the_fallback", () => {
    localStorage.setItem(storageKey("anna"), "320");
    const { result } = renderHook(() => useSidebarWidth("anna"));
    expect(result.current.width).toBe(320);
    act(() => result.current.reset());
    expect(result.current.width).toBe(260);
    expect(localStorage.getItem(storageKey("anna"))).toBeNull();
  });

  it("reclamps_on_viewport_resize", () => {
    localStorage.setItem(storageKey("anna"), "400");
    const { result } = renderHook(() => useSidebarWidth("anna"));
    expect(result.current.width).toBe(400);
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.limits).toEqual({ min: 220, max: 315, fallback: 220 });
    expect(result.current.width).toBe(315);
  });
});

describe("editor.css sidebar width", () => {
  it("uses the --sidebar-width variable for the sidebar and both tree grids", () => {
    expect(editorCss).toMatch(/\.app-layout\s*\{[^}]*--sidebar-width:\s*260px/);
    expect(editorCss).toMatch(/--sidebar-width:\s*220px/);
    expect(editorCss).not.toMatch(/grid-template-columns:\s*(220|260)px/);
    expect(editorCss).not.toMatch(/\.sidebar\s*\{[^}]*width:\s*(220|260)px/);
    expect(editorCss.match(/grid-template-columns:\s*var\(--sidebar-width\)/g)?.length).toBe(3);
  });
  it("hides the separator at narrow widths and has forced-colours rules", () => {
    expect(editorCss).toMatch(/@media \(max-width: 700px\)\s*\{\s*\.sidebar-resizer\s*\{\s*display:\s*none;/);
    expect(editorCss).toMatch(/@media \(forced-colors: active\)\s*\{[^}]*\.sidebar-resizer-grip\s*\{\s*background:\s*CanvasText;/);
    expect(editorCss).toMatch(/\.sidebar-resizer:focus-visible\s*\{\s*outline:\s*var\(--focus-width\) solid var\(--focus-ring\);\s*outline-offset:\s*var\(--focus-offset\);/);
  });
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toast, useToast } from "../../src/ui/Toast";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Host({ onUndo }: { onUndo: () => void }) {
  const { toast, show, dismiss } = useToast();
  return <><button onClick={() => show({ message: "fr of case-0101: Review off", actionLabel: "Undo", onAction: onUndo })}>first</button>
    <button onClick={() => show({ message: "Plan saved for 20 cases" })}>second</button><input aria-label="field" />
    <input type="checkbox" aria-label="Select case-0101 (3 languages)" />
    <Toast toast={toast} onDismiss={dismiss} /></>;
}
it("shows one polite toast at a time without taking focus and replaces the old one", () => {
  render(<Host onUndo={() => undefined} />);
  screen.getByText("first").focus(); // fireEvent.click does not move focus in jsdom
  fireEvent.click(screen.getByText("first"));
  const region = screen.getByRole("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(document.activeElement?.textContent).toBe("first");
  fireEvent.click(screen.getByText("second"));
  expect(region.textContent).toContain("Plan saved for 20 cases");
  expect(region.textContent).not.toContain("Review off");
});
it("disappears after 10 s, pauses while hovered, and runs its action on Ctrl+Z outside text fields", () => {
  const onUndo = vi.fn();
  render(<Host onUndo={onUndo} />);
  fireEvent.click(screen.getByText("first"));
  fireEvent.mouseEnter(screen.getByRole("status").firstElementChild!);
  act(() => { vi.advanceTimersByTime(15_000); });
  expect(screen.getByRole("button", { name: "Undo" })).not.toBeNull();
  fireEvent.mouseLeave(screen.getByRole("status").firstElementChild!);
  screen.getByLabelText("field").focus();
  fireEvent.keyDown(screen.getByLabelText("field"), { key: "z", ctrlKey: true });
  expect(onUndo).not.toHaveBeenCalled();
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  expect(onUndo).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});
it("runs its action on Meta+Z and while a case checkbox has focus", () => {
  const onUndo = vi.fn();
  render(<Host onUndo={onUndo} />);
  fireEvent.click(screen.getByText("first"));
  const box = screen.getByRole("checkbox", { name: "Select case-0101 (3 languages)" });
  box.focus();
  fireEvent.keyDown(box, { key: "z", ctrlKey: true });
  expect(onUndo).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("first"));
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });
  expect(onUndo).toHaveBeenCalledTimes(2);
});
it("closes from its close button and after 10 s without hover", () => {
  render(<Host onUndo={() => undefined} />);
  fireEvent.click(screen.getByText("second"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.getByRole("status").textContent).toBe("");
  fireEvent.click(screen.getByText("second"));
  act(() => { vi.advanceTimersByTime(9_999); });
  expect(screen.getByRole("status").textContent).toContain("Plan saved");
  act(() => { vi.advanceTimersByTime(1); });
  expect(screen.getByRole("status").textContent).toBe("");
});

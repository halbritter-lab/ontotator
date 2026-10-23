import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Toast, useToast } from "../../src/ui/Toast";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Host({ onUndo }: { onUndo: () => void }) {
  const { toast, show, dismiss } = useToast();
  return <><button onClick={() => show({ message: "fr of case-0101: Review off", actionLabel: "Undo", onAction: onUndo, undo: true })}>first</button>
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
it("runs only Undo actions on Ctrl+Z; another action keeps a non-undo icon", () => {
  const onSelect = vi.fn();
  function Other() {
    const { toast, show, dismiss } = useToast();
    return <><button onClick={() => show({ message: "Assigned 3 cases", actionLabel: "Select the 2 skipped cases", onAction: onSelect })}>assign</button>
      <Toast toast={toast} onDismiss={dismiss} /></>;
  }
  render(<Other />);
  fireEvent.click(screen.getByText("assign"));
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });
  expect(onSelect).not.toHaveBeenCalled();
  const action = screen.getByRole("button", { name: "Select the 2 skipped cases" });
  expect(action.querySelector(".ui-toast-undo-icon")).toBeNull();
  expect(action.querySelector("svg")).not.toBeNull();
  fireEvent.click(action);
  expect(onSelect).toHaveBeenCalledTimes(1);
});
it("shows the undo icon on an Undo action", () => {
  render(<Host onUndo={() => undefined} />);
  fireEvent.click(screen.getByText("first"));
  expect(screen.getByRole("button", { name: "Undo" }).querySelector(".ui-toast-undo-icon")).not.toBeNull();
});
it("sits above the floating selection bar and above a dialog footer at the bottom of the viewport", () => {
  const height = window.innerHeight;
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 390, width: 390, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  function Page({ obstacle }: { obstacle: "bar" | "footer" | "middle" }) {
    const { toast, show, dismiss } = useToast();
    return <>
      {obstacle === "bar" && <div className="selection-bar" data-testid="obstacle" />}
      {obstacle === "middle" && <div className="selection-bar" data-testid="obstacle" />}
      {obstacle === "footer" && <div className="ui-dialog"><div className="modal-actions" data-testid="obstacle" /></div>}
      <button onClick={() => show({ message: "Saved" })}>show</button>
      <Toast toast={toast} onDismiss={dismiss} />
    </>;
  }
  const offsetFor = (obstacle: "bar" | "footer" | "middle", top: number, bottom: number) => {
    const view = render(<Page obstacle={obstacle} />);
    vi.spyOn(screen.getByTestId("obstacle"), "getBoundingClientRect").mockReturnValue(rect(top, bottom));
    fireEvent.click(screen.getByText("show"));
    const value = screen.getByRole("status").style.getPropertyValue("--toast-offset");
    view.unmount();
    return value;
  };
  expect(offsetFor("bar", height - 120, height)).toBe("120px");
  expect(offsetFor("footer", height - 76, height - 16)).toBe("76px");
  // A bar still in the page flow, far above the bottom edge, does not move the toast.
  expect(offsetFor("middle", 100, 220)).toBe("0px");
});
it("moves above a dialog footer that opens while the toast is visible", async () => {
  const height = window.innerHeight;
  function Page() {
    const { toast, show, dismiss } = useToast();
    const [open, setOpen] = useState(false);
    return <>
      {open && <div className="ui-dialog"><div className="modal-actions" data-testid="footer" /></div>}
      <button onClick={() => show({ message: "Saved" })}>show</button>
      <button onClick={() => setOpen(true)}>open</button>
      <Toast toast={toast} onDismiss={dismiss} />
    </>;
  }
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === "footer" ? height - 76 : 0;
    const bottom = this.dataset.testid === "footer" ? height - 16 : 0;
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  render(<Page />);
  fireEvent.click(screen.getByText("show"));
  expect(screen.getByRole("status").style.getPropertyValue("--toast-offset")).toBe("0px");
  fireEvent.click(screen.getByText("open"));
  // The DOM change is observed in a microtask; the measurement runs in the next animation frame.
  await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(50); });
  expect(screen.getByRole("status").style.getPropertyValue("--toast-offset")).toBe("76px");
  spy.mockRestore();
});
it("the undo toast stays on one line", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/components.css"), "utf8");
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = css;
  try {
    render(<Host onUndo={() => undefined} />);
    fireEvent.click(screen.getByText("first"));
    const toast = document.querySelector<HTMLElement>(".ui-toast")!;
    const message = toast.querySelector<HTMLElement>(".ui-toast-message")!;
    expect(getComputedStyle(toast).flexWrap).toBe("nowrap");
    expect(getComputedStyle(toast).maxWidth).toBe("min(50vw, 40rem)");
    expect(getComputedStyle(message).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(message).textOverflow).toBe("ellipsis");
    expect(message.getAttribute("title")).toBe("fr of case-0101: Review off");
  } finally { style.remove(); }
});

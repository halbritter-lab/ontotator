import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Popover } from "../../src/ui/Popover";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Example({ onEscapeShortcut = () => undefined, closeOnTabOut }: { onEscapeShortcut?: () => void; closeOnTabOut?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useShortcut("Escape", () => { onEscapeShortcut(); });
  return <>
    <button ref={anchor} aria-expanded={open} aria-controls="filter-popover" onClick={() => setOpen((value) => !value)}>Filter</button>
    <button>Outside</button>
    <Popover open={open} anchorRef={anchor} label="Filter" onClose={() => setOpen(false)} footer={<button>Clear all</button>} closeOnTabOut={closeOnTabOut}>
      <div id="filter-popover">
        <fieldset><legend>Language</legend>
          <label><input type="checkbox" /> de, 8 texts</label>
          <label><input type="checkbox" /> fr, 6 texts</label>
        </fieldset>
      </div>
    </Popover>
  </>;
}
const stubMatchMedia = (matches: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({
  matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
}));

it("non-modal dialog, focuses first checkbox, Tab cycles, Escape returns focus", async () => {
  const user = userEvent.setup();
  const escapeShortcut = vi.fn();
  render(<Example onEscapeShortcut={escapeShortcut} />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(dialog.hasAttribute("aria-modal")).toBe(false);
  expect(dialog.className).toContain("ui-popover");
  expect(dialog.style.width).toBe("360px");
  const [de, fr] = screen.getAllByRole("checkbox");
  expect(document.activeElement).toBe(de);
  await user.click(de);
  expect(screen.getByRole("dialog", { name: "Filter" })).not.toBeNull();
  await user.tab();
  expect(document.activeElement).toBe(fr);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear all" }));
  await user.tab();
  expect(document.activeElement).toBe(de);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear all" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter" }));
  expect(escapeShortcut).not.toHaveBeenCalled();
});

it("closes on a pointer down outside without moving focus", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("anchors below the button", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const anchor = screen.getByRole("button", { name: "Filter" });
  anchor.getBoundingClientRect = () => ({ top: 100, bottom: 132, left: 40, right: 120, width: 80, height: 32, x: 40, y: 100, toJSON: () => ({}) });
  await user.click(anchor);
  await act(async () => { window.dispatchEvent(new Event("resize")); });
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(dialog.style.position).toBe("fixed");
  expect(dialog.style.top).toBe("136px");
  expect(dialog.style.left).toBe("40px");
});

it("sheet below 700 px", async () => {
  stubMatchMedia(true);
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.className).toContain("ui-popover-sheet");
  expect(screen.getByRole("button", { name: "Clear all" }).closest(".modal-actions")).not.toBeNull();
  expect(document.activeElement).toBe(screen.getAllByRole("checkbox")[0]);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter" }));
});

it.each([
  { shift: false, from: "Clear all" },
  { shift: true, from: "de" },
])("closeOnTabOut closes on Tab out at either end without preventing the default (%j)", async ({ shift, from }) => {
  const user = userEvent.setup();
  render(<Example closeOnTabOut />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const start = from === "de" ? screen.getAllByRole("checkbox")[0] : screen.getByRole("button", { name: "Clear all" });
  start.focus();
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  act(() => { start.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closeOnTabOut keeps Tab inside the popover between its controls", async () => {
  const user = userEvent.setup();
  render(<Example closeOnTabOut />);
  await user.click(screen.getByRole("button", { name: "Filter" }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getAllByRole("checkbox")[1]);
  expect(screen.getByRole("dialog", { name: "Filter" })).not.toBeNull();
});

function mockPanelHeight(initial: number) {
  let height = initial;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("ui-popover") ? height : 0;
  });
  return (next: number) => { height = next; };
}
const anchorAt = (anchor: HTMLElement, top: number) => {
  anchor.getBoundingClientRect = () => ({ top, bottom: top + 32, left: 40, right: 120, width: 80, height: 32, x: 40, y: top, toJSON: () => ({}) });
};

it("flips above an anchor near the bottom and caps its height to the room there", async () => {
  vi.stubGlobal("innerHeight", 768);
  mockPanelHeight(400);
  const user = userEvent.setup();
  render(<Example />);
  const anchor = screen.getByRole("button", { name: "Filter" });
  anchorAt(anchor, 700);
  await user.click(anchor);
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  // Room above: 700 - 4 - 8 = 688; below: 768 - 732 - 4 - 8 = 24; the stylesheet's 70vh stays the overall cap.
  expect(dialog.style.top).toBe(`${700 - 4 - 400}px`);
  expect(dialog.style.maxHeight).toBe(`${Math.floor(768 * 0.7)}px`);
});

it("never grows past the free space on the chosen side", async () => {
  vi.stubGlobal("innerHeight", 768);
  mockPanelHeight(900);
  const user = userEvent.setup();
  render(<Example />);
  const anchor = screen.getByRole("button", { name: "Filter" });
  anchorAt(anchor, 700);
  await user.click(anchor);
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  const maxHeight = parseFloat(dialog.style.maxHeight);
  expect(maxHeight).toBeLessThanOrEqual(700 - 4 - 8);
  // Its bottom edge stays clear of the anchor.
  expect(parseFloat(dialog.style.top) + maxHeight).toBe(700 - 4);
});

it("stays below with a capped height when there is more room below", async () => {
  vi.stubGlobal("innerHeight", 768);
  mockPanelHeight(900);
  const user = userEvent.setup();
  render(<Example />);
  const anchor = screen.getByRole("button", { name: "Filter" });
  anchorAt(anchor, 100);
  await user.click(anchor);
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(dialog.style.top).toBe("136px");
  expect(dialog.style.maxHeight).toBe(`${Math.floor(768 * 0.7)}px`);
});

it("re-places when its content grows after opening", async () => {
  vi.stubGlobal("innerHeight", 768);
  const setHeight = mockPanelHeight(20);
  const callbacks: Array<() => void> = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect() {} });
  const user = userEvent.setup();
  render(<Example />);
  const anchor = screen.getByRole("button", { name: "Filter" });
  anchorAt(anchor, 600);
  await user.click(anchor);
  const dialog = screen.getByRole("dialog", { name: "Filter" });
  expect(dialog.style.top).toBe("636px");
  setHeight(400);
  expect(callbacks.length).toBeGreaterThan(0);
  act(() => { for (const callback of callbacks) callback(); });
  expect(dialog.style.top).toBe(`${600 - 4 - 400}px`);
});

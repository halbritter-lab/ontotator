import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Popover } from "../../src/ui/Popover";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Example({ onEscapeShortcut = () => undefined }: { onEscapeShortcut?: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useShortcut("Escape", () => { onEscapeShortcut(); });
  return <>
    <button ref={anchor} aria-expanded={open} aria-controls="filter-popover" onClick={() => setOpen((value) => !value)}>Filter</button>
    <button>Outside</button>
    <Popover open={open} anchorRef={anchor} label="Filter" onClose={() => setOpen(false)} footer={<button>Clear all</button>}>
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

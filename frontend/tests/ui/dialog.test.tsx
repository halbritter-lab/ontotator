import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StrictMode, createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/ui/ConfirmDialog";
import { Dialog } from "../../src/ui/Dialog";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(cleanup);
it("has_dialog_role_modal_flag_and_name", () => {
  render(<Dialog open title="Settings" heading={<span>Custom heading</span>} footer={<button>Save</button>}>Content</Dialog>);
  expect(screen.getByRole("dialog", { name: "Settings" }).getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("heading").textContent).toBe("Custom heading");
  expect(screen.getByRole("button").closest(".modal-actions")).not.toBeNull();
});
it("focuses_initial_or_first_focusable", () => {
  const initial = createRef<HTMLInputElement>();
  const view = render(<Dialog open title="Edit" initialFocus={initial}><button>First</button><input ref={initial} aria-label="Name" /></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
  view.rerender(<Dialog open={false} title="Edit">Hidden</Dialog>);
  view.rerender(<Dialog open title="Edit"><button disabled>Disabled</button><button>First</button></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
});
it("traps_tab_and_shift_tab", async () => {
  const user = userEvent.setup();
  render(<><button>Outside</button><Dialog open title="Edit"><button>First</button><button>Last</button></Dialog></>);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
});
it.each(["initial", "forward", "backward"] as const)("skips_buttons_with_display_none_ancestors_for_%s_focus", (direction) => {
  render(<Dialog open title="Edit">
    <div style={{ display: "none" }}><button>Hidden first</button></div>
    <button>First visible</button><button>Last visible</button>
    <div style={{ display: "none" }}><button>Hidden last</button></div>
  </Dialog>);
  const first = screen.getByRole("button", { name: "First visible" });
  const last = screen.getByRole("button", { name: "Last visible" });
  if (direction === "initial") {
    expect(document.activeElement).toBe(first);
  } else {
    const start = direction === "forward" ? last : first;
    start.focus();
    const allowedDefault = fireEvent.keyDown(start, { key: "Tab", shiftKey: direction === "backward" });
    expect(allowedDefault).toBe(false);
    expect(document.activeElement).toBe(direction === "forward" ? first : last);
  }
});
it("escape_closes_and_focus_returns_in_strict_mode", async () => {
  function Example() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open</button><Dialog open={open} title="Edit" onClose={() => setOpen(false)}><input aria-label="Name" /></Dialog></>; }
  const user = userEvent.setup();
  render(<StrictMode><Example /></StrictMode>);
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("dialog", { name: "Edit" })).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
});
it("without_onClose_escape_does_nothing", () => {
  render(<Dialog open title="Wait">Waiting</Dialog>);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).not.toBeNull();
});
it("backdrop_closes_only_when_enabled", () => {
  const close = vi.fn();
  const view = render(<Dialog open title="Edit" onClose={close}><button>Inside</button></Dialog>);
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(close).not.toHaveBeenCalled();
  view.rerender(<Dialog open title="Edit" onClose={close} closeOnBackdrop><button>Inside</button></Dialog>);
  fireEvent.click(screen.getByRole("button", { name: "Inside" }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(close).toHaveBeenCalledOnce();
});
it("blocks_screen_shortcuts_while_open_and_respects_inert_ancestor", () => {
  const screenHandler = vi.fn(); const dialogHandler = vi.fn(); const close = vi.fn();
  function Bindings() { useShortcut("1", screenHandler); useShortcut("2", dialogHandler, { scope: "dialog" }); return null; }
  render(<><Bindings /><div data-testid="root"><Dialog open title="Edit" onClose={close}><button>Inside</button></Dialog></div></>);
  fireEvent.keyDown(window, { key: "1" }); fireEvent.keyDown(window, { key: "2" });
  expect(screenHandler).not.toHaveBeenCalled(); expect(dialogHandler).toHaveBeenCalledOnce();
  screen.getByTestId("root").setAttribute("inert", "");
  fireEvent.keyDown(window, { key: "Escape" }); expect(close).not.toHaveBeenCalled();
});
it("locks_scrolling_until_the_last_dialog_closes_and_restores_the_original_style", () => {
  document.body.style.overflow = "auto";
  const first = render(<Dialog open title="First">Text</Dialog>);
  const second = render(<Dialog open title="Second">Text</Dialog>);
  expect(document.body.style.overflow).toBe("hidden");
  first.unmount(); expect(document.body.style.overflow).toBe("hidden");
  second.unmount(); expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});
it("keeps_focus_in_an_empty_dialog", async () => {
  render(<Dialog open title="Wait">Waiting</Dialog>);
  await userEvent.setup().tab();
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
});
it("renders_a_header_close_button_only_with_onClose", () => {
  const close = vi.fn();
  const { rerender } = render(<Dialog open title="T" onClose={close}><button>Body</button></Dialog>);
  const button = screen.getByRole("button", { name: "Close" });
  fireEvent.click(button); expect(close).toHaveBeenCalledOnce();
  rerender(<Dialog open title="T"><button>Body</button></Dialog>);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});
it("initial_focus_skips_the_header_close_button", () => {
  render(<Dialog open title="T" onClose={vi.fn()}><button>Body</button></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Body" }));
});
it("focuses_the_dialog_when_the_body_has_nothing_focusable", () => {
  render(<Dialog open title="T" onClose={vi.fn()}><p>Text</p></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
});
it("header_close_is_first_in_tab_order_and_footer_is_outside_the_body", () => {
  render(<Dialog open title="T" onClose={vi.fn()} footer={<button>Done</button>}><button>Body</button></Dialog>);
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector(".ui-dialog-header button")).toBe(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("button", { name: "Done" }).closest(".ui-dialog-body")).toBeNull();
});
it("busy_confirm_dialog_has_no_header_close", () => {
  render(<ConfirmDialog open busy title="Delete" message={<p>m</p>} confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
});
it("md_dialog_is_a_full_height_sheet_below_700px", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/components.css"), "utf8");
  const block = css.match(/@media \(max-width: 699px\) \{\s*\.ui-dialog--md \{([^}]*)\}/);
  expect(block?.[1]).toMatch(/height: calc\(100dvh - 2 \* var\(--space-4\)\)/);
  expect(block?.[1]).toMatch(/max-width: none/);
});

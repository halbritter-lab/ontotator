import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ShortcutHelpHost, openShortcutHelp } from "../../src/ui/ShortcutHelp";
import { useShortcut, useShortcutHint } from "../../src/ui/shortcuts";
afterEach(cleanup);
it("question_mark_toggles_the_help", () => {
  render(<ShortcutHelpHost />);
  fireEvent.keyDown(window, { key: "?", shiftKey: true });
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeNull();
  fireEvent.keyDown(window, { key: "?", shiftKey: true }); expect(screen.queryByRole("dialog")).toBeNull();
});
it("lists_described_bindings_and_hints_by_group", () => {
  function Bindings() { useShortcut(["ArrowLeft", "ArrowRight"], () => {}, { description: "Navigate", group: "Review" }); useShortcutHint(["Shift+arrows"], "Select text", { group: "Editor" }); useShortcut("x", () => {}); return null; }
  render(<><Bindings /><ShortcutHelpHost /></>); act(openShortcutHelp);
  expect(screen.getByRole("heading", { name: "Review" })).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Editor" })).not.toBeNull();
  expect(screen.getByText("Navigate").previousElementSibling?.textContent).toBe("← / →");
  expect(screen.getByText("Select text")).not.toBeNull();
  expect(screen.getByText("Show / hide this help")).not.toBeNull();
  expect(screen.getByText("Shortcuts are disabled while typing in a field or when a dialog is open.")).not.toBeNull();
});
it("lists_screen_keys_that_need_a_selection_as_not_available_right_now", () => {
  function Bindings() { useShortcut("/", () => {}, { description: "Focus the term search", group: "Finding", enabled: false, listWhenDisabled: true }); useShortcut("x", () => {}, { description: "Hidden", enabled: false }); return null; }
  render(<><Bindings /><ShortcutHelpHost /></>); act(openShortcutHelp);
  expect(screen.getByRole("heading", { name: "Finding" })).not.toBeNull();
  expect(screen.getByText("Focus the term search").textContent).toBe("Focus the term search (not available right now)");
  expect(screen.queryByText("Hidden")).toBeNull();
});
it("two_hosts_render_one_overlay_and_transfer_ownership", () => {
  const view = render(<StrictMode><ShortcutHelpHost key="first" /><ShortcutHelpHost key="second" /></StrictMode>);
  act(openShortcutHelp); expect(screen.getAllByRole("dialog")).toHaveLength(1);
  view.rerender(<StrictMode><ShortcutHelpHost key="second" /></StrictMode>);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.keyDown(window, { key: "?" }); expect(screen.queryByRole("dialog")).toBeNull();
});
it("open_shortcut_help_opens_it_and_close_button_dismisses", () => {
  render(<ShortcutHelpHost />); act(openShortcutHelp);
  fireEvent.click(within(screen.getByRole("dialog").querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

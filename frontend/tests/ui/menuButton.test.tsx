import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MenuButton } from "../../src/ui/MenuButton";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(cleanup);
const setup = () => {
  const resolve = vi.fn(); const carry = vi.fn(); const review = vi.fn(); const escapeShortcut = vi.fn();
  function Host() {
    useShortcut("Escape", () => { escapeShortcut(); });
    return <><MenuButton label="2 more actions for case-107 de" buttonLabel="+2"
      items={[{ id: "resolve", label: "Resolve…", onSelect: resolve }, { id: "carry", label: "Carry to v2…", onSelect: carry }, { id: "review", label: "Review changes…", onSelect: review }]} />
      <button>Outside</button></>;
  }
  render(<Host />);
  return { resolve, carry, review, escapeShortcut, button: screen.getByRole("button", { name: "2 more actions for case-107 de" }) };
};
const item = (name: string) => screen.getByRole("menuitem", { name });

it("aria-haspopup, arrow keys, Escape", async () => {
  const user = userEvent.setup();
  const { button, carry, escapeShortcut } = setup();
  expect(button.getAttribute("aria-haspopup")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.textContent).toBe("+2");
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  const menu = screen.getByRole("menu", { name: "2 more actions for case-107 de" });
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-controls")).toBe(menu.id);
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(item("Carry to v2…"));
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(escapeShortcut).not.toHaveBeenCalled();

  fireEvent.keyDown(button, { key: "ArrowUp" });
  expect(document.activeElement).toBe(item("Review changes…"));
  await user.keyboard("{ArrowUp}");
  await user.keyboard("{Enter}");
  expect(carry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("ArrowDown on the button opens at the first item; click selects; outside pointer and Tab close", async () => {
  const user = userEvent.setup();
  const { button, review } = setup();
  button.focus();
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(document.activeElement).toBe(item("Resolve…"));
  await user.click(item("Review changes…"));
  expect(review).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  await user.tab();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("items are not in the tab order", async () => {
  const user = userEvent.setup();
  const { button } = setup();
  await user.click(button);
  for (const menuItem of screen.getAllByRole("menuitem")) expect(menuItem.getAttribute("tabindex")).toBe("-1");
});

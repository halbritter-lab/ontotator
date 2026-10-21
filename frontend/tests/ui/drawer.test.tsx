import { createRef, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Drawer } from "../../src/ui/Drawer";
import { useShortcut } from "../../src/ui/shortcuts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A viewport `px` wide: `(min-width: n)` and `(max-width: n)` queries answer for that width. */
function viewport(px: number) {
  vi.stubGlobal("matchMedia", vi.fn((media: string) => {
    const min = /min-width:\s*(\d+)px/.exec(media), max = /max-width:\s*(\d+)px/.exec(media);
    const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
    return { media, matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  }));
}

function Host({ onShortcut = vi.fn(), initiallyOpen = false }: { onShortcut?: () => void; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const button = useRef<HTMLButtonElement>(null);
  // Registered as the editor registers its confirm-defaults key.
  useShortcut("d", onShortcut, { description: "Confirm defaults" });
  return <>
    <button ref={button} onClick={() => setOpen(true)}>Guidelines v3</button>
    <label>Editor note <input aria-label="Editor note" /></label>
    <button>Editor action</button>
    <Drawer open={open} title="Guidelines v3" onClose={() => setOpen(false)} returnFocusRef={button}
      footer={<button onClick={() => setOpen(false)}>Close</button>}>
      <p>Annotate negations.</p>
      <a href="#/somewhere">Inside link</a>
    </Drawer>
  </>;
}

it("is a non-modal aside from 1100 px and the editor stays operable", () => {
  viewport(1280);
  const editorAction = vi.fn();
  render(<><Host initiallyOpen /><button onClick={editorAction}>Save draft</button></>);
  const aside = screen.getByRole("complementary", { name: "Guidelines v3" });
  expect(aside.tagName).toBe("ASIDE");
  expect(aside.classList.contains("ui-drawer")).toBe(true);
  expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Guidelines v3" }).id).toBe(aside.getAttribute("aria-labelledby"));
  // Nothing outside is inert or hidden: the editor keeps working while the drawer is open.
  expect(document.querySelector("[inert]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(editorAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("complementary", { name: "Guidelines v3" })).toBeDefined();
});

it("is a modal dialog between 700 and 1099 px", () => {
  viewport(900);
  render(<Host initiallyOpen />);
  const dialog = screen.getByRole("dialog", { name: "Guidelines v3" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.classList.contains("ui-dialog--lg")).toBe(true);
  expect(dialog.closest(".ui-drawer-sheet")).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("is a full-height sheet below 700 px", () => {
  viewport(390);
  render(<Host initiallyOpen />);
  const dialog = screen.getByRole("dialog", { name: "Guidelines v3" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.closest(".ui-drawer-sheet")).not.toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("focuses the heading on open, returns focus to the button on close, Escape closes", () => {
  for (const width of [1280, 900, 390]) {
    viewport(width);
    const view = render(<Host />);
    const trigger = screen.getByRole("button", { name: "Guidelines v3" });
    trigger.focus();
    fireEvent.click(trigger);
    const heading = screen.getByRole("heading", { level: 2, name: "Guidelines v3" });
    expect(heading.contains(document.activeElement) || document.activeElement === heading, `heading focused at ${width} px`).toBe(true);
    // The footer Close (the header also has a labelled Close icon button).
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("heading", { level: 2, name: "Guidelines v3" })).toBeNull();
    expect(document.activeElement, `focus returned at ${width} px`).toBe(trigger);
    // Escape inside the open drawer closes it and returns focus as well.
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("link", { name: "Inside link" }), { key: "Escape" });
    expect(screen.queryByRole("heading", { level: 2, name: "Guidelines v3" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    view.unmount();
  }
});

it("D inside the drawer does nothing", () => {
  viewport(1280);
  const shortcut = vi.fn();
  render(<Host onShortcut={shortcut} initiallyOpen />);
  fireEvent.keyDown(screen.getByRole("link", { name: "Inside link" }), { key: "d" });
  fireEvent.keyDown(screen.getByText("Annotate negations."), { key: "d" });
  expect(shortcut).not.toHaveBeenCalled();
  // The same key outside the drawer reaches the editor shortcut.
  fireEvent.keyDown(screen.getByRole("button", { name: "Editor action" }), { key: "d" });
  expect(shortcut).toHaveBeenCalledTimes(1);
  // Escape inside still closes.
  fireEvent.keyDown(screen.getByRole("link", { name: "Inside link" }), { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
});

it("Escape outside the non-modal drawer leaves it open", () => {
  viewport(1280);
  render(<Host initiallyOpen />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Editor action" }), { key: "Escape" });
  expect(screen.getByRole("complementary", { name: "Guidelines v3" })).toBeDefined();
});

it("keeps the scroll position across close and reopen", () => {
  for (const width of [1280, 900]) {
    viewport(width);
    const view = render(<Host />);
    const trigger = screen.getByRole("button", { name: "Guidelines v3" });
    fireEvent.click(trigger);
    const scroller = () => screen.getByText("Annotate negations.").closest<HTMLElement>(".ui-drawer-body, .ui-dialog-body")!;
    scroller().scrollTop = 240;
    fireEvent.scroll(scroller());
    act(() => { fireEvent.keyDown(screen.getByRole("link", { name: "Inside link" }), { key: "Escape" }); });
    fireEvent.click(trigger);
    expect(scroller().scrollTop, `scroll kept at ${width} px`).toBe(240);
    view.unmount();
  }
});

it("renders nothing while closed", () => {
  viewport(1280);
  const ref = createRef<HTMLButtonElement>();
  const { container } = render(<Drawer open={false} title="Guidelines v3" onClose={vi.fn()} returnFocusRef={ref}><p>Text</p></Drawer>);
  expect(container.innerHTML).toBe("");
});

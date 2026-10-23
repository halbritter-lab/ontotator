import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Dialog } from "../../src/ui/Dialog";

afterEach(cleanup);
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/components.css"), "utf8");

function Example({ variant }: { variant?: "center" | "side" }) {
  const [open, setOpen] = useState(false);
  return <>
    <header><a href="#/home">Home</a></header>
    <main>
      <button onClick={() => setOpen(true)}>Accept result…</button>
      <Dialog open={open} variant={variant} title="Final result, case-107 de" onClose={() => setOpen(false)} footer={<button>Accept</button>}>
        <p>Round 1, Ana Weber</p>
      </Dialog>
    </main>
  </>;
}

it("side variant: aria-modal, inert background, heading focus, Escape returns focus", async () => {
  const user = userEvent.setup();
  render(<Example variant="side" />);
  const trigger = screen.getByRole("button", { name: "Accept result…" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Final result, case-107 de" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.className).toContain("ui-dialog--side");
  expect(dialog.className).not.toContain("ui-dialog--md");
  expect(dialog.parentElement?.className).toContain("modal-overlay--side");
  const heading = screen.getByRole("heading", { name: "Final result, case-107 de" });
  expect(document.activeElement).toBe(heading);
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(document.querySelector("header")?.hasAttribute("inert")).toBe(true);
  expect(trigger.hasAttribute("inert")).toBe(true);
  expect(dialog.closest("[inert]")).toBeNull();
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.querySelector("[inert]")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps inert that the page set itself", async () => {
  const user = userEvent.setup();
  render(<Example variant="side" />);
  document.querySelector("header")!.setAttribute("inert", "");
  await user.click(screen.getByRole("button", { name: "Accept result…" }));
  await user.keyboard("{Escape}");
  expect(document.querySelector("header")?.hasAttribute("inert")).toBe(true);
});

it("the center variant is unchanged: no inert background, first control focused", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Accept result…" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog.className).toBe("modal-content ui-dialog ui-dialog--md");
  expect(document.querySelector("[inert]")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept" }));
});

it("side panel is 480 px, full height, and a full-screen sheet below 700 px", () => {
  expect(css).toMatch(/\.ui-dialog--side \{[^}]*width: 480px/);
  expect(css).toMatch(/\.ui-dialog--side \{[^}]*height: 100dvh/);
  expect(css).toMatch(/\.ui-dialog--side \{[^}]*animation: ui-side-in 150ms/);
  const narrow = [...css.matchAll(/@media \(max-width: 699px\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join("\n");
  expect(narrow).toMatch(/\.ui-dialog--side \{[^}]*width: 100vw/);
});

it("no slide under reduced motion", () => {
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join("\n");
  expect(reduced).toMatch(/\.ui-dialog--side \{[^}]*animation: none/);
});

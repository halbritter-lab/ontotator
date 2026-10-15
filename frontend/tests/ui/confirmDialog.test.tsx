import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/ui/ConfirmDialog";
afterEach(cleanup);
it("confirm_and_cancel_call_back", () => {
  const confirm = vi.fn(); const cancel = vi.fn();
  render(<ConfirmDialog open title="Delete" message="Delete this item?" confirmLabel="Delete" tone="danger" onConfirm={confirm} onCancel={cancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" })); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(confirm).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});
it("escape_cancels", () => {
  const cancel = vi.fn();
  render(<ConfirmDialog open title="Delete" message="Sure?" confirmLabel="Delete" onConfirm={() => {}} onCancel={cancel} />);
  fireEvent.keyDown(window, { key: "Escape" }); expect(cancel).toHaveBeenCalledOnce();
});
it("busy_disables_both_and_prevents_escape_cancel", () => {
  const cancel = vi.fn();
  render(<ConfirmDialog open busy title="Delete" message="Sure?" confirmLabel="Delete" onConfirm={() => {}} onCancel={cancel} />);
  expect(screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getByRole("button", { name: "Delete" }).getAttribute("aria-busy")).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" }); expect(cancel).not.toHaveBeenCalled();
});

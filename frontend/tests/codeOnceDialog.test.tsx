import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeOnceDialog, type CodeOnceDialogProps } from "../src/admin/CodeOnceDialog";
import { formatDateTime } from "../src/app/labels";

const props = { open: true, kind: "setup" as const, code: "single-use-code-123", expires_at: "2026-10-16T12:30:00Z" };
const acknowledgement = "I have handed over or stored the code";
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function clipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); clipboard(undefined); });

describe("one-time code dialog", () => {
  it.each(["setup", "reset"] as const)("shows the %s code, exact warning and local expiry", kind => {
    render(<CodeOnceDialog {...props} kind={kind} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: kind === "setup" ? "Setup code" : "Reset code" });
    expect(within(dialog).getByText(props.code)).toBeDefined();
    expect(within(dialog).getByText("This code is shown only once. Hand it over in person or by a secure channel.")).toBeDefined();
    expect(dialog.querySelector("time")?.dateTime).toBe(props.expires_at);
    expect(dialog.querySelector("time")?.textContent).toBe(formatDateTime(props.expires_at));
  });

  it("gates Close, Escape and the backdrop until acknowledged", async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    render(<CodeOnceDialog {...props} onClose={close} />);
    const button = screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    await user.keyboard("{Escape}");
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: acknowledgement }));
    expect(button.disabled).toBe(false);
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
    await user.click(button);
    expect(close).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("removes permission to dismiss if the acknowledgement is unchecked again", async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    render(<CodeOnceDialog {...props} onClose={close} />);
    const checkbox = screen.getByRole("checkbox", { name: acknowledgement });
    await user.click(checkbox);
    await user.click(checkbox);
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the exact code to the clipboard and confirms only after resolution", async () => {
    const pending = deferred();
    const writeText = vi.fn().mockReturnValue(pending.promise);
    clipboard(writeText);
    render(<CodeOnceDialog {...props} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(props.code);
    const button = screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    await act(async () => { pending.resolve(); });
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the code with a useful message when clipboard copying fails, and permits retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(undefined);
    clipboard(writeText);
    render(<CodeOnceDialog {...props} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect((await screen.findByRole("alert")).textContent).toContain("copy the code manually");
    expect(screen.getByText(props.code)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the code when the clipboard API is unavailable", async () => {
    clipboard(undefined);
    render(<CodeOnceDialog {...props} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect((await screen.findByRole("alert")).textContent).toContain("copy the code manually");
    expect(screen.getByText(props.code)).toBeDefined();
  });

  it("resets acknowledgement and pending clipboard state for a new code and ignores an old copy result", async () => {
    const pending = deferred();
    clipboard(vi.fn().mockReturnValue(pending.promise));
    const close = vi.fn();
    const view = render(<CodeOnceDialog {...props} onClose={close} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.rerender(<CodeOnceDialog {...props} kind="reset" code="replacement-code" onClose={close} />);
    expect(screen.queryByText(props.code)).toBeNull();
    expect(screen.getByText("replacement-code")).toBeDefined();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(); });
    expect(screen.getByRole("button", { name: "Copy" }).getAttribute("aria-busy")).not.toBe("true");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("clears copied/error and acknowledgement state when the same code is reopened", async () => {
    clipboard(vi.fn().mockResolvedValue(undefined));
    const close = vi.fn();
    const view = render(<CodeOnceDialog {...props} onClose={close} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("button", { name: "Copied" });
    view.rerender(<CodeOnceDialog {...props} open={false} onClose={close} />);
    expect(screen.queryByText(props.code)).toBeNull();
    view.rerender(<CodeOnceDialog {...props} onClose={close} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();
    clipboard(vi.fn().mockRejectedValue(new Error("no clipboard")));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("alert");
    view.rerender(<CodeOnceDialog {...props} open={false} onClose={close} />);
    view.rerender(<CodeOnceDialog {...props} onClose={close} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps focus and the tab trap through acknowledgement changes, then restores the opener on close", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Issue code</button><CodeOnceDialog {...props} open={open} onClose={() => setOpen(false)} /></>;
    }
    const user = userEvent.setup();
    render(<StrictMode><Example /></StrictMode>);
    const opener = screen.getByRole("button", { name: "Issue code" });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy" }));
    await user.tab();
    const checkbox = screen.getByRole("checkbox");
    expect(document.activeElement).toBe(checkbox);
    await user.keyboard(" ");
    expect(document.activeElement).toBe(checkbox);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(props.code)).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("removes the code on unmount and safely ignores pending clipboard completion", async () => {
    const pending = deferred();
    clipboard(vi.fn().mockReturnValue(pending.promise));
    const view = render(<CodeOnceDialog {...props} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    view.unmount();
    await act(async () => { pending.resolve(); });
    expect(screen.queryByText(props.code)).toBeNull();
  });
});

// Generated CodeResponse fields are accepted directly without a parallel DTO.
const compatibleProps: CodeOnceDialogProps = { ...props, onClose: () => {} };
void compatibleProps;

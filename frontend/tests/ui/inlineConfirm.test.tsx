import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InlineConfirm, type InlineConfirmOutcome } from "../../src/ui/InlineConfirm";
import { fullTimestamp } from "../../src/app/submissionLabels";

afterEach(cleanup);

function Harness(props: { busy?: boolean; outcome?: InlineConfirmOutcome | null; onCancel?: () => void; onConfirm?: () => void }) {
  return <>
    <button>Outside</button>
    <InlineConfirm title="Keep final result" message="Keep Annotation · Round 1 · ann-0004 as the final result for c · de?" confirmLabel="Keep as final"
      busy={props.busy} outcome={props.outcome ?? null} onCancel={props.onCancel ?? vi.fn()} onConfirm={props.onConfirm ?? vi.fn()}>
      <input type="checkbox" aria-label="I reviewed these changes and keep this exact result" />
    </InlineConfirm>
  </>;
}

it("focuses_its_heading_on_open_and_is_a_labelled_group", () => {
  render(<Harness />);
  const group = screen.getByRole("group", { name: "Keep final result" });
  expect(document.activeElement?.textContent).toBe("Keep final result");
  expect(group.getAttribute("aria-describedby")).toBeTruthy();
});

it("escape_cancels_when_focus_is_on_the_checkbox_inside", () => {
  const cancel = vi.fn(); render(<Harness onCancel={cancel} />);
  const box = screen.getByRole("checkbox"); box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("escape_outside_is_ignored", () => {
  const cancel = vi.fn(); render(<Harness onCancel={cancel} />);
  const outside = screen.getByRole("button", { name: "Outside" }); outside.focus();
  fireEvent.keyDown(outside, { key: "Escape" });
  expect(cancel).not.toHaveBeenCalled();
});

it("busy_keeps_focus_on_the_primary_consumes_escape_and_makes_cancel_unavailable", () => {
  const cancel = vi.fn(), confirm = vi.fn();
  const { rerender } = render(<Harness onCancel={cancel} onConfirm={confirm} />);
  const primary = screen.getByRole("button", { name: "Keep as final" }); primary.focus();
  rerender(<Harness busy onCancel={cancel} onConfirm={confirm} />);
  expect(document.activeElement).toBe(primary);
  expect(primary.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(primary, { key: "Escape" });
  screen.getByRole("button", { name: "Cancel" }).click();
  primary.click();
  expect(cancel).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText("Saving…")).toBeTruthy();
});

it("conflict_outcome_is_read_only_with_review_again_and_close_and_takes_focus", () => {
  const review = vi.fn(), close = vi.fn();
  render(<Harness outcome={{ kind: "conflict", changedBy: "lead-0002", changedAt: "2026-10-19T08:00:00Z", onReview: review }} onCancel={close} />);
  const message = screen.getByText(/The final result or its warnings changed since you opened this\. Nothing was saved\. Review the current state\./);
  expect(document.activeElement).toBe(message);
  expect(screen.getByText(/Changed by lead-0002 at/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Keep as final" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  screen.getByRole("button", { name: "Review again" }).click(); expect(review).toHaveBeenCalledOnce();
  screen.getByRole("button", { name: "Close" }).click(); expect(close).toHaveBeenCalledOnce();
});

it("conflict_message_can_be_replaced_by_the_caller", () => {
  render(<InlineConfirm title="Close report" message="m" confirmLabel="Close report" onConfirm={vi.fn()} onCancel={vi.fn()}
    conflictMessage="This report changed since you opened it. Nothing was saved." outcome={{ kind: "conflict", onReview: vi.fn() }} />);
  expect(screen.getByText("This report changed since you opened it. Nothing was saved.")).toBeTruthy();
  expect(screen.queryByText(/The final result or its warnings changed/)).toBeNull();
});

it("replaced_conflict_message_keeps_the_changed_by_suffix", () => {
  render(<InlineConfirm title="Close report" message="m" confirmLabel="Close report" onConfirm={vi.fn()} onCancel={vi.fn()}
    conflictMessage="This report changed since you opened it. Nothing was saved."
    outcome={{ kind: "conflict", changedBy: "lead-0002", changedAt: "2026-10-19T08:00:00Z", onReview: vi.fn() }} />);
  const notice = screen.getByRole("alert");
  expect(notice.textContent).toMatch(/^This report changed since you opened it\. Nothing was saved\. Changed by lead-0002 at .+\.$/);
  expect(notice.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-19T08:00:00Z");
});

it("conflict_time_carries_the_full_timestamp_as_title", () => {
  render(<Harness outcome={{ kind: "conflict", changedBy: "lead-0002", changedAt: "2026-10-19T08:00:00Z", onReview: vi.fn() }} />);
  const time = screen.getByRole("alert").querySelector("time");
  expect(time?.getAttribute("title")).toBe(fullTimestamp("2026-10-19T08:00:00Z"));
});

it("retry_is_unavailable_while_busy_and_swallows_activation", () => {
  const retry = vi.fn();
  const { rerender } = render(<Harness busy outcome={{ kind: "error", onRetry: retry }} />);
  const button = screen.getByRole("button", { name: "Retry" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button); fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
  rerender(<Harness outcome={{ kind: "error", onRetry: retry }} />);
  expect(screen.getByRole("button", { name: "Retry" }).getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("network_and_session_outcomes", () => {
  const retry = vi.fn();
  const { rerender } = render(<Harness outcome={{ kind: "error", onRetry: retry }} />);
  expect(screen.getByText("Could not save. Nothing changed.")).toBeTruthy();
  screen.getByRole("button", { name: "Retry" }).click(); expect(retry).toHaveBeenCalledOnce();
  rerender(<Harness outcome={{ kind: "session" }} />);
  expect(screen.getByText("Your session ended. Nothing was saved. Sign in and confirm again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Keep as final" })).toBeTruthy();
});

it("button_order_matches_confirm_dialog_and_heading_level_is_configurable", () => {
  render(<InlineConfirm title="Use as final" message="m" confirmLabel="Use as final" headingLevel={3} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole("heading", { level: 3, name: "Use as final" })).toBeTruthy();
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Cancel", "Use as final"]);
});

it("confirm_unavailable_with_a_reason_is_aria_disabled_described_and_calls_the_unavailable_handler", () => {
  const confirm = vi.fn(), unavailable = vi.fn();
  const { rerender } = render(<InlineConfirm title="Keep final result" message="m" confirmLabel="Keep as final" onConfirm={confirm} onCancel={vi.fn()}
    confirmUnavailable={{ reason: "Check the box first." }} onConfirmUnavailable={unavailable} />);
  const primary = screen.getByRole("button", { name: "Keep as final" });
  expect(primary.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(primary.getAttribute("aria-describedby")!)?.textContent).toBe("Check the box first.");
  fireEvent.click(primary);
  expect(unavailable).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  rerender(<InlineConfirm title="Keep final result" message="m" confirmLabel="Keep as final" onConfirm={confirm} onCancel={vi.fn()} onConfirmUnavailable={unavailable} />);
  expect(primary.getAttribute("aria-disabled")).toBeNull();
  expect(primary.getAttribute("aria-describedby")).toBeNull();
  expect(screen.queryByText("Check the box first.")).toBeNull();
  fireEvent.click(primary);
  expect(confirm).toHaveBeenCalledOnce();
  expect(unavailable).toHaveBeenCalledOnce();
});

it("confirm_unavailable_can_point_at_a_reason_rendered_by_the_caller_and_swallows_activation_without_handler", () => {
  const confirm = vi.fn();
  const { rerender } = render(<InlineConfirm title="t" message="m" confirmLabel="Keep as final" onConfirm={confirm} onCancel={vi.fn()} confirmUnavailable={{}}>
    <p id="caller-reason">Caller reason</p>
  </InlineConfirm>);
  const primary = screen.getByRole("button", { name: "Keep as final" });
  expect(primary.getAttribute("aria-disabled")).toBe("true");
  expect(primary.getAttribute("aria-describedby")).toBeNull();
  fireEvent.click(primary);
  expect(confirm).not.toHaveBeenCalled();
  rerender(<InlineConfirm title="t" message="m" confirmLabel="Keep as final" onConfirm={confirm} onCancel={vi.fn()} confirmUnavailable={{ reasonId: "caller-reason" }}>
    <p id="caller-reason">Caller reason</p>
  </InlineConfirm>);
  expect(primary.getAttribute("aria-describedby")).toBe("caller-reason");
});

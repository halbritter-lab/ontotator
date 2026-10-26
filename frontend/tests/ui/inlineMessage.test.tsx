import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { InlineMessage } from "../../src/ui/InlineMessage";

it.each(["error", "info", "success", "warning"] as const)("error_is_an_alert_others_are_status: %s", (tone) => {
  render(<InlineMessage tone={tone} title="Import result">One package processed.</InlineMessage>);
  expect(screen.getByRole(tone === "error" ? "alert" : "status").textContent).toContain("One package processed.");
});

it("dismiss_calls_back", async () => {
  let dismissed = false;
  render(<InlineMessage tone="success" onDismiss={() => { dismissed = true; }}>Imported</InlineMessage>);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
  expect(dismissed).toBe(true);
});

it("passes_the_aria_label", () => {
  render(<InlineMessage tone="info" aria-label="Import result">Imported</InlineMessage>);
  expect(screen.getByRole("status", { name: "Import result" }).textContent).toBe("Imported");
});

it("live_false_leaves_the_role_to_the_callers_live_region", () => {
  render(<div aria-live="polite"><InlineMessage tone="success" live={false}>Confirmed</InlineMessage></div>);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("Confirmed").closest(".notice-success")).not.toBeNull();
});

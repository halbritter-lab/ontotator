import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatusBadge, statusTone } from "../../src/ui/StatusBadge";

it.each([
  ["not_started", "neutral"], ["open", "neutral"], ["unassigned", "neutral"],
  ["in_progress", "info"], ["completed", "success"], ["submitted", "success"], ["succeeded", "success"],
  ["reopened", "warning"], ["queued", "warning"], ["running", "warning"],
  ["failed", "danger"], ["invalid", "danger"], ["revoked", "danger"], ["unrecognized", "neutral"],
])("maps_document_and_workflow_states_to_tones: %s", (status, tone) => {
  expect(statusTone(status)).toBe(tone);
  render(<StatusBadge status={status}>{status}</StatusBadge>);
  expect(screen.getByText(status).classList.contains(`status-pill--${tone}`)).toBe(true);
});

it("explicit_tone_wins", () => {
  render(<StatusBadge status="failed" tone="info" title="Awaiting review">Review</StatusBadge>);
  const badge = screen.getByText("Review");
  expect(badge.classList.contains("status-pill--info")).toBe(true);
  expect(badge.title).toBe("Awaiting review");
});

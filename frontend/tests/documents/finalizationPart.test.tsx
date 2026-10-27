import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FinalizationPart } from "../../src/documents/textCard/FinalizationPart";
import { row, stageCell, stages } from "./fixtures";

afterEach(cleanup);

it("names who consolidates the text instead of an empty part (R-6)", () => {
  const carla = { pseudonym: "ann-0007", display_name: "Carla Consolidator", is_me: false };
  const consolidating = row({ case_id: "W07", language: "en", stages: stages({ annotation: stageCell("consolidating", "running", { people: [carla] }) }) });
  render(<FinalizationPart row={consolidating} projectKey="p" query={{}} onNavigate={vi.fn()} now={new Date("2026-10-27T12:00:00Z")} />);
  expect(screen.getByText("Carla Consolidator is consolidating this text.")).toBeTruthy();
});

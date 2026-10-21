import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MergeInputs } from "../src/tasks/MergeInputs";
import { historical } from "./variantFixtures";

afterEach(cleanup);
const snapshot = historical.annotations[0];
const inputs = ["first", "second"].map(input_id => ({ input_id, source_submission_id: input_id, source_ref: { annotation_id: snapshot.annotation.annotation_id, version: snapshot.version }, source_snapshot: snapshot, target_snapshot: null, mapping_status: "needs_review" as const }));
it("requires two explicitly chosen inputs and a saved compatible output", async () => {
  const merge = vi.fn().mockResolvedValue(undefined);
  render(<MergeInputs inputs={inputs} annotations={[snapshot]} labelFor={() => "Seizure"} onMerge={merge} />);
  const button = screen.getByRole("button", { name: "Merge selected inputs into saved finding" });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Input 1/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Input 2/ }));
  expect(button).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("combobox", { name: "Saved merged finding" }), { target: { value: snapshot.annotation.annotation_id } });
  fireEvent.click(button);
  await waitFor(() => expect(merge).toHaveBeenCalledWith(["first", "second"], snapshot.annotation.annotation_id, undefined));
});
it("labels an input from the draft before the text change without a submission id", () => {
  const drafted = inputs.map(value => ({ ...value, source_submission_id: null, source_draft_snapshot_id: 4 }));
  render(<MergeInputs inputs={drafted} annotations={[snapshot]} labelFor={() => "Seizure"} onMerge={vi.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Input 1: Seizure" })).toBeDefined();
  expect(screen.getByRole("checkbox", { name: "Input 2: Seizure" })).toBeDefined();
});
it("preserves selected input manifest, output and note after a failed merge", async () => {
  const merge = vi.fn().mockRejectedValue(new Error("Output changed"));
  render(<MergeInputs inputs={inputs} annotations={[snapshot]} labelFor={() => "Seizure"} onMerge={merge} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Input 1/ })); fireEvent.click(screen.getByRole("checkbox", { name: /Input 2/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Saved merged finding" }), { target: { value: snapshot.annotation.annotation_id } });
  fireEvent.change(screen.getByRole("textbox", { name: "Merge note" }), { target: { value: "Same clinical finding" } });
  fireEvent.click(screen.getByRole("button", { name: "Merge selected inputs into saved finding" }));
  await screen.findByText("Output changed");
  expect(screen.getByRole("combobox", { name: "Saved merged finding" })).toHaveProperty("value", snapshot.annotation.annotation_id);
  expect(screen.getByRole("checkbox", { name: /Input 1/ })).toHaveProperty("checked", true);
  expect(screen.getByRole("textbox", { name: "Merge note" })).toHaveProperty("value", "Same clinical finding");
});

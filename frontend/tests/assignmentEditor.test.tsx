import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CaseScreen } from "../src/app/CaseScreen";
import { api } from "../src/api/client";
import { workspaceFixture } from "./assignments";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const view = (): any => ({
  document: { document_id: "doc", text: "Patient has seizures.", language: "en", text_sha256: "x" },
  key: { project_key: "pkg", document_id: "doc", annotator_id: "ann", mode: "independent", scope_id: "s", target_set_id: "t" },
  scope: { scope_id: "s", mode: "independent", editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
  draft: { revision: 0, annotations: [], evidence: [], decisions: [] },
  layers: [{ layer_id: "phenotype", label: "Phenotype", access: "editable", default_visible: true, default_type_id: "default", annotation_types: [] }],
});

it("keeps proposal inspection useful but prevents notes, decisions and replacement editing", () => {
  const response = workspaceFixture("doc", "review");
  const proposal: any = {
    annotation: { annotation_id: "proposal", layer_id: "phenotype", type_id: "default", term_id: "HP:2", axes_values: {}, evidence_refs: [],
      provenance: { actor: { actor_id: "source", kind: "tool" }, method: "automated", source_refs: [] } },
    version: "v1", evidence: [], document_id: "doc", text_sha256: "text",
  };
  response.view.available_inputs = [proposal];
  response.view.targets = { target_set_id: "targets", targets: [{ annotation_id: "proposal", version: "v1" }] };
  response.view.draft.annotations = [{ ...proposal, annotation: { ...proposal.annotation, annotation_id: "own", term_id: "HP:1" } }];
  const command = vi.spyOn(api, "applyCommand"), decide = vi.spyOn(api, "recordDecision");
  render(<CaseScreen view={response.view} workspaceId="ws" onClose={vi.fn()} readOnly />);
  fireEvent.click(Array.from(document.querySelectorAll(".sidebar .doc-item")).find(node => node.textContent?.includes("HP:2"))!);
  const note = screen.getByRole("textbox", { name: "Reviewer note" }) as HTMLInputElement;
  expect(note.readOnly).toBe(true);
  for (const name of [/^Confirm/, /^Reject/, /Edit & Replace/, /^Uncertain/, /Assign replacement from draft/]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.keyDown(document.querySelector(".text-container")!, { key: "1" });
  fireEvent.keyDown(document.querySelector(".text-container")!, { key: "3" });
  expect(command).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled();
});

it("offers ontology search for inspection without allowing a submitted annotation to change", async () => {
  const response = workspaceFixture();
  response.view.draft.annotations = [{ annotation: { annotation_id: "own", document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: "HP:1", axes_values: {}, evidence_refs: [],
    provenance: { actor: { actor_id: "alice", kind: "human" }, method: "manual" } }, evidence: [], version: "v1" } as any];
  render(<CaseScreen view={response.view} workspaceId="ws" onClose={vi.fn()} readOnly />);
  fireEvent.click(Array.from(document.querySelectorAll(".sidebar .doc-item")).find(node => node.textContent?.includes("HP:1"))!);
  fireEvent.click(screen.getByRole("button", { name: "Search ontology" }));
  expect(await screen.findByRole("textbox", { name: /Search ontology term/ })).toBeDefined();
});

it("closes an unfinished new-annotation form when the mounted workspace becomes read-only", () => {
  const response = workspaceFixture();
  const props = { view: response.view, workspaceId: "ws", onClose: vi.fn() };
  const mounted = render(<CaseScreen {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /New Annotation/ }));
  expect(screen.getByRole("region", { name: "New Annotation" })).toBeDefined();
  mounted.rerender(<CaseScreen {...props} readOnly />);
  expect(screen.queryByRole("region", { name: "New Annotation" })).toBeNull();
});

it("keeps a submitted workspace readable while disabling submission and new findings", async () => {
  const command = vi.spyOn(api, "applyCommand");
  const submit = vi.spyOn(api, "submitWorkspace");
  render(<CaseScreen view={view()} workspaceId="ws" onClose={vi.fn()} readOnly />);
  expect(screen.getByText("Submitted. The project lead can reopen it for changes.")).toBeDefined();
  expect((screen.getByRole("button", { name: /Finish & Submit Case/ }) as HTMLButtonElement).disabled).toBe(true);
  const add = screen.getByRole("button", { name: /New Annotation/i }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  fireEvent.click(add);
  fireEvent.keyDown(document.querySelector(".text-container")!, { key: "1" });
  expect(command).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(document.querySelector(".text-container")?.textContent).toContain("Patient has seizures.");
});

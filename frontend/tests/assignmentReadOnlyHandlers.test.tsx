import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { workspaceFixture } from "./assignments";
import { caseDetail, historical, ownRef } from "./variantFixtures";
import { refKey } from "../src/variants/versionState";
import type { AnnotationPanelProps } from "../src/editor/AnnotationPanel";
import type { TextPaneProps } from "../src/editor/TextPane";
import type { ReviewActionsProps } from "../src/editor/ReviewActions";

const callbacks = vi.hoisted(() => ({ panel: null as unknown as AnnotationPanelProps,
  text: null as unknown as TextPaneProps, review: null as unknown as ReviewActionsProps,
  layer: null as any, tree: null as any }));
vi.mock("../src/editor/AnnotationPanel", async original => ({ ...await original<object>(),
  AnnotationPanel: (props: AnnotationPanelProps) => { callbacks.panel = props; return null; } }));
vi.mock("../src/editor/TextPane", () => ({ TextPane: (props: TextPaneProps) => {
  callbacks.text = props; return <div className="text-container">{props.text}</div>;
} }));
vi.mock("../src/editor/ReviewActions", async original => ({ ...await original<object>(),
  ReviewActions: (props: ReviewActionsProps) => { callbacks.review = props; return null; } }));
vi.mock("../src/editor/LayerControls", () => ({ LayerControls: (props: any) => { callbacks.layer = props; return null; } }));
vi.mock("../src/editor/TreeBrowser", () => ({ TreeBrowser: (props: any) => { callbacks.tree = props; return null; } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["submitted", "snapshot"] as const)("rejects every retained edit callback after the mounted assignment becomes read-only: %s", async mode => {
  vi.spyOn(api,"getReanchorItems").mockResolvedValue([]);
  const response = workspaceFixture("doc", "review");
  const snapshot = (id: string, term: string): any => ({
    annotation: { annotation_id: id, document_id: "doc", layer_id: "phenotype", type_id: "default", term_id: term,
      axes_values: { assertion: "present" }, evidence_refs: [{ evidence_id: "ev", version: "ev-v" }],
      provenance: { actor: { actor_id: "alice", kind: "human" }, method: "manual", source_refs: [] } },
    version: "v1", document_id: "doc", text_sha256: "text", evidence: [],
  });
  response.view.draft.annotations = [snapshot("own", "HP:1")];
  response.view.draft.evidence = [{ mention: { evidence_id: "ev", segments: [{ start: 0, end: 7 }] }, version: "ev-v" } as any];
  response.view.available_inputs = [snapshot("proposal", "HP:2")];
  response.view.targets = { target_set_id: "targets", targets: [{ annotation_id: "proposal", version: "v1" }] };
  const command = vi.spyOn(api, "applyCommand"), decision = vi.spyOn(api, "recordDecision"), submit = vi.spyOn(api, "submitWorkspace");
  vi.spyOn(api, "getVariantMetadata").mockResolvedValue(caseDetail.variants[1]);
  vi.spyOn(api, "getCase").mockResolvedValue({ ...caseDetail, variants: [{ ...caseDetail.variants[1], document_id: "doc" }] });
  vi.spyOn(api, "listAnnotationVersions").mockResolvedValue([ownRef]);
  vi.spyOn(api, "getAnnotationVersion").mockResolvedValue({ ...historical, annotations: [] });
  const props = { versionContext: mode === "snapshot" ? { username: "alice", assignmentId: 1, onNavigate: vi.fn() } : undefined, view: response.view, workspaceId: "ws", onClose: vi.fn() };
  const mounted = render(<CaseScreen {...props} />);
  const item = (term: string) => Array.from(document.querySelectorAll(".sidebar .doc-item")).find(node => node.textContent?.includes(term))!;
  fireEvent.click(item("HP:1"));
  const own = callbacks.panel;
  act(() => own.onShowInTree?.());
  const tree = callbacks.tree, layer = callbacks.layer;
  fireEvent.click(item("HP:2"));
  const review = callbacks.review, text = callbacks.text;
  if (mode === "submitted") {
    mounted.rerender(<CaseScreen {...props} readOnly />);
    expect(callbacks.tree.canAssign).toBe(false);
  } else {
    fireEvent.change(await screen.findByLabelText("Annotations"), { target: { value: refKey(ownRef) } });
    await screen.findByText("Viewing My submitted version (read-only)");
    expect(callbacks.text.readOnly).toBe(true);
  }
  await act(async () => {
    own.onUpdateTerm("HP:3"); own.onUpdateAxes({ assertion: "absent" }); own.onConfirmAxis?.("assertion");
    own.onAttachMention([{ start: 8, end: 11 }]); own.onDetachMention("ev"); own.onDeleteAnnotation("own");
    own.onSetIntent("new_mention");
    text.onSelection({ segments: [{ start: 1, end: 3 }], intent: "new_mention" });
    text.onSelection({ segments: [{ start: 1, end: 3 }], intent: "extend_mention" });
    text.onResizeMention?.("ev", [{ start: 0, end: 11 }]); text.onChangeIntent("extend_mention");
    review.onDecide({ outcome: "confirmed" }); review.onAdoptAndEdit?.(); review.onNoteChange?.("stale note");
    layer.onCheckLayer("phenotype", true); await tree.onUseTerm("HP:3", "browse");
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n" });
  });
  expect(command).not.toHaveBeenCalled(); expect(decision).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  expect(callbacks.text.isAttachingMention).toBe(false);
  expect(callbacks.text.selectionIntent).toBe("new_mention");
  expect(callbacks.review.note).toBe("");
});

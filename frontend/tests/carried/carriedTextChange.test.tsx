import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AnnotationSnapshot, type RoundInputView } from "../../src/api/client";
import { CaseScreen } from "../../src/app/CaseScreen";
import { carriedOriginLine } from "../../src/editor/carried/instructions";
import { historical } from "../variantFixtures";
import { workspaceFixture } from "../assignments";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const finding = (id: string): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id;
  return copy;
};
/** An input of a `text_change` round: frozen from the draft, so no submission and no round ordinal. */
const draftInput = (id: string, target: AnnotationSnapshot): RoundInputView => {
  const source = structuredClone(historical.annotations[0]);
  return {
    input_id: id, source_submission_id: null, source_draft_snapshot_id: 9, source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
    source_snapshot: source, target_snapshot: target, mapping_status: "carried", source_round_ordinal: null, source_recorded_at: null,
  };
};

function setup(roundKind: "text_change" | "handover", inputs: RoundInputView[], annotations: AnnotationSnapshot[]) {
  const view = workspaceFixture().view;
  view.key.round_id = "round-2"; view.draft.key = view.key; view.require_spanless_note = false;
  view.draft.annotations = annotations;
  view.draft.round_input_resolutions = [];
  return render(<CaseScreen view={view} workspaceId="round-workspace" roundKind={roundKind} roundInputs={inputs} onClose={vi.fn()} />);
}

describe("carried findings after a text change", () => {
  it("text_change inputs read Check after text change", () => {
    const carried = finding("carried");
    const { container } = setup("text_change", [draftInput("input-1", carried)], [carried]);
    expect(screen.getByText("Check after text change", { selector: ".badge" })).toBeDefined();
    const row = container.querySelector<HTMLElement>('[data-list-key="annotation:carried"]')!;
    expect(within(row).getByText("Check after text change")).toBeDefined();
    expect(screen.getByText("0 of 1 checked")).toBeDefined();
  });

  it("handover rounds show their carried inputs like a carry-forward", () => {
    const carried = finding("carried");
    const input = { ...draftInput("input-1", carried), source_draft_snapshot_id: null, source_submission_id: "sub-1", source_round_ordinal: 1 };
    const { container } = setup("handover", [input], [carried]);
    expect(screen.getByText("Review carried findings", { selector: ".badge" })).toBeDefined();
    const row = container.querySelector<HTMLElement>('[data-list-key="annotation:carried"]')!;
    expect(within(row).getByText("Carried from Round 1")).toBeDefined();
  });

  it("origin line by input source", () => {
    expect(carriedOriginLine({ source_draft_snapshot_id: 3, source_round_ordinal: null })).toBe("Check after text change");
    expect(carriedOriginLine({ source_draft_snapshot_id: null, source_round_ordinal: 2 })).toBe("Carried from Round 2");
    expect(carriedOriginLine({ source_round_ordinal: null })).toBe("Carried from an earlier submission");
  });
});

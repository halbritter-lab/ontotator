import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type AnnotationSnapshot, type RoundInputView } from "../src/api/client";
import { CaseScreen } from "../src/app/CaseScreen";
import { storageKey } from "../src/editor/sidebarWidth";
import { historical } from "./variantFixtures";
import { workspaceFixture } from "./assignments";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(api, "resolveTermLabels").mockImplementation(async (_project, terms) => terms.map(term => ({ ...term, label: "Seizure" })) as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "alice", mode_by_package: {} });
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listAssignmentSubmissions").mockResolvedValue([] as never);
  vi.spyOn(api, "getSubmissionHistory").mockResolvedValue([] as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const finding = (id: string): AnnotationSnapshot => {
  const copy = structuredClone(historical.annotations[0]);
  copy.annotation.annotation_id = id;
  return copy;
};
const input = (id: string, target: AnnotationSnapshot): RoundInputView => {
  const source = structuredClone(historical.annotations[0]);
  return {
    input_id: id, source_submission_id: "submission-2", source_ref: { annotation_id: source.annotation.annotation_id, version: source.version },
    source_snapshot: source, target_snapshot: target, mapping_status: "carried", source_round_ordinal: 2,
  };
};

function setup({ carryForward = false }: { carryForward?: boolean } = {}) {
  const view = workspaceFixture().view;
  view.require_spanless_note = false;
  const versionContext = { username: "alice", assignmentId: 7, canBrowseVersions: false, onNavigate: vi.fn() };
  if (!carryForward) return render(<CaseScreen view={view} workspaceId="workspace" versionContext={versionContext} onClose={vi.fn()} />);
  view.key.round_id = "round-3"; view.draft.key = view.key;
  const carried = finding("carried");
  view.draft.annotations = [carried];
  view.draft.round_input_resolutions = [];
  return render(<CaseScreen view={view} workspaceId="round-workspace" versionContext={versionContext}
    roundKind="carry_forward" roundInputs={[input("input-1", carried)]} onClose={vi.fn()} />);
}

describe("findings column layout", () => {
  it("sets the stored sidebar width on the layout and mounts the separator for the sidebar", () => {
    window.localStorage.setItem(storageKey("alice"), "320");
    const { container } = setup();
    const layout = container.querySelector<HTMLElement>(".app-layout")!;
    expect(layout.style.getPropertyValue("--sidebar-width")).toBe("320px");
    const separator = screen.getByRole("separator", { name: "Resize findings column" });
    const sidebar = container.querySelector<HTMLElement>("aside.sidebar")!;
    expect(sidebar.id).not.toBe("");
    expect(separator.getAttribute("aria-controls")).toBe(sidebar.id);
    expect(sidebar.nextElementSibling).toBe(separator);
  });

  it("names the narrow-screen list tab Findings", () => {
    setup();
    expect(screen.getByRole("button", { name: "Findings" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
  });

  it("counts unchecked carried findings in the tab name", () => {
    setup({ carryForward: true });
    expect(screen.getByRole("button", { name: "Findings, 1 to check" })).toBeDefined();
  });
});

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";
import type { WorkspaceView } from "../../src/app/CaseScreen";
import { TermPicker } from "../../src/consolidation/TermPicker";
import { NO_PREFILL_HINT } from "../../src/editor/termSearch";
import { workspaceView } from "./fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const hp = (translations: { language: string; filenames: string[]; term_count: number }[]) =>
  ({ ontology_id: "hp", release: "2026-06-23", sha256: "abc123", term_count: 19000, translations });

function withOntology(): WorkspaceView {
  const view = workspaceView();
  return {
    ...view,
    layers: view.layers!.map(layer => ({ ...layer, ontology_id: "hp" })),
    ontologies: [{ ontology_id: "hp", sha256: "abc123" }],
  } as unknown as WorkspaceView;
}

function renderPicker(translations: Parameters<typeof hp>[0]) {
  vi.spyOn(api, "listPackageOntologies").mockResolvedValue([hp(translations)] as never);
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "ann-0009", mode_by_package: {} } as never);
  vi.spyOn(api, "searchOntology").mockResolvedValue({ route: "auto", query: "x", shuffled: false, search_id: "s", candidates: [] } as never);
  const anchor = createRef<HTMLButtonElement>();
  render(<><button ref={anchor} type="button">anchor</button>
    <TermPicker open anchorRef={anchor} label="Add finding" workspace={withOntology()} layerId="phenotype" initialQuery="Hypotonie" onPick={vi.fn()} onClose={vi.fn()} /></>);
}

describe("TermPicker", () => {
  it("drops the English-only hint when the text's language is searched", async () => {
    renderPicker([{ language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 3412 }]);
    await waitFor(() => expect(api.getPreferences).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(NO_PREFILL_HINT)).toBeNull());
  });

  it("keeps the English-only hint when the text's language is not loaded", async () => {
    renderPicker([{ language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 18201 }]);
    await waitFor(() => expect(api.getPreferences).toHaveBeenCalled());
    expect(await screen.findByText(NO_PREFILL_HINT)).toBeTruthy();
  });
});
